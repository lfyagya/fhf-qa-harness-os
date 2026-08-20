# ADR-0014 - Executable Lane Worktrees

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-19 |

## Context

The committed E2E and Smoke projections make a clone source-ready, but a Git worktree does not
contain its machine-specific workspace paths, dependency runtime, authentication configuration, or
Cypress Cloud recording configuration. A structural verifier can therefore pass while Cypress still
fails before any test due to missing credentials.

## Decision

Generate a lane-local execution-preparation command and execution-profile example. The named
profile is stored outside the worktree and supplies only local paths: FHF/spec workspaces, an existing dependency runtime, and
explicit credential-file sources. The command validates the lane, configured package, and required
baseline branch and configured base-URL reachability; writes ignored workspace paths; links dependencies when missing; copies only the
explicitly named ignored credential files; then runs the consumer verifier.

Cloud preparation additionally requires an explicitly named `.npmrc` source. Profiles are lane
specific: E2E requires `dev`; Smoke requires `staging` and retains its GET-only policy. The command
never reads or prints credential values, runs no test itself, and refuses any credential target that
Git does not ignore.

## Consequences

- `node .harness/verify.mjs` remains a source/workspace-contract verifier, not a claim that Cypress
  can authenticate or record to Cloud.
- `node .harness/prepare-execution.mjs --profile <external-profile> --mode <local|cloud>` is the
  explicit executable-worktree readiness gate.
- Credentials and machine paths remain uncommitted and cannot be silently borrowed across lanes.
- A later Cloud test run is valid execution evidence only after this readiness gate succeeds.
