# FHF Testing Standard

> Studio AI / `cy.prompt`: discovery-only in E2E scratch — see harness `.claude/rules/studio-ai-policy.md` and `docs/framework/triage-runbook.md`. Never against production smoke.

**Owner:** QA engineering  
**Scope:** Cypress E2E, production Smoke, backend API/database automation, and evidence acceptance  
**Last source audit:** 2026-08-04

## What counts as coverage

A test file, an `it()`/`test_` block, a pass, a stub, or a visible element is not product coverage
by itself. An accepted scenario traces all of these:

1. **Intent** — the approved business rule, risk, actor, precondition, and expected outcome.
2. **Application implementation** — the route/component/service, request, authorization rule, and
   state transition that implement the intent.
3. **Automation implementation** — the real command path, controlled identity/data, service mode,
   and cleanup.
4. **Assertion** — the observable relationship that would fail if the business rule were wrong.
5. **Execution evidence** — the accepted lane ran in the intended environment and produced
   reviewable evidence.

If any link is unknown, label it `UNKNOWN` or `UNVERIFIED`; do not infer it from test names or
documentation prose.

### Execution evidence minimum

Every recorded run must identify lane, environment, run/build ID, automation branch and SHA,
deployed application/service SHA, start/end time, and every native result state: passed, failed,
broken/error, skipped, pending, timed out/not started, and passed after retry. If a source omits a
field, record it as `UNKNOWN`; do not convert it to zero.

Group dependent results under the first failed prerequisite. A failed setup followed by 20 missing
state failures/skips is one primary failure plus 20 blocked descendants, not 21 defects. Preserve
the raw native counts as well as the dependency classification.

An email summary, Cloud overview, JUnit file, or Allure report is incomplete evidence when its
totals contradict its suite rows or it omits the version/environment identity needed to reproduce
the run. Record the contradiction and do not use the artifact for release comparison until fixed.

### Machine-readable CI evidence contract

Each E2E, Smoke, and backend CI build must publish one normalized `qa-run-evidence.json` artifact
in addition to its native JUnit, Cypress Cloud, or Allure evidence. Native artifacts remain the
audit source; the normalized file is the cross-lane join contract and must never replace them.

| Object | Required fields |
|---|---|
| Run identity | `schemaVersion`, `runId`, `buildId`, `lane`, `environment`, `startedAt`, `finishedAt`, `generatedAt` |
| Source identity | automation repository, branch, full SHA; deployed application/service name and full SHA or immutable build/version ID |
| Result totals | every native state with its denominator: passed, failed, broken/error, skipped, pending, timed out/not started, passed after retry |
| Scenario result | `scenarioId`, `jiraId`, acceptance-criteria ID, test ID/title, module, workflow, evidence level, native status, normalized status, duration, artifact link |
| Dependency result | `primaryFailureId` and `blockedBy` for descendants; absent when the result is independent |
| Mutation evidence | synthetic correlation identity, baseline, request/result evidence reference, prohibited/no-write result, cleanup status and evidence reference |
| Classification | failure category, classifier (`rule` or reviewed human), classification timestamp, and reviewer when human-reviewed |

Normalized status is one of `passed`, `primary_failed`, `blocked`, `broken`, `skipped`, `pending`,
`timed_out`, `not_started`, or `passed_after_retry`. Preserve the native status alongside it.
Never infer a product defect from a failed test. Never store credentials, customer payloads, or raw
production identifiers in this artifact; use synthetic IDs or approved redacted evidence links.

CI must fail its evidence gate when a release-comparison build omits its lane, environment,
build/run ID, automation SHA, deployed-system version, timestamps, result denominators, or native
artifact links. A missing source is `UNKNOWN`, not zero. Initially, scenario metadata completeness
may be ratcheted from the selected P0 workflows; a scenario cannot be reported as accepted coverage
until all required fields are present.

### Defect-prevention evidence contract

CI execution evidence and defect evidence are separate datasets. CI can prove what executed and
failed; it cannot decide that a failure became, prevented, or explains a production defect. The
defect row is classified from the issue record and reviewed evidence, then joined to CI by the
scenario, test, run, and immutable source identities.

