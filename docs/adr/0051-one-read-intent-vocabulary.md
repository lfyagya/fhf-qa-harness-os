# ADR-0051 — One Read-Intent Vocabulary for Every Client

| Field | Value |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-09-24 |
| **Relates to** | ADR-0027 (the gates are not agent-writable), ADR-0038 (the deny seam: a refusal only helps if it can be complied with), ADR-0042 (tool vocabulary belongs in the control plane), ADR-0045 (every shell tool is a shell) |
| **Amends** | `engineering.harness.shellInspection` and `engineering.context.readOutput` in the control plane; the read-intent classifiers in `protect-harness-governance.mjs`, `protect-prod-data.mjs` and `context-read-guard.mjs` |
| **Applied by** | `docs/adr/0051-apply.mjs` (owner runs it with `FHF_ALLOW_HARNESS_EDIT=1`) |

## Context

ADR-0045 fixed *wiring*: every shell tool is matched by the shell guards. The matchers are now
right — Claude `Bash`/`PowerShell`, Cursor `Shell` (Cursor maps Claude `Bash` to `Shell` when it
loads `.claude/settings.json`). What is still wrong is *classification*. Two guards decide what
counts as a read, and both decide it in a vocabulary borrowed from one client's habits.

A Cursor Cloud Agent session on this repository (`main` at `e3cf8b1`, 2026-09-24) produced these
refusals, none of which can write anything:

| Command | Refusal |
|---|---|
| `cd /workspace && ls .claude/hooks` | `BLOCKED: that command modifies a harness gate (.claude/hooks/).` |
| `cd /workspace && wc -l config/qa-control-plane.json` | same |
| `cd /workspace && git log -- config/qa-control-plane.json` | same |
| `Read` with `limit: 120` on any file over 2 KB | `BLOCKED: bound this Read to 120 lines or fewer …  Use limit: 120` |

Three separate causes, one shape — the guard asserts a vocabulary the caller does not speak:

1. **Read intent is judged per command, not per step.** `isReadOnlyCommand()` in
   `protect-harness-governance.mjs` rejects any command containing `; & | > < \` $`, then reads
   the *first* token only. Every Cursor `Shell` call arrives as `cd <root> && <command>`, so the
   executable it inspects is `cd` and the chain operator is already disqualifying. PowerShell
   inspection (`Set-Location x; Get-Content y`) and cmd inspection (`cd /d x & type y`) fail the
   same way. `isMetadataOnlyCommand()` in `protect-prod-data.mjs` is the same function with a
   shorter allowlist and the same two faults.

2. **`git` is excluded wholesale.** It is excluded because `git apply` and `git checkout --` write.
   The cost is that `git log`, `git show`, `git diff` and `git blame` on a gate — the exact evidence
   needed to *report* a gate defect instead of editing around it — are refused too.

3. **A client that cannot express a read bound is treated as an unbounded read.**
   `context-read-guard.mjs` requires `tool_input.limit`. Cursor's documented `beforeReadFile`
   payload is `file_path`, `content`, `attachments` — there is no bounds field in the protocol, and
   Cursor fires it ahead of its edit tools as well as its read tool. So in Cursor every file over
   `unboundedReadMaxBytes` (2 KB) is unreadable *and* uneditable, and the remedy the guard prints
   ("use limit: 120") is one the client has no way to send. The agent in the session above could
   not read this repository's own hook sources with the tool built for it.

A refusal an agent cannot comply with is worse than no refusal: it teaches that the harness is
arbitrary, and it pushes every inspection toward the one documented escape — `FHF_ALLOW_HARNESS_EDIT=1`
— which is the *write* opt-in. Reading a gate and rewriting a gate should not share a door.

## Decision

1. **One read-intent vocabulary, in the control plane.** `engineering.harness.shellInspection`
   holds the chain operators, the unsafe-token pattern, the navigation commands, the read-only
   executables (POSIX, PowerShell and cmd in one list), the `git` read subcommands, and the
   metadata-only executables `protect-prod-data.mjs` uses. Both guards read it; neither keeps a
   private allowlist. This is ADR-0042 applied to the other half of the vocabulary: matchers name
   the tools, this names what those tools may say.

