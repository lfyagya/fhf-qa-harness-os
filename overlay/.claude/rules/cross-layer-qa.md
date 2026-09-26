---
paths:
  - "front-end-automation-e2e/**"
  - "front-end-automation-smoke/**"
  - "fhf-backend-automation/**"
---
# Cross-Layer QA Workflow

One Jira family may need frontend and backend evidence plus both automation lanes. It is one task
with one builder (`qa-automation-generator`), not two parallel suites.

1. Map every acceptance criterion to its UI, API, and Oracle outcomes. A layer that does not apply
   is NOT_APPLICABLE with evidence; an unknown one is UNKNOWN. Never presume a layer applies or
   passes.
2. Read only the source the ticket reaches, expanding one hop only when an import, API call,
   Oracle contract, or shared component proves the dependency.
3. **Bind the layers at a named seam** — the endpoint contract (method + path) plus a correlation
   key both lanes carry. Cypress owns the half above the seam (the UI reached it; this is what it
   sent). Backend owns the half below (given that request, this API result and this Oracle row).
   Capture the seam request and response in Cypress, not just the UI outcome.
   The test of a correct binding: when the flow fails, the two halves together must distinguish
   "the UI sent an invalid payload" from "the API rejected a valid payload". A pair that cannot
   separate those cannot tell you which team owns the defect, so it is not cross-layer coverage.
   A unit with genuinely no shared seam is NOT_APPLICABLE with evidence — never silently omitted.
4. Run functional tests first, then impacted regression, then the explicitly selected Smoke scope.
5. Report per acceptance criterion: seam, which lane proved which half, native artifact (revision,
   environment, exact test selection, assertion-level result). Unproven seams are reported as
   unproven, not covered.

Production Smoke stays GET-only; backend automation runs Dev/QA only. Never edit application
source.

## Full-chain acceptance (UI → API → DB)

A chain is accepted only when one scenario has all seven:

1. approved intent and a controlled starting state;
2. a real UI mutation (Dev/QA);
3. the exact UI-originated request identity, payload, response, and error branch;
4. a direct service contract check;
5. exact DB state — or verified no-write — under the same correlation identity;
6. downstream reconciliation where money, files, queues, or integrations are involved;
7. cleanup proven successful.

Similar endpoints or two independently passing suites are not a chain.

## Correlation by contract, not by record

The lanes never share test data. Each creates and cleans up its own synthetic identity; they join
on the scenario and the request contract observed at the seam. Every chain test carries one
`chainId` = `<module-key>-<workflow>-<nn>` (module key = the kebab-case module directory, e.g.
`loss-mitigation-repo-assign-01`): in Cypress scenario metadata beside `jiraId`/`ac`, in the pytest
docstring. No `chainId` → single-lane evidence, never reported as chain progress.

Who owns what:

- **Cypress:** actor reaches the control under the real role; rendered authorization state;
  client-side validation; the request the action emits (the seam); the status and outcome the UI
  shows. It never asserts DB state.
- **pytest:** service-side authorization and validation; exact persisted state; the prohibited
  branch writes nothing; money/date/status at field precision (the authoritative money oracle);
  downstream reconciliation; idempotency. It never asserts rendering.
- Both: response status and error branch, independently; cleanup of their own identity.

## Seam artifact and verdict

Cypress writes, and pytest completes, `cypress/handoff/chain-contract/<chainId>.json`
(`fhf-chain-contract/v1`): scenario identity and spec status, `observedRequest` (method, URL
template with params masked, payload fields/types/business values), `observedResponse`,
`uiOutcome` (incl. prohibited outcome) — then `assertedRequest`, `persistedState`,
`noWriteBranch`, `reconciliation` (or `not-applicable` + reason), and per-lane `automationSha`,
`runId`, `evaluatedAt`. No customer data, credentials, or production values.

A chain is `ACCEPTED` only when both halves exist for the same `chainId` and agree on endpoint,
method, payload schema, status, and every shared business field. A disagreement is a finding,
never a reason to relax the stricter side:

| Disagreement | Owner |
|---|---|
| UI emits a field pytest never asserts | backend lane extends coverage |
| pytest asserts a field the UI never emits | product owner classifies first |
| Same endpoint, different payload shape | application owner (integration defect) |
| Same payload, different status expectation | reconcile against the approved contract, not the other test |

Neither lane may assume the other ran, ran green, or ran the same deployed version; that a green
sibling replaces its own missing assertion; or that the other lane cleaned up its data.
