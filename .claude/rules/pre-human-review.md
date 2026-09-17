---
paths:
  - ".harness/tasks/**"
  - "front-end-automation-e2e/**"
  - "front-end-automation-smoke/**"
  - "fhf-backend-automation/**"
---
# Pre-human review — every task

This is harness policy for every QA member and every ticket, not a one-off.

Before asking a human to stamp **spec**, **scenarios**, **plan**, or **test-cases**:

1. Stop. Do not write Cypress or pytest.
2. Write `review.<gate>` on the task JSON.
3. For each acceptance row, quote four artefacts already on that task:
   - spec: `grounding.intentVsBuilt`
   - scenario: `plan.tests[].scenarioRef` (YAML group **statement**, not only the prefix)
   - planned test: `plan.tests[].assertion`
   - built: selected application/Oracle path at the frozen SHA
4. `MATCH` only when those four do not contradict. Otherwise name `OVERLAY`, `defect`, `MANUAL`, `PARKED`, or `GAP` with file:sha.
5. If classification is `defect` and the miss is readable from source (missing control, wrong endpoint, SQL vs AC), record `review.proactiveDefects` and tell Dev **before** any run.
6. Do not call these bugs: accepted overlay vs YAML, parked rows, runtime-only claims (need evidence).
7. Protocol `validate` only checks that a cited YAML group exists. It is not this review.

Jira status is not a stamp. Owner path is the client's in-chat confirm, then `stampGate`.