| Field | Required rule |
|---|---|
| `defectId` | stable SERV/TSP key or approved incident key |
| `defectType` | valid product defect, invalid/not-a-bug, environment, data, or automation defect |
| `module`, `workflow`, `scenarioId` | canonical module/workflow and approved scenario; `UNMAPPED` with an owner when not yet known |
| `impact` | customer, financial, compliance/control, operational, and severity evidence |
| `environment` | first affected environment; production must be explicit |
| `detectionSource` | `automation`, `manual_qa`, `developer`, `customer_support`, `monitoring`, or `other` |
| `firstDetectionStage` | `pre_merge`, `dev`, `qa`, `staging`, or `production` |
| `rootCauseCategory` | reviewed cause such as product logic, API contract, persistence, UI integration, authorization, deployment, data, performance, or automation oracle |
| `earliestPreventionLayer` | unit/component, API contract, API/database, E2E, reconciled full chain, production Smoke, monitoring, or out of scope |
| `existingTestId` | exact test/scenario ID that already protected the behavior, or `NONE` |
| `evidence` | defect URL, CI run/build URL, native test artifact, automation SHA, deployed-system SHA/version, and relevant accepted-chain row |
| `classification` | status (`unreviewed`, `reviewed`, `disputed`), reviewer, reviewed timestamp, and rubric version |

Under the agreed Jira label policy, the `Automation` label records `detectionSource = automation`.
The label does not record `firstDetectionStage`; only that stage plus the detection source can prove
that automation found a defect before production.

### Reproducible quality metrics

Calculate metrics only from row-level defects that pass the frozen query/window/rubric and the
required-field completeness gate:

- **Automation discovery rate** = valid defects first detected by automation / all valid defects.
- **Pre-production automation discovery rate** = valid defects first detected by automation before
  production / all valid defects classified automatable.
- **Preventable escape rate** = automatable valid defects first detected in production / all valid
  defects classified automatable.
- **Accepted risk coverage** = approved in-scope scenarios with accepted evidence / all approved
  in-scope scenarios.
- **Defect traceability** = valid defect rows with reviewed scenario, prevention layer, and exact
  evidence links / all valid defect rows.

Always publish numerator, denominator, query, window, timezone, rubric version, completeness rate,
and `asOf` time. Do not compare periods when those definitions differ. Do not turn UI interaction
coverage, structural inventory, tests passed, or Jira labels into defect-prevention coverage.

## Configured assurance gate

The binding machine policy is `.claude/harness.config.json` `qualityAssurance`, projected from the
canonical harness. It defines the coverage unit, required evidence chain, accepted product-contract
status, lane safety, false-green rejection, mutation lifecycle, and full-chain acceptance. Agents
and hooks must fail closed when this policy is missing or invalid.

`metricThresholds` are operational reporting thresholds only. UI Coverage, Jira mapping, file
presence, or execution age does not establish accepted product-risk coverage.

## Source order

Product intent comes from one source:

1. the team-owned `Test-Case-Automation-Using-Claude-Agents/specs` contract, including inherited
   component/common-data sources, status, provenance, and explicit unknowns;
2. an approved ticket or acceptance decision changes intent only after it is incorporated into
   that product contract;
3. current application source and observed API/database behavior verify implementation and expose
   conflicts, but do not silently replace the product contract;
4. the industry/regulatory blueprint is a **candidate risk**, never proof FHF implements it;
5. existing automation and historical documents are discovery evidence only.

When implementation and the product contract disagree, record the conflict and obtain an owner
decision; do not choose whichever source makes the test pass.

The team-owned specification repository is the sole product source of truth. Its 41 active module
contracts and 10 component contracts currently declare `status: draft`; shared-data files may omit
status. Source ownership does not convert draft or explicitly unconfirmed content into approved
intent, so preserve those qualifications in tests and reporting.

## Scenario Object Format

Every new or modified scenario must contain every key configured in
`qualityAssurance.scenarioRequiredFields`:

- trace: `id`, `jiraId`, `ac`;
- intent: `name`, `type`, `given`, `when`, `then`, `priority`, `testType`, `riskCategory`, `impact`;
- provenance: exact `productSpec`, its `productSpecStatus`, and exact `applicationEvidence` paths;
- oracle: `assertions`, including the prohibited outcome where applicable.

A scenario against a draft contract may be reported as structural or implementation evidence; it
is not accepted product coverage. Do not infer `approved` from ownership, Jira presence, source
code, or a passing run.

## Structure

Each test is one Arrange → Act → Assert pass:

- **Arrange:** authenticate the correct actor, establish controlled state, register intercepts.
- **Act:** perform the real user/API action once.
- **Assert:** prove the required outcome and prohibited outcome at the right layer.
- **Cleanup:** restore persistent state with an explicit, verified mechanism.

Test titles state actor + behavior + outcome. Comments explain business risk or a non-obvious
oracle; they do not restate commands.

