---
paths:
  - "front-end-automation-e2e/**"
  - "front-end-automation-smoke/**"
  - "fhf-backend-automation/**"
  - "docs/**"
---
# Quality Standard — what counts as coverage, evidence, and depth

Applies to every lane. Lane mechanics live in `cypress-standards.md` and `testing.md`; cross-lane
chains in `cross-layer-qa.md`.

## What counts as coverage

A test file, a passing `it()`/`test_`, a stub, or a visible element is not coverage by itself.
Accepted coverage traces five links:

1. **Intent** — the approved business rule, risk, actor, precondition, expected outcome.
2. **Application implementation** — the route/component/service, request, authorization rule, and
   state transition that implement it.
3. **Automation implementation** — the real command path, controlled identity/data, cleanup.
4. **Assertion** — the observable relationship that fails if the business rule is wrong.
5. **Execution evidence** — the right lane ran in the intended environment and left reviewable
   evidence.

A link you cannot show is `UNKNOWN` or `UNVERIFIED` — never inferred from test names or prose.

## Assertion depth by risk

| Risk / intent | Minimum accepted assertion |
|---|---|
| Availability | route shell and required read requests succeed; the expected surface renders |
| Filter / search / sort | request parameters + returned-to-rendered relationship (`cypress-standards.md` interaction contract) |
| Money / calculation | exact decimal, rounding, sign, boundaries, source-to-display and persisted value |
| State transition | baseline state, exact request and result, exact new state, and the prohibited / no-write branch |
| Authorization | allowed actor succeeds **and** denied actor is rejected at the service boundary; a hidden button alone is insufficient |
| File / job / email | request identity, terminal success/failure, the produced artifact or delivery record, duplicate/idempotency behavior |
| Cross-system | one correlation identity traced through every system, plus reconciliation |

`exist`, `visible`, row count > 0, HTTP 200, or a closed modal are structural signals, not
coverage, unless that is the whole approved intent.

### FHF business priorities (auto-loan servicing)

Where FHF's domain concentrates risk (`docs/architecture/domain-context.md`), these outrank
everything else when choosing what to cover and how deep:

- **Payment posting and balances** — a misapplied payment corrupts every downstream balance.
  Money-flow depth, always; the backend lane is the authoritative money oracle.
- **Delinquency queues, filters, counts** — the recurring regression surface. Count == rows and
  API == UI, every time.
- **State-gated servicing actions** (cure, repossession, redemption, notices) — law varies by US
  state. Parameterize state; assert the behavior ("a required cure notice blocks repo"); never
  hardcode day-counts or thresholds that Legal/Compliance haven't confirmed.
- **Lien / title release on payoff** — a missed release is a compliance breach.
- **Complaints and audit trail** — assert the audit/notes record persists, not just the UI toast.
- **Invoice tax and NLS codes** — accounting integrity; exact values.

## Execution evidence minimum

Every recorded run names: lane, environment, run/build ID, automation branch + SHA, deployed
app/service SHA (or `UNKNOWN`), start/end time, and every native result state (passed, failed,
error, skipped, pending, not started, passed-after-retry). A missing field is `UNKNOWN`, never 0.

Group dependent failures under the first failed prerequisite: a failed setup plus 20 blocked
tests is 1 failure + 20 blocked, not 21 defects. Keep raw counts too. A report whose totals
contradict its rows, or that lacks the version/environment to reproduce it, is not used for release
comparison until fixed.

## Quality metrics

Compute only from valid, row-level defects under a frozen query, window, and rubric:

- **Automation discovery rate** = valid defects first found by automation / all valid defects.
- **Pre-production discovery rate** = automatable defects found by automation before production /
  all automatable valid defects.
- **Preventable escape rate** = automatable defects first found in production / all automatable
  valid defects.
- **Accepted risk coverage** = approved in-scope scenarios with accepted evidence / all approved
  in-scope scenarios.
- **Defect traceability** = defects linked to scenario, prevention layer, and evidence / all valid
  defects.

Always publish numerator, denominator, query, window, timezone, rubric version, completeness, and
`asOf`. Never compare periods with different definitions. UI coverage percentages, test counts,
and pass rates are not defect-prevention metrics.

## Application unit/component lane

Owned by the application teams, not these automation lanes: pure money/date calculations,
mappings, guards, validation, reducers, and error branches are cheapest to prove at the source.
When a QA finding is deterministic component logic, recommend a unit test to the owning team
instead of an end-to-end workaround. Service-call coverage alone does not protect component logic.
