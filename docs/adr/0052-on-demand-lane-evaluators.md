# ADR-0052 — Lane Evaluators Spawn Only When That Lane Changed

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-24 |
| **Amends** | ADR-0030 (every route records `invoke`) |
| **Relates to** | `engineering.context.routes` (`pre-merge`, `engine-pre-merge`, `cypress-pre-merge`) |
| **Applied by** | `docs/adr/0052-apply.mjs` (owner runs it with `FHF_ALLOW_HARNESS_EDIT=1`) |

## Context

Lane-specific pre-merge routes already exist: `backend-pre-merge` and `cross-layer-pre-merge`
match only when the prompt names that lane. The leftover catch-all `pre-merge` matched any
"ready to merge" phrase and always invoked `cypress-gate`.

That is the wrong evaluator for engine, harness-config, and documentation work. On 2026-09-24 a
Cloud Agent asked whether PR #52 (ADR-0051, no Cypress files) was ready to merge. The injected
hint was `Pre-merge → spawn cypress-gate`. The gate returned PASS with most phases N/A. That PASS
does not review hooks, the control plane, or `verify-canonical.mjs`.

The roster already says `cypress-gate` is for PRs that touch Cypress. The route did not.

## Decision

1. Generic `pre-merge` stays in the parent (`invoke.kind` is `parent`). Look at the diff first.
   Cypress specs/config -> spawn `cypress-gate`. Backend pytest -> spawn `qa-automation-gate`.
   Engine configuration (control plane, hook sources, harness scripts, ADRs, framework docs,
   ONBOARDING, CLAUDE.md) -> do not spawn a lane evaluator; run engine verification and answer
   from those exits.
2. `engine-pre-merge` (priority 107) is the engine shortcut: the prompt names a merge check and
   harness/engine/control-plane/hooks/ADR. Invoke is `parent`. Required commands:
   `node scripts/harness/test-hooks.mjs`, `node scripts/harness/doctor.mjs --selftest`,
   `node scripts/harness/verify-canonical.mjs`.
3. `cypress-pre-merge` (priority 108) is the Cypress shortcut: the prompt names a merge check
   and Cypress. Then invoke is `cypress-gate`.
4. "Ready to merge" is not a Cypress signal. Engine configuration work is verified by the
   canonical engine suite, not by an N/A Cypress PASS.

## Consequences

- `is this ready to merge?` → `[router:pre-merge]` + `stay in parent` (then the diff picks the suite).
- `is this harness config ready to merge?` → `[router:engine-pre-merge]` + `stay in parent` + run `verify-canonical.mjs`.
- `is this Cypress spec ready to merge?` → `[router:cypress-pre-merge]` + `spawn agent cypress-gate`.
- Until apply, `test-hooks.mjs` pins today's catch-all spawn and names it pending.

## What this does not decide

It does not change `pull-request` (still `cypress-shipper`). It does not change spawn budget.