`testIsolation: true` resets browser state only. It does not restore server, database, queue,
email, file, or vendor state.

### Current Cypress implementation

- E2E specs live under `front-end-automation-e2e/CypressFHF/fhf-dashboards/
  cypress/tests/fhf-dashboard/e2e/`; production Smoke specs live under the corresponding
  `front-end-automation-smoke/.../cypress/tests/fhf-dashboard/smoke/` path. Follow the target lane's
  existing sibling layout; the two repositories are not required to mirror one invented tree.
- Reuse `cypress/configs/**` and `cypress/support/commands/**` before adding a selector, endpoint,
  alias, route, or command. Specs orchestrate; configuration and reusable mechanics stay with
  their existing owner.
- Register the relevant intercept before navigation or the action that sends the request. Pass the
  full API config entry to `cy.apiWait()` when status and configured response-contract validation
  are required. A plain alias string cannot supply those entry-level contracts.
- Both current API engines assert the configured status by default. Required-field/data validators
  run only for a present response body and a full config object; do not report automatic schema or
  business validation beyond what that entry actually declares.
- No generic `cy.seed*`/`cy.cleanup*` lifecycle is implemented across the audited E2E and Smoke
  repositories. A mutation scenario is accepted only with a source-verified workflow-specific
  setup and cleanup path.
- Do not create placeholder `describe.skip()` suites to represent missing coverage. Record the gap
  in computed structural evidence or the planning ledger; disabled tests are not accepted coverage.

## Assertion depth

| Risk / intent | Minimum accepted assertion |
|---|---|
| Availability | route shell and the required read request succeed; the expected surface renders |
| Filter/search | request parameters plus returned-to-rendered relationship; not only status 200 |
| Sort | known values or a proven monotonic order after the actual sort request |
| Calculation/money | exact decimal, rounding, sign, boundary, and source-to-display/persisted value |
| State transition | baseline state, exact request identity/payload/result, exact new state, prohibited/no-write branch |
| Authorization | allowed actor succeeds and denied actor is rejected by the service boundary; hidden UI alone is insufficient |
| File/job/email | request identity, terminal success/failure, produced artifact or delivery record, and duplicate/idempotency behavior |
| Cross-system | one correlation identity traced across every participating system plus reconciliation |

Prefer exact values, sets, order, schema, and before/after relationships. `exist`, `visible`, row
count greater than zero, HTTP success, or modal disappearance are structural signals unless that
is the full approved intent.

## Interactive Control Coverage

### Interaction Impact Tag

Scenario metadata may classify an interaction as `critical`, `high`, `medium`, or `low` and name
its `riskCategory`.

- `critical`/`high`: one test performs the real interaction and asserts its business relationship.
- `medium`/`low`: a shared render/interaction sweep is sufficient only when no material result
  contract exists.
- Do not add a second render-only test when the behavioral test already exercises the control.
- If runtime data cannot prove the relationship, fail with diagnostics or provision deterministic
  data; never log "Skipping" and pass.

## Lane contracts

### Production Smoke

Purpose: detect deployed availability, authentication, authorization rendering, read-contract,
and response-to-DOM regressions safely.

- GET/read-only and metadata-only after authentication.
- No business POST/PUT/PATCH/DELETE, uploads, downloads containing customer data, messages, or
  mutation-adjacent typing/clicking.
- No pinned customer values or copied production payloads. Assertions may compare a live GET
  response to its rendered DOM relationship without persisting the payload.
- Do not suppress uncaught application exceptions globally.
- Do not convert missing data, authorization failures, API failures, or selector failures into a
  pass. An intentionally inapplicable scenario is excluded before execution with an owned reason.

Smoke execution scheduling and repository promotion are owned by the actual CI configuration;
do not claim an hourly/deploy frequency or a canonical code source unless that wiring is verified.

### E2E

Purpose: prove approved user behavior and state transitions in Dev/QA with synthetic, controlled
data.

- Use a uniquely identifiable synthetic record for every persistent workflow.
- Register the relevant request before the action; wait for and assert that request/result.
- Assert the business outcome, denied/no-write branch, and cleanup.
- A fixture reset is not application-state cleanup.
- A stubbed mutation is contract/component evidence only; it is not real workflow evidence.
- A real mutation against an arbitrary existing record is not accepted when ownership, baseline,
  reversibility, or cleanup is unknown.

### Backend API/database

Purpose: prove service contracts, authorization, validation, persistence, reconciliation, and
idempotency with authorized synthetic data.

