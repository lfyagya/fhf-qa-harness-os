# ADR-0051 — Operator Commands Are Shell-Agnostic

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-24 |
| **Amends** | ADR-0027 (owner opt-in is a session environment variable), ADR-0045 (every shell tool is a shell) |
| **Relates to** | `ONBOARDING.md`, `scripts/harness/doctor.mjs`, `scripts/harness/test-hooks.mjs`, `protect-harness-governance.mjs`, `protect-prod-data.mjs`, `context-read-guard.mjs` |
| **Applied by** | `docs/adr/0051-apply.mjs` (owner runs it with `FHF_ALLOW_HARNESS_EDIT=1`) |

## Context

Harness setup and the gate opt-in (`FHF_ALLOW_HARNESS_EDIT`, `FHF_ALLOW_PROD_DATA`) were written as POSIX snippets: `export VAR=1`, `cd ~`, fenced as `bash`. That is valid on Linux and macOS. It is not valid in Windows `cmd.exe` (`export` is unrecognized; `/path/to/...` is a placeholder, not a folder). PowerShell uses `$env:VAR = "1"`.

ADR-0045 already treats Bash, PowerShell, and Cursor `Shell` as the same write surface. The human docs did not. A member on cmd who followed the printed `export` line could not opt in, even though `set VAR=1` is the correct command and the hook regex already matches `FHF_ALLOW_HARNESS_EDIT=1` on that line.

The engine must not pick a house shell. Linux, macOS, and Windows members use the same `node` and `git` commands; only environment assignment and path separators differ.

## Decision

1. **Canonical commands are `node` and `git`.** They are the same in bash, zsh, PowerShell, and cmd. Setup steps that do not assign environment variables are not fenced as `bash`.
2. **Paths are "from this clone", not `~/`.** The engine clone and the `FHF` workspace live wherever the member cloned them. `~/fhf-harness-os` is one POSIX example, not the required location.
3. **Environment assignment is documented for three shells**, and all three are first-class:

   | Shell | Command |
   |---|---|
   | POSIX (Linux, macOS, Git Bash) | `export FHF_ALLOW_HARNESS_EDIT=1` |
   | PowerShell | `$env:FHF_ALLOW_HARNESS_EDIT = "1"` |
   | cmd.exe | `set FHF_ALLOW_HARNESS_EDIT=1` |

   Then relaunch the agent from **that same** terminal (or set the variable on the Cloud Agent environment and start a new run). Chat text and an agent `export`/`set` cannot grant Edit/Write; only the process environment can (ADR-0027).
4. **Doctor and gate copy name the variable, then the three assignment forms.** They do not print only the POSIX line.

5. **Read intent is classified per step, in one control-plane vocabulary.**
   `engineering.harness.shellInspection` names the chain operators, the tokens that
   disqualify a command, the navigation commands, the POSIX/PowerShell/cmd readers,
   the `git` read subcommands, and the metadata-only list `protect-prod-data.mjs` uses.
   A command is an inspection when every step is one of those. One writing step denies
   the whole command. `cd <root> && ls .claude/hooks`, `Set-Location x; Get-Content y`
   and `cd /d x & type y` are therefore reads, not writes. `git log` / `show` / `diff`
   / `status` / `blame` read; `git apply` / `checkout` / `restore` still write.

6. **A client that cannot express a read bound is not a violation.**
   `engineering.context.readOutput.boundsUnsupportedClients` names those clients
   (`cursor` today). `context-read-guard.mjs` advises on stderr and allows the read.
   A client that can send `limit` is gated as before.

7. **The control plane and the three guards are protected paths.** They land through
   `docs/adr/0051-apply.mjs`, which refuses unless the owner has already set
   `FHF_ALLOW_HARNESS_EDIT=1` on the agent process. `--target <copy>` previews the
   patch without the opt-in. The agent must not set the variable for itself.

## Consequences

Windows cmd, PowerShell, Linux, and macOS follow the same setup. Cypress npm scripts may still require Git Bash as a *script-shell* on Windows; that is a Cypress/npm constraint, not the operator opt-in language.

A cmd window already sitting in the engine clone runs `set FHF_ALLOW_HARNESS_EDIT=1` then `cursor .`. It does not `cd` to a POSIX placeholder and it does not run `export`.

The apply script is the remaining half of this ADR: operator docs can land without the opt-in; the classifier, the two shell guards and the read guard cannot. Until it runs, `test-hooks.mjs` pins today's chained-inspection refusals and names them pending.

## Evidence

Session 2026-09-24, Cursor Cloud Agent on this branch, both guards driven directly with client
payloads (`/opt/cursor/artifacts/adr-0051-read-guard-repro.log`). Before, against the engine clone;
after, against a `--target` copy.

| Case | Before | After |
|---|---|---|
| Claude `Read`, `limit: 80` | allow | allow |
| Claude `Read`, no limit | block | block |
| Cursor `Read`, agent asked for `limit: 80` | **block** | allow, advice on stderr |
| Cursor pre-edit read of a file that does not exist yet | **block** | allow, advice on stderr |
| `cd <root> && stat <gate>` | **block** | allow |
| `cd <root> && git log -- <gate>` | **block** | allow |
| `type <gate>` (cmd) | **block** | allow |
| `cd <root> && echo x > <gate>` | block | block |
| `cat <gate> && rm <gate>` | block | block |

The pre-edit case has the widest blast radius: Cursor reads a file before its own edit tools, so an
unpatched session cannot create a new file at any size, and cannot edit an existing file over
`unboundedReadMaxBytes` - including files the harness does not protect. The refusal prints "use
`limit`", advice the client has no field to follow. `test-hooks.mjs` (259 assertions) and
`check-hook-order.mjs` both pass on the patched copy.

## What this does not decide

It does not change `protectedPaths`, the opt-in variable names, or which tools the hooks match (ADR-0045 already covers Claude `Bash`/`PowerShell` and Cursor `Shell`). It does not make cmd a Cypress test runner. Cursor `Delete` as a write-matcher gap is a separate hook-topology change.
