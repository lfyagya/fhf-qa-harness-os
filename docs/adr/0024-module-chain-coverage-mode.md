# ADR-0024 — Module Chain Coverage Mode

| Field | Value |
|---|---|
| **Status** | Accepted; seam validation implemented |
| **Date** | 2026-09-03 |

## Context

The harness models cross-layer QA on one axis: a Jira family changed something, so verify that
change across the layers it touched. `.claude/rules/cross-layer-qa.md` and
`.claude/agents/qa-automation-generator.md` already define the correct binding for this — one
manifest, one specialist, and coverage bound by a named **seam** (endpoint contract plus a
correlation key both lanes carry), with the explicit standard that two single-layer suites over the
same acceptance criteria are not cross-layer coverage.

A standing module coverage initiative is the other axis. UniFi is the first: cover the module as a
whole across UI, API, and Oracle, driven by business workflow rather than by a diff. Four gaps block
that today.

1. **The seam is prose, not schema.** `scripts/harness/task-protocol-lib.mjs` validates
   `plan.changeUnits` for `id`, `repoId`, `dependsOn`, `paths`, and dependency cycles. There is no
   `seam` field and no validation of one. The live manifest `.harness/tasks/serv-12416-fe-baseline.json`
   contains none of `seam`, `correlation`, `endpoint`, `oracle`, or `chain`. The generator is
   instructed to name a seam; nothing checks that it did.
2. **The seam does not survive the task.** `.harness/tasks/` is git-excluded and transient, so the
   binding an agent reasoned about is discarded when the task ends.
3. **The chain artifact does not exist.** The `full-chain` route reads
   `docs/planning/coverage/fullstack-chain-risk-matrix.md`. `docs/planning/` contains only
   `data-cy-hook-backlog.md`, and `scripts/harness/check-docs-links.mjs` already fails on the path.
   The one route that answers "is this module covered end to end" dead-ends.
4. **Coverage is per-lane presence, not chain linkage.** `docs/evidence/coverage-computed.json`
   carries `e2e`, `smoke`, and `backendEvidence` side by side. UniFi reads `FULL` on e2e (19 spec
   files, 183 its, `jiraMapped: 0`) and `PARTIAL` on backendEvidence (client, tests, contract, db
   present). Nothing binds a UniFi workflow to an endpoint to an Oracle object, so the ledger cannot
   distinguish a covered chain from the two parallel suites the rule forbids. `api` in the e2e rubric
   means Cypress interception, not the backend lane.

The ledger also collapses `unifi` to one module while the real surface is
`uni-fi/{collection/{contact-log,detail-page,payment-page},servicing}` in E2E,
`tests/unifi/{e2e,integration}` in backend, and seven product contracts under
`moduleSpecPaths.unifi`. A module-level `FULL` can mask an uncovered workflow.

Airflow DAGs are named once in `docs/framework/qa-control-plane.md` as an independent oracle. No
rubric has a DAG layer. Whether automation can assert DAG state from Dev/QA is unconfirmed.

## Decision

Add a coverage-driven mode alongside the existing change-driven mode, keyed on business workflow.

1. **`seam` becomes a validated field on `plan.changeUnits`.** A change unit selecting both a
   frontend and a backend repository must carry `{endpoint, correlationKey}`, or be explicitly
   `NOT_APPLICABLE` with evidence. The validator rejects a silent omission. This makes the existing
   rule machine-checkable rather than advisory.

2. **Coverage-driven grounding is the product contract, not the diff.** In change-driven mode
   `grounding.intentVsBuilt` stops a source-only behavior from being encoded as intended. Covering
   existing behavior carries the mirror risk: encoding what the code currently does as though it were
   what the business requires. The contract files under `moduleSpecPaths.<module>` are the authority
   for that mode, and a workflow with no contract row is `UNKNOWN`, never assumed correct.

3. **The chain ledger is keyed by workflow, not module,** and is derived rather than
   hand-maintained. `scripts/harness/generate-coverage.mjs` already walks both Cypress lanes and the
   backend lane; it is extended to emit the chain projection. This fixes the granularity mismatch in
   the same change.

4. **DAGs are recorded as `UNKNOWN`, not omitted and not assumed.** DAG assertion access from
   Dev/QA is unconfirmed as of this date. An `UNKNOWN` row states the limit; an absent row would
   read as "no gap" and an empty column would read as "gap". Revisit when access is established.

## Consequences

Changes required:

- `scripts/harness/task-protocol-lib.mjs` — `seam` validation on cross-repository change units.
- `config/qa-control-plane.json` — coverage-driven mode and the chain projection target.
- `scripts/harness/generate-coverage.mjs` — emit the workflow-keyed chain projection.
- `docs/planning/coverage/fullstack-chain-risk-matrix.md` — generated, resolving the dead `full-chain`
  route and one `check-docs-links` failure.
- `.claude/rules/cross-layer-qa.md` and `.claude/agents/qa-automation-generator.md` — cite the
  validated field instead of describing the seam as a convention.

Explicitly not changed:

- Hook topology and the agent roster. `qa-automation-generator`, `qa-automation-gate`, and
  `qa-automation-debugger` already own the cross-layer phases; this adds no agent.
- The application source boundary, the Smoke production GET-only rule, and the backend Dev/QA
  restriction.
- Backend task-scoping. Writes and pytest runs still require a validated `FHF_ACTIVE_TASK`; this
  decision changes what a manifest must *state*, not what a lane may *do*.
- Cypress and pytest architecture. Each lane keeps its own standards.