2. **Intent is classified per step.** A command is split on its chain operators and every step is
   classified. A command is an inspection when each step is a navigation command, a read-only
   executable, or a `git` read subcommand. One writing step denies the whole command, so
   `cat x | tee .claude/settings.json` and `cd x && sed -i s/a/b/ config/qa-control-plane.json`
   stay refused. Redirects, command substitution, backticks and newlines still disqualify a command
   outright, before any step is looked at: one of those can rewrite the file it is pointed at.

3. **`git` is admitted by subcommand.** `log`, `show`, `diff`, `status`, `blame`, `cat-file`,
   `ls-files`, `rev-parse` and `describe` read. Every other `git` subcommand — `apply`,
   `checkout`, `restore`, `stash`, `clean` — is not in the list and stays refused.

4. **A client that cannot express read bounds is not a violation.**
   `engineering.context.readOutput.boundsUnsupportedClients` names the clients whose read payload
   has no bounds field (`cursor` today, detected by `cursor_version` on the payload).
   `context-read-guard.mjs` allows those reads and prints the bounding advice to stderr instead of
   blocking on it. Clients that *can* bound a read — Claude's `Read` carries `limit` — are gated
   exactly as before.

5. **Nothing about the write path changes.** `protectedPaths`, the default-deny on Edit/Write, the
   interpreter exclusions (`sed`, `node`, `python`), the inline `FHF_ALLOW_HARNESS_EDIT=1` opt-in
   and the production-artifact content denial are untouched. This ADR widens what may be *looked
   at*, never what may be written.

6. **It ships as an apply script.** The classifier, the two guards and the control plane are all
   protected paths, so an agent cannot write them — which is the point of ADR-0027. Following the
   ADR-0030 precedent, the change is `docs/adr/0051-apply.mjs`; it refuses unless the owner has set
   `FHF_ALLOW_HARNESS_EDIT=1`, and the agent must not set that for itself.

## Consequences

- Reading a gate, listing a gate directory and reading a gate's history work from every shell, in
  the shape those shells are actually driven — chained, prefixed with `cd`, or piped into a pager.
- `scripts/harness/test-hooks.mjs` gains cmd, PowerShell and POSIX coverage for the chained and
  prefixed forms, on both guards, alongside the existing single-command cases. Until the apply
  script has run, that block pins the pre-ADR behaviour and names itself as pending, so the
  canonical suite is green before and after and red only on a half-applied tree.
- `scripts/harness/doctor.mjs` explains the read seam next to the refusal it belongs to: the gate
  message now leads with *how to inspect it* before naming the owner opt-in.
- `ONBOARDING.md` documents the same thing for a human: inspect a gate freely, propose a gate
  change in a PR, and never ask an agent to grant itself the opt-in.
- Risk accepted: step-wise classification allows `cd`-prefixed and piped inspections that the old
  single-token rule refused. The allowlist is still closed — an unknown executable in any step
  denies — so widening it remains a control-plane edit, which is itself a guarded change.
- Deliberately out of scope, and recorded here because the audit surfaced it: Cursor exposes
  `Delete` as its own tool type, and neither the generated Claude matcher (`Edit|Write`) nor the
  generated Cursor write matcher names it, so a delete of a gate file runs no write guard. Fixing
  that is a hook-topology change: it edits `PHASE_MATCHERS`, and `check-loader-drift.mjs` compares
  the engine's `.claude/settings.json` byte-for-byte against the template, so the generated file
  must be regenerated in the same change. It needs its own ADR and belongs nowhere near a
  read-intent widening.
- What does not change: the matchers (ADR-0045 already covers Claude `Bash`/`PowerShell` and Cursor
  `Shell`), `protectedPaths`, the generated `.claude/settings.json`, and the owner-override
  mechanism.