- Correlate the response identity to exact database state.
- Assert forbidden/invalid requests leave no write.
- Use precise money/date/status oracles; do not rely on row existence alone.
- Clean up created state or use an approved reversible fixture lifecycle.
- Ordered tests sharing in-memory IDs are one fragile workflow; a skip caused by missing prior
  state is not accepted evidence.

### Application unit/component

Purpose: close deterministic logic cheaply at the source: money/date calculations, mappings,
guards, validation, reducers, and error branches.

Service-call coverage alone does not protect component logic, authorization rendering, or workflow
composition. Prioritize pure and boundary-heavy product rules before snapshots.

## Full-chain acceptance

UI → API → database evidence is accepted only when one scenario has:

1. an approved intent and controlled starting state;
2. a real UI mutation;
3. the exact UI-originated request identity, payload, response, and error branch;
4. a direct service contract check;
5. exact database state or verified no-write using the same correlation identity;
6. downstream reconciliation where money, files, queues, or integrations are involved;
7. explicit cleanup proven successful.

Separate UI and backend suites can support the chain only when they are deliberately correlated to
the same controlled scenario. Similar endpoints or independent passing tests are not a full chain.

## Cross-lane validation split

Two engineers own two halves of one scenario: Cypress covers the actor through the API boundary,
pytest covers the API boundary through Oracle and downstream. This section is the contract between
them. It exists so the two halves compose into one chain without sharing a database row.

### Correlation is by contract, not by record

The lanes do **not** share test data. Each lane creates and cleans up its own synthetic identity.
They are correlated by an approved scenario ID and by the **request contract observed at the API
boundary** — the seam both lanes touch.

This matters because sharing a row couples the two suites into one fragile ordered workflow, which
this standard already rejects. Sharing a contract keeps each lane independently runnable while still
proving the chain: if the request Cypress actually emitted is the request pytest actually persisted,
the two halves join.

```text
   Cypress (dev/qa, synthetic record A)         pytest (dev/qa, synthetic record B)
   actor action ─▶ request emitted ─────▶ [ chain seam ] ─────▶ same contract replayed ─▶ Oracle state
                   UI outcome asserted     endpoint, method,      exact persistence asserted
                                           payload schema,        prohibited branch = no write
                                           status, business       downstream reconciliation
                                           field values
```

### Chain identity

Every scenario in a chain carries one `chainId` in both lanes:

- Cypress: `chainId` in the scenario metadata alongside the existing `jiraId`/`ac` fields.
- pytest: `chainId` in the test docstring alongside the existing `[C<id>]` TestRail marker.

`chainId` format is `<module-key>-<workflow>-<nn>`, using the module keys in
`.harness/config.json` `moduleAliases` so selection, coverage, and this ledger share one vocabulary.
A test with no `chainId` is single-lane evidence and must not be reported as chain progress.

### Responsibility split

| Assertion | Cypress e2e owns | pytest owns |
|---|---|---|
| Approved intent exists and is `approved` | reads it | reads it |
| Actor can reach the control under the real role | yes | no |
| Control is enabled/disabled per the authorization rule as rendered | yes | no |
| Client-side validation and error copy | yes | no |
| The request the real action emits: endpoint, method, payload shape and business values | **yes — this is the seam** | consumes it |
| Response status and error branch as the UI receives it | yes | yes, independently |
| The user-visible outcome after the response | yes | no |
| Service-side authorization: forbidden request is rejected | no | yes |
| Server-side validation: invalid payload is rejected | no | yes |
| Exact persisted state under the same correlation identity | no | **yes** |
| Prohibited branch leaves no write | no | yes |
| Money, date, timezone, status oracles at field precision | renders only | **yes — authoritative** |
| Downstream reconciliation: ledger, vendor, queue, file, email | trigger only | yes |
| Idempotency and duplicate submission | UI guard only | yes |
| Cleanup of its own synthetic identity | yes | yes |

Two rules follow from the table and are not negotiable:

1. **Cypress does not assert database state, and pytest does not assert rendering.** A Cypress test
   that reads Oracle, or a pytest test that asserts DOM, has taken the other lane's responsibility
   without the other lane's controls.
2. **Money and date correctness is the backend lane's oracle.** Cypress asserts that the value it
   displays equals the value the response returned. Whether that value is *correct* is proved
   against the database and the ledger, at field precision, in pytest.

### The seam artifact

Cypress publishes what it observed at the boundary; pytest declares what it asserted against.

`cypress/handoff/chain-contract/<chainId>.json`, schema `fhf-chain-contract/v1`:

