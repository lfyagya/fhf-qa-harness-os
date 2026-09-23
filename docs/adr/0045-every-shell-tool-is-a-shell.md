# ADR-0045 — Every Shell Tool Is a Shell

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-24 |
| **Relates to** | ADR-0038 (the deny seam: a refusal only helps if it fires), ADR-0041 (hook ordering classes: ordering within a matcher), ADR-0032 (one central hook set at the workspace root) |
| **Amends** | `PHASE_MATCHERS` in `scripts/harness/loader-templates.mjs` (`preShell`, `preReadExceptE2e`), `connectors.cypressCloud.cli.guard.inlineCredentialPatterns`, `manual-task-guard.mjs` workspace enforcement |

## Context

The Claude Code desktop exposes two shell tools, `Bash` and `PowerShell`. The generated
`settings.json` matched the shell guards to `Bash` only (`preShell: "Bash"`,
`preReadExceptE2e: "Read|Bash"`), so `manual-task-guard.mjs`, `protect-harness-governance.mjs` and
`protect-prod-data.mjs` never ran for a PowerShell call.

On 2026-09-24 an agent ran
`$env:CYPRESS_CLOUD_TOKEN = [Environment]::GetEnvironmentVariable('CYPRESS_CLOUD_TOKEN','User')`
through PowerShell. The same assignment through Bash was refused by `manual-task-guard.mjs`
("Cypress Cloud credentials must come from OAuth or the external CI secret environment"). The guard
logic was right. It just was not wired to that tool.

`session-rules.md` had written the gap down as a feature: the WORKSPACE BLOCKED recovery was
"`Set-Location <workspace-root>` through PowerShell, because the guard intercepts Bash and Edit only".
If PowerShell were guarded and nothing else changed, that recovery would be refused too and a
recoverable block would become a dead session.

All three guards already read `tool_input.command`, and the PowerShell payload has the same shape as
Bash (`{ command, description, timeout, run_in_background }`). So the hooks did not need a new
payload parser. They needed the matcher and a few PowerShell-only syntax forms.

## Decision

1. **Every shell phase matches every shell tool.** `preShell` is `Bash|PowerShell` and
   `preReadExceptE2e` is `Read|Bash|PowerShell`. Cursor is unchanged. It has no separate PowerShell
   tool, and on Windows it runs PowerShell through `Shell`, which is already matched.

2. **The patterns cover PowerShell syntax where it differs from POSIX.**
   - Credentials: `\bCYPRESS_CLOUD_TOKEN\s*=` already matched `$env:X =`. Added `Set-Item`/`New-Item`
     on `env:`, `setx`, and `[Environment]::SetEnvironmentVariable(...)`. Reading whether the
     variable exists (`Test-Path env:...`) is still allowed.
   - `protect-prod-data.mjs` accepts `$env:FHF_LANE = 'e2e'` as the E2E lane opt-in. PowerShell
     cannot assign a bare word, so the old `FHF_LANE=e2e` pattern could never match there.
   - Writes (`Set-Content`, `Out-File`, `>`) to gate paths and application source were already
     refused, because governance allows only a read-only allowlist and `manual-task-guard.mjs`'s
     `shellMutation` already listed the PowerShell cmdlets. Tests now pin that behavior.
   - The inline `FHF_ALLOW_HARNESS_EDIT=1` opt-in regex already matches `$env:FHF_ALLOW_HARNESS_EDIT = 1`.
     Tool shell state does not persist between calls, so the narrower guarantee is the same one
     Bash had.

3. **A lone directory change into a ready workspace is exempt from WORKSPACE BLOCKED.**
   `cd`, `chdir`, `pushd`, `Set-Location`, `sl` or `Push-Location` with one path argument and nothing
   chained onto it skips `enforceWorkspaceReady` when `workspacePreflight` reports the target ready.
   A chained command, or a target that is not ready, is still blocked. Recovery now works from
   either tool, where before it depended on one tool being unguarded.

4. **Denials say `SHELL BLOCKED`, not `BASH BLOCKED`.** No code parsed the old prefix.

5. **Wiring is tested, not only logic.** `test-hooks.mjs` asserts that the generated `PreToolUse`
   entries route all three guards to `PowerShell` as well as `Bash`. That missing check is why the
   gap shipped: every guard test fed the hook a payload directly, which proved the logic and never
   proved the runtime would call it.

## Consequences

- An agent can no longer route around a shell refusal by switching tools.
- ADR-0041's ordering check still passes. The added tool widens matchers that already overlapped
  and adds no new inversion.
- Any future shell-like tool needs the same treatment. `PHASE_MATCHERS` is the one place to add it.
  Add the tool name to the wiring test in the same change.
