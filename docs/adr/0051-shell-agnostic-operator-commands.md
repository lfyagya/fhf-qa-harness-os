# ADR-0051 — Operator Commands Are Shell-Agnostic

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-24 |
| **Amends** | ADR-0027 (owner opt-in is a session environment variable), ADR-0045 (every shell tool is a shell) |
| **Relates to** | `ONBOARDING.md`, `scripts/harness/doctor.mjs` |

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

## Consequences

Windows cmd, PowerShell, Linux, and macOS follow the same setup. Cypress npm scripts may still require Git Bash as a *script-shell* on Windows; that is a Cypress/npm constraint, not the operator opt-in language.

A cmd window already sitting in the engine clone runs `set FHF_ALLOW_HARNESS_EDIT=1` then `cursor .`. It does not `cd` to a POSIX placeholder and it does not run `export`.

## What this does not decide

It does not change `protectedPaths`, the opt-in variable names, or which tools the hooks match. It does not make cmd a Cypress test runner.