| Field | Written by | Meaning |
|---|---|---|
| `chainId`, `jiraId`, `productSpec`, `productSpecStatus` | Cypress | scenario identity and approval state |
| `observedRequest` | Cypress | method, URL template with params masked, payload field names, types, and business values |
| `observedResponse` | Cypress | status, and the response fields the UI actually rendered |
| `uiOutcome` | Cypress | the asserted user-visible result, and the prohibited outcome checked |
| `assertedRequest` | pytest | the contract the backend test exercised |
| `persistedState` | pytest | schema/table/view, correlation column, and the fields asserted |
| `noWriteBranch` | pytest | the forbidden request proved not to write |
| `reconciliation` | pytest | downstream state asserted, or `not-applicable` with a reason |
| `automationSha`, `runId`, `evaluatedAt` | both | provenance, one entry per lane |

No customer payload, credential, or production value may appear in this artifact.

### Chain verdict

A chain is `ACCEPTED` only when both lanes have written their half for the same `chainId` **and**
the two halves agree on endpoint, method, payload schema, status, and every shared business field.

| Disagreement | Meaning | Owner |
|---|---|---|
| Cypress emits a field pytest never asserts | untested contract surface reachable from the UI | backend lane extends coverage |
| pytest asserts a field the UI never emits | dead or undocumented contract, or a missing UI path | product owner classifies before either lane changes |
| Same endpoint, different payload shape | real integration defect | application owner |
| Same payload, different status expectation | one lane's expectation is stale | reconcile against the approved contract, not against the other test |

A disagreement is a finding, never a reason to relax the stricter assertion. Neither lane may change
its expectation to match the other lane without the product contract confirming which is correct.

### What neither lane may assume

- that the other lane ran, ran green, or ran against the same deployed version;
- that a passing sibling lane substitutes for its own missing assertion;
- that a shared endpoint name means a shared workflow;
- that one lane's cleanup cleaned up the other lane's data.

Each half must be independently runnable and independently meaningful. The chain is the join, not
the source, of either lane's value.

## False-green controls

Block acceptance when a scenario:

- calls `this.skip()`/`pytest.skip()` because required state was not created;
- logs a skip/data-unavailable message and omits the assertion;
- swallows application exceptions;
- asserts only a stubbed response for a claimed real workflow;
- mutates an existing shared record without ownership and cleanup;
- relies on test order or a previous spec's fixture write;
- treats browser `testIsolation` as backend cleanup;
- reports structural inventory as business-risk coverage.

Disabled suites and fallback/skip markers must be visible in generated structural evidence and
resolved scenario by scenario.

## Product-quality matrix

For each material workflow maintain one canonical row with:

| Field | Required content |
|---|---|
| Product intent | approved source/status, actor, rule, financial/customer/control risk |
| Application path | route/component/service, endpoint, authorization and state owner |
| Test implementation | lane, spec/test, command path, real/stubbed service, controlled data |
| Assertion | exact oracle and prohibited outcome |
| Evidence level | structural, UI read, UI mutation, API contract, database, reconciled full chain |
| Gap | the first missing link, not a generic "needs more coverage" statement |
| Release consequence | block, conditional accept, monitor, or out of scope with owner |

The canonical accepted-chain rows live in
`docs/planning/coverage/fullstack-chain-risk-matrix.md`. Structural presence lives in generated
`docs/evidence/coverage-computed.json` and must never use the word "full" without "structural".

## Planning order

Prioritize by potential customer/financial/control loss and earliest prevention point:

1. credential exposure, authorization bypass, production mutation, and irreversible data risk;
2. false-green removal and controlled test-data lifecycle;
3. money/state P0 workflows with missing no-write, database, reconciliation, or cleanup proof;
4. read-contract and high-impact interaction gaps;
5. lower-risk rendering and duplication cleanup.

Do not estimate portfolio completion from test counts or structural layers. Estimate only an
approved scenario slice whose dependencies, data owner, environment, and acceptance evidence are
known.

## Review gate

Before accepting or reporting a test, the reviewer answers:

- What exact product rule and risk does it protect?
- Where is that rule implemented today?
- Does the automation call the same logic and service mode?
- Which assertion proves the rule and which proves no prohibited outcome?
- Is persistent state owned, isolated, and restored?
- Are skips, stubs, disabled suites, order dependencies, and swallowed exceptions absent or
  explicitly classified outside accepted coverage?
- Is the result recorded at its true evidence level?

If an answer is not source-verifiable, the row remains incomplete.
