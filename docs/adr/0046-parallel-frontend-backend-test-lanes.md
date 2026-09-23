# ADR-0046 — Cypress and Python Are Parallel Test-Development Lanes

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-21 |
| **Amends** | ADR-0032 (single workspace config and lane markers) |

## Context

ADR-0032 declared the backend checkout a first-class lane and moved `backendRoot` to
`requiredInputs`. The workspace contract and `detectLane()` already honour `backend`.
The setup CLI and the sync projection did not.

`scripts/harness/workspace-setup.mjs` (`LANE_META`) only knew `root`, `e2e`, and
`smoke`. A session whose `.harness/lane.json` said `"backend"` was told to run
`node .harness/setup.mjs`, then that script exited 2: *must declare root, e2e, or
smoke*. The same script still wrote `backendRoot` under `optional`, which
contradicts ADR-0032 and `ONBOARDING.md`.

`syncRuntimeEvidence()` wrote Cypress execution files for `e2e`/`smoke` and
returned for every non-root lane. Backend therefore received only `lane.json`. A
full-stack QA engineer developing pytest coverage could not run the same setup
command a Cypress engineer runs.

Frontend Cypress and backend Python are parallel test-development surfaces for the
same engineer. The runner differs (Cypress vs pytest). The workspace contract,
setup form, and lane bootstrap must not.

## Decision

1. **`backend` is a testing lane, same shape as `e2e` and `smoke`.** `LANE_META`,
   setup error text, `verify-projection.mjs`, and `check-docs-links.mjs` accept
   `root`, `e2e`, `smoke`, or `backend`.

2. **`backendRoot` is a required top-level setup field on every lane.** Setup never
   writes it under `optional`. A leftover `optional.backendRoot` still loads and is
   migrated to the top-level field the next time setup runs.

3. **Each testing lane receives the same bootstrap plus its own runner.**
   - Shared: `.harness/setup.mjs` and `.harness/workspace.example.json`.
   - Cypress (`e2e`/`smoke`): `prepare-execution.mjs` (ADR-0014).
   - Backend: `backend-task-runner.mjs`.
   Root keeps verify, task protocol, and doctors. Those stay central because they
   assume a full `.claude/` projection, which lanes do not carry (ADR-0032).

4. **Preflight treats the backend checkout like a Cypress checkout.** When
   `detectLane()` is `backend`, `backendRoot` must resolve to the current project
   directory, exactly as `e2eRoot` and `smokeRoot` must match their checkouts.

## Consequences

Setup, sync, drift, verify-projection, docs-links, and workspace-contract implement
the decisions above. What does not change: one central `.claude/` at the workspace
root; pytest and Cypress stay task-scoped; smoke remains GET-only; application
source stays read-only.
