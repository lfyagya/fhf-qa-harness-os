# Product-Risk and UI → API → Database Evidence Ledger

**Owner:** QA engineering  
**Status:** Source-audited current-worktree assessment  
**Audit date:** 2026-08-03

## Evidence boundary

This ledger records what the current automation actually proves. It does not convert file counts,
test titles, passing status, stubs, skips, or structural layers into product coverage.

Sources inspected:

- sole product source: `Test-Case-Automation-Using-Claude-Agents/specs` — 41 active module
  contracts, 11 shared module-data files, 10 component contracts, 3 mappings, and 2 templates;
- application source: `fhf-dashboards` at `c644f18dd` (dirty worktree; local changes preserved);
- E2E source: `front-end-automation-e2e` current worktree (branch snapshot previously identified as
  `899e896`; dirty worktree);
- production Smoke: `a5d86df6` (dirty worktree);
- backend automation: `75ac18a` (dirty worktree);
- Cypress Cloud E2E project `nptdoe`, run 666, including paginated run/spec/test metadata;
- Cypress Cloud Smoke project `r5k1ro`, run 161, including paginated run/spec/test metadata;
- user-provided `SERV-Backend Test Execution Report - 2026-08-03` screenshots;
- team product YAML: all 41 active module and 10 component contracts explicitly `draft`; shared
  data/mapping files may omit status;
- `US-Auto-Finance-Quality-Blueprint.html`: 70 mechanically verified risk scenarios, used only as
  an industry risk catalogue;
- `deliverables/FHF-QA-Measurable-Impact-Call-Brief.md`: historical/proposed evidence only.
- configured QA policy: `.claude/harness.config.json` `qualityAssurance`, projected from the
  canonical harness; its operational metric thresholds are not acceptance criteria.

The run evidence is recorded in `docs/evidence/execution-history.md`. Cloud metadata identifies the
automation commits, but neither Cloud run reports the deployed application commit. The backend
email omits branch, commit, build ID, and explicit environment; its error host names the Dev API.
Therefore these results establish execution condition and gaps, but not release confidence or a
correlated UI -> API -> database chain.

Product-source completeness also limits interpretation. The sole source is authoritative, but the
affected `loss-mitigation/invoices.yaml`, `document-repository/loan-packages.yaml`,
`post-funding/post-funding.yaml`, `custodian/custodian-dashboard.yaml`, and
`checks-module/insurance-repair-checks.yaml` contracts are draft placeholders with empty
`business_rules`, `fields`, and `flows`. Passing or failing automation cannot establish the intended
business outcome for those modules until the team completes and approves those contracts.

## Latest execution evidence

| Lane | Exact run evidence | What it proves | Acceptance boundary |
|---|---|---|---|
| E2E | Cloud run [666](https://cloud.cypress.io/projects/nptdoe/runs/666/overview), `dev`, automation SHA `c3aeb705dadf4244a8adbbc86bd95284da7c76f4`, 2026-08-03 09:31:46Z-10:00:28Z. 36 specs: 2 passed, 34 failed. 380 tests: 60 passed, 175 failed, 142 skipped, 3 pending; 11 tests passed only after retry. | The run is a failed and highly cascaded E2E baseline. It proves two Transport specs completed and exposes selector, service, data, auth, and test-implementation failures. | Deployed application SHA and controlled data identity are absent. Skipped descendants are not independently executed scenarios. No workflow is promoted. |
| Production Smoke | Cloud run [161](https://cloud.cypress.io/projects/r5k1ro/runs/161/overview), `staging`, automation SHA `6619ac44075a83cdd1ec7ef6a12e84f479ce72a1`, 2026-07-31 21:02:11Z-23:02:45Z. 40 specs: 18 passed, 8 failed, 1 `noTests`, 13 `timedOut`. Started-test counters: 499 passed, 10 failed, 10 pending; no passed-after-retry test. | The 27 started/non-empty specs give production read evidence for their executed assertions. | All 13 timed-out specs have `startedAt: null`. Cloud exposes 54 timed-out tests in 3 of them; the other 10 timed-out specs have no test records, so the exact unexecuted-test total is unknown. The run summary is not whole-suite assurance. |
| Backend | User-provided email report dated 2026-08-03: 308 total, 220 passed, 50 failed, 12 broken, 26 skipped, 730.91 seconds. | Repo/Auction creation, approval, accounting, and denial groups shown in the report all passed; Ancillary exposed API, database, state, endpoint, and latency failures. | The report says `Total Suites: 0` although 24 suite summaries account for all 308 tests. Run SHA/branch/build ID are absent and flake is not measured. It cannot be tied to either UI run identity. |

## Failure correlation and false-confidence controls

The counts below are failure signatures, not defect counts. One upstream failure can fail or skip
many dependent tests.

| Evidence | Source-verified diagnosis | Product-quality consequence |
|---|---|---|
| E2E selector cascade | 71 of 175 failures have the same missing `[data-cy="dashboard-item-count"]` message. Automation SHA `c3aeb705` predates application merge `c863a362` (2026-06-12), whose merge result removed that hook from `DashboardItemCount.tsx`; current `origin/dev` still lacks it. | This is a confirmed application/automation contract incompatibility, not 71 product defects. Restore an owned hook contract or update the one canonical selector only after the deployed app SHA is captured. |
| E2E data/render cascades | Repeated missing `.card-list .card-link` and `[data-cy="table-body-row"]`, eight empty Assignment API item failures, missing `New Invoice` records, and 142 skipped descendants show uncontrolled preconditions and suite-level cascade. | The run cannot measure scenario coverage until state is provisioned and prerequisite failures stop only their own scenario. |
| E2E services and auth | Multiple LM, Titles, Call Log, Auction, Repo, and Doc Repository requests returned 503; login remained on an Okta verification route once. | Treat these as environment/service incidents until service logs and deployed versions identify the failing owner; do not fix tests green around them. |
| E2E automation defects | The run includes detached-DOM `blur`, a 201-versus-200 expectation, missing/stale UI fields, and waits for a second request that did not occur. | Reconcile each assertion with the product contract and application/API implementation before deciding test defect versus regression. |
| Smoke test defects | The Impound clipboard assertion read an invisible cell character while the app called `writeText` with the real VIN. Customer-name comparison is case-sensitive despite uppercase API data. `nextDocManCall` waits for call count growth but then selects the latest settled call from the whole history, allowing a stale response. | These are automation-oracle defects and must not be reported as production product bugs. |
| Smoke UI/read signals | Missing Invoice Amount/Sent To Accounting Date controls, hidden/covered controls, missing Custodian response, URL readiness, and two document-filter mismatches remain unresolved after removing the three confirmed test defects above. | Reproduce one affected module with the exact production app version and GET-only evidence before assigning an application defect. |
| Backend service degradation | All 12 broken tests shown are 30-second `ReadTimeout` failures to `apisdev.firsthelpfinancial.com`. Three additional failures exceeded explicit latency thresholds: 22.793/30.546 seconds against 10 seconds and 5.590 seconds against 5 seconds. | This is a common service/environment health signal and a major cascade source, not 15 independent workflow bugs. |
| Backend execution-source drift | The email says `PENDING_INSURANCE` and `CUSTOMER_NON_RESPONSIVE` were unexpected ACD status keys. Current local `test_ancillary_master_data.py` already includes both in `EXPECTED_PROCESS_STATUS_KEYS`, and the run provides no SHA. | This failure cannot be assigned to the current product or current test source. Preserve it as run-version drift until the executed commit is identified. |
| Backend contract/data signals | An APD API client value had no matching DB row; APD admin/dealer exports returned 422 instead of 201; two packet-document calls returned 404; one ACD partial update showed API-payload/DB mismatches. Three ACD update failures compare visually identical success messages with exact string equality, so hidden encoding/whitespace is also an unresolved oracle risk. | These are defect candidates, not confirmed product bugs. Confirm raw response representation, request/endpoint deployment, and same-record database identity with service owners before classification. |
| Backend ordered-state cascade | At least 35 of 50 failure rows explicitly cite missing prior IDs/state/output: 11 in ACD Record Detail and 24 in ACD Follow-up. All 26 skips are also in APD/ACD dependent flows (2 APD, 6 Record Detail, 18 Follow-up). | These descendants are not independent defects or coverage. Replace cross-test state with per-scenario deterministic setup, or report one primary workflow failure with dependent tests blocked. |

## Cross-lane chain result from these runs

| Workflow overlap | UI evidence | Backend evidence | Chain verdict |
|---|---|---|---|
| Repo/Auction Invoice | E2E failed on missing records/selectors/services; Smoke failed Accounting/Transaction Error filter rendering. | All 48 shown creation/approval/accounting/denial tests passed. | Supporting backend evidence only. Run environment/version and identity are not correlated; no UI request-to-DB correlation. |
| APD/ACD | Smoke Ancillary General navigation failed; E2E run 666 contains no Ancillary spec. | APD export returned 422 and skipped DB checks; ACD has latency, 404, data, ordered-state, failure, broken, and skipped results. | Not accepted. Backend is currently red and no correlated E2E mutation ran. |
| Impound, Document Repository, UniFi | E2E and/or Smoke failures exist. | No matching suite is present in the 308-test backend report. | No backend link. |

The latest runs do not change the portfolio acceptance counts below.

## Configured assurance review

| Layer | Verified current control | Assurance boundary / first improvement |
|---|---|---|
| Product/control plane | One product-spec tree, risk matrix, generated structural inventory, canonical `qualityAssurance` evidence/lane/false-green policy, scenario hook, and separated generator/gate/debugger/shipper roles | All active product contracts remain draft; approval and execution evidence are still required |
| Application | CI runs 72-file Vitest suite and Vite build | Tests are concentrated in utilities/services; lint and TypeScript compile errors are tolerated; CI requests no coverage report/threshold |
| E2E | Chrome Cypress execution, JUnit/Cloud reporting, structural UI Coverage gate | No pre-run static architecture commands in its buildspec; silent fallback markers and uncontrolled mutation lifecycles remain |
| Production Smoke | GET-oriented suite, four pre-run static architecture checks, Chrome/JUnit/Cloud/UI Coverage, production artifact purge | UI Coverage is structural; one Checks suite is disabled and production-safe scenario depth still needs product-contract traceability |
| Backend | Pytest/xdist, JUnit, Allure/TestRail integration, API/Oracle assertions in selected workflows | Ordered state and 75 skip calls weaken independence; accepted UI correlation and cleanup remain absent |
| Nonfunctional | No blocking accessibility, performance, dependency-security, recovery, or observability test was found in audited CI configuration | Confirm applicable product risk and owner-defined thresholds before adding targeted controls |

## Status contract

| Status | Meaning |
|---|---|
| Accepted full chain | Approved intent + controlled real UI mutation + exact request/result + direct API contract + exact database/no-write + reconciliation where applicable + cleanup, correlated by one identity |
| Backend-only accepted | Direct API/database assertions exist, but the UI side is stubbed, unsafe, absent, or not correlated |
| Partial / not accepted | Useful UI or backend evidence exists, but a required identity, assertion, branch, service mode, or cleanup link is missing |
| Mutation not accepted | Existing automation does not prove the target mutation; read/load/filter evidence may exist |
| N/A | Deliberately outside full-chain scope; the narrower outcome must still be stated |

## Cross-module integration seams

The workflow matrix below is organised by module. Real defects also travel *between* modules, along
seams where two modules share a loan record, a status, money, or a downstream artifact — not code.
A module can be fully green and still be broken by a change upstream of it.

These edges are the machine-readable source for change-based selection
(`scripts/execution/impact-map.json` → `crossModuleEdges`). Each edge names the lane that can
actually observe the break, so selection widens by evidence rather than by guesswork.

Loan-lifecycle order (from `.claude/rules/session-rules.md`) is the direction of travel:
Funding → Post Funding → Document Repository → Custodian → Titles → UniFi Servicing →
UniFi Collections → Loss Mitigation → Insurance → Ancillary → Checks → Complaints → Call Reports.

## Authenticated happy-path browser baseline — 2026-09-08

This is a Dev/QA implementation baseline from the authenticated dashboard host and
`apisdev.firsthelpfinancial.com`. It records what the logged-in Collection Manager role could
open and what the current UI exposed. It does **not** promote any workflow to Accepted full chain:
no browser action in this pass had both a controlled correlation identity and a proven cleanup
path. Counts are volatile environment observations, not product contracts.

### Manual lifecycle replay

1. **Funding** — open `/funding/dashboard`; verify the month selector, Daily Box, Ready, Funded
   Today, In Funding, To Audit, region cards, and FHF Performance. Continue through Coordinator or
   My Queue only with an assigned record. A complete success ends when funding state is persisted
   and the same identity becomes eligible in Post Funding.
2. **Post Funding** — open `/post-funding/summary`; verify Infraction Type, Dealer ID, Dealer Name,
   State, and Call Date filters. The observed role returned `No records found`, so dealer-detail
   annotation and the Funding → Post Funding seam remain data-blocked.
3. **Document Repository** — open `/doc-repository/loan-packages`; verify the populated queue,
   filters, Loan Packages identity, Bulk Action, and Download List of Loans. A complete success is
   a controlled merge/archive job reaching a terminal Download Job Queue state with file-integrity
   and cleanup evidence. Download and bulk actions were not executed.
4. **Custodian** — open `/custodian/dashboard`; verify All Loans, Not Sent, Sent, and Exceptions
   Queue plus the disposition/stage columns. A complete success reconciles a controlled
   Confirmed Disposition/Loan Stage mismatch and proves the same location/status in Titles, then
   restores the original fixture. This pass re-observed the queue only; it did not repeat or claim
   the earlier uncorrelated mutation.
5. **Titles** — open `/titles/general`; select a row to reach `/titles/general/details/:id`, then
   inspect Basic Details, Status, Custodian Management, Actions, Lien Release Letter, Notes, Loan
   Documents, Loan Details, Events, and Email History. Continue to `/titles/release`, whose Release
   and Release To tabs, aging legends, Release View selector, 19-column Release queue, same-tab row
   navigation, payoff details, and document list were independently observed. Missing Titles,
   Remarketing, Remarketing Titles, and Re-Registration remain separate branch scenarios defined
   by their module contracts; their writes require reversible records.
6. **UniFi Servicing** — open `/servicing`; verify the 22-column queue, shared filters, and
   same-account detail navigation. The observed queue showed 35 of 25,425 records. A complete
   success is the approved inbound/outbound call or payment transition with exact disposition,
   persisted state, and cleanup; no call was placed or logged.
7. **UniFi Collections** — open `/contact-log`; verify Main, the delinquency/payment filters, and
   the account queue (40 of 6,979 observed). A complete success is a controlled contact and
   Promise-to-Pay/payment lifecycle with amount/date/status oracles and cleanup; no customer
   contact or payment action was executed.
8. **Loss Mitigation** — open `/loss-mitigation/assignment`; verify Assign to Repo and Assignment
   Exception modes and their filter inventory. The observed Main view had zero rows, so Assignment
   mutation and the downstream Repo/Skip/Remarketing/Impound/Transport/Invoice/Recon cascade were
   data-blocked for this role.
9. **Insurance** — open `/insurance/total-loss`; verify Dates and Payoff views, aging legends, the
   populated queue, and Add New Claim. A complete success creates or advances a controlled Total
   Loss/Lienholder Claim record and verifies the Impound notification seam before restoring it.
   Add New Claim was not executed.
10. **Ancillary** — open `/ancillary/not-filed`; verify Main/Early Payoff/Repossession/Total Loss/
    Customer Request, Needs Review, Show Non-Responsive Accounts, and the populated queue. A
    complete success adds or updates a controlled product/cancellation record and proves the
    refund/payoff and letter effects with cleanup. Add New Record/Add Product were not executed.
11. **Checks** — open `/checks/insurance-repair-checks`; verify Main, Approval Queue, Failed
    Uploads, Account Past Due, Expired Check, the populated queue, and Upload Check. A complete
    success uses a controlled input through matching, decision, posting, and reconciliation.
    Upload was not executed because file and posting cleanup were not established.
12. **Complaints** — open `/complaints`; verify the queue/filter contract and Create Complaint.
    A complete success creates a synthetic complaint, advances status/type/notes links, confirms
    its UniFi account constraint, and deletes or restores it. Creation was not executed.
13. **Call Reports** — open `/call-reports/agent-call-volume`; verify Agent Team, Agent Name, Role,
    Date Range, report headers, and Download CSV. The default range returned `No Data Available`;
    a complete success correlates a controlled UniFi call identity into volume and recording
    reports. Download was not executed.

### Execution boundaries discovered

- **Browser-verified checkpoints:** all 13 lifecycle stages were reachable to this role; Funding,
  Document Repository, Custodian, Titles, Servicing, Collections, Insurance, Ancillary, Checks,
  and Complaints exposed their main queue or dashboard.
- **Data-blocked checkpoints:** Post Funding returned no records; Loss Mitigation Assignment
  returned zero records; Agent Call Volume returned no data for its default date range.
- **Mutation-gated checkpoints:** export/download, email/send, upload, payment, call logging,
  complaint/claim creation, and cross-system posting lacked a demonstrated non-egress sink or
  reversible cleanup record.
- **Navigation defect:** rapid SPA route changes sometimes reverted to a previously loading route.
  Each recorded checkpoint above is based on a matching URL/title snapshot; later stale content
  was not accepted as evidence for the requested route.

| Upstream | Downstream | Seam | Observable in | Verified from | Seam evidence today |
|---|---|---|---|---|---|
| Funding | Post Funding | Funding completion is the precondition for dealer annotation | e2e | lifecycle order | None — no cross-module scenario exists |
| Funding | Contracts | Contract prep output is what funding coordinates and custodian later receives | smoke | `module-component-map.yaml`; `custodian/contracts.yaml` | None |
| Custodian | Document Repository | Loan package contents depend on custodian-held documents and exception-queue state | e2e | Document Repository row below | None |
| Custodian | Titles | Document location/status synchronization feeds title custodian management | e2e | `account-details-page-shared.yaml` Custodian Management section | None — the ledger records cross-dashboard location sync as explicitly unverified |
| UniFi | Loss Mitigation | Delinquency, contact outcome and promise-to-pay state drive assignment/repo eligibility | e2e, backend | `loss-mitigation/assignment.yaml` routing algorithm; `common/call-center/payment-page.yaml` verification gating | None — both sides have module evidence, no seam scenario |
| UniFi | Call Reports | Call log and call events are the source records for agent call volume and call recording | smoke | `common/call-center/account-details-page.yaml` BR-CCD-002/003/007/008 and FL-CCD-030/031; `components/event.component.yaml` | None |
| Loss Mitigation | Titles | Repo/remarketing progression drives title flip type and the remarketing-title cascade | e2e, smoke | `state-to-flip-type-map.yaml`; Titles Remarketing row below | None — the Titles Remarketing row records the cascade as unaccepted |
| Loss Mitigation | Checks | Repo/auction invoice accounting and insurance repair check posting both settle money against the loan | backend | Checks row below; LM accounting backend suite | Backend LM accounting only; no check-posting counterpart exists |
| Insurance | Loss Mitigation | Total Loss / Lienholder Claim state movement raises Impound notification behavior | e2e | Insurance row below names Impound notification identity as a missing link | None |
| Ancillary | UniFi | ACD cancellation refund reduces the payoff/balance servicing and collections present | backend | APD/ACD row above; ancillary backend suite asserts API+DB refund state | None — ancillary backend is currently red |
| Ancillary | Letters | Cancellation and packet events drive outbound letter-tracking records | smoke | `common-ancillary-cancellation.yaml` packet rules; `letter-tracking.yaml` | None |
| Complaints | UniFi | Complaint records attach to the account and constrain collection contact activity | smoke | `complaints/complaints-view.yaml`; `common/call-center/account-details-page.yaml` Complaints widget | None |

**Seam position: 0 of 12 seams have any correlated cross-module evidence.** Every row above is a
module-boundary risk that current automation cannot observe, because every existing spec and suite
is scoped inside one module. This is a distinct gap from the per-module rows below: closing all 14
workflow rows would still leave all 12 seams unproven.

Two seams are the highest-value first targets because both sides already have automation to build
on: Loss Mitigation → Checks (money settlement, backend-observable, and the LM accounting suite
already passes) and Insurance → Loss Mitigation (Impound notification, e2e-observable, and both
module specs exist). Neither may be claimed until one scenario crosses the boundary with a single
correlation identity.

## Current workflow matrix

| Workflow and risk | Intent / application implementation | Automation implementation and actual assertion | Accepted status | First missing link |
|---|---|---|---|---|
| UniFi Collections — Promise-to-Pay / scheduled payment; incorrect amount/date/status can drive collection harm | Draft product context. App exposes Payix card/ACH and cash create/edit/cancel paths. | `scheduledPTP-scenarios.cy.js` registers mutation aliases but does not wait for or assert them. Create asserts at least one row; edit repeats the same type of assertion; delete asserts modal disappearance. It uses a dynamically found existing account and has no verified server cleanup. Backend Payix coverage found only the schedule-list read. | Partial / not accepted | Controlled synthetic account; exact mutation request/result; money/date/status oracle; denied/no-write; Oracle correlation; cleanup |
| UniFi Servicing — inbound transition and payment processing | Product rule and state owner not approved in the audited sources. | UI/read fragments and backend structural files exist; no correlated transition/payment mutation and persisted-state oracle were found. | Mutation not accepted | Approve the transition/payment contract and state owner before building evidence |
| Checks IRC/LBC — ingestion, matching, approval/rejection, posting | Draft contexts describe check surfaces; OCR/SFTP and posting ownership are not verified from frontend source. | Current UI automation is availability/filter oriented. Production Smoke's `insuranceRepairChecks.cy.js` is under `describe.skip`, disabling its declared scenarios. No accepted controlled ingestion-to-posting lifecycle was found. | Mutation not accepted | Controlled input, exact match/decision/posting rules, rejection/no-write, reconciliation, cleanup |
| Ancillary ACD/APD — bulk export/status/verification/refund actions | App source confirms APD bulk export POST and separate ACD/APD access groups. Specs remain draft. | UI `bulk-export-dealer.cy.js` stubs reads and the export POST to prevent email; it proves the request payload against a fixture response, not a real workflow. In the latest backend report, both real APD export calls returned 422 instead of 201 and both DB checks skipped because no export ID was stored. UI and backend identities are not correlated. | Partial / not accepted | Resolve the request/validation contract and deterministic data; prove a 201 plus same-ID DB result before adding a safe UI service mode, RBAC/no-write, and cleanup |
| Insurance — Total Loss ↔ Lienholder Claim and Impound notification | App/context confirms asymmetric move access, real move POSTs, and guarded notification behavior; specs are draft. | `insurance.cy.js` contains local restoration for some claim-status updates, but also data-unavailable branches that log "Skipping" and omit the intended assertion. No direct database/downstream correlation exists. | Partial / not accepted | Deterministic records for both guards/branches; server-side RBAC; exact new state; Impound notification identity; cleanup |
| Titles Release / Re-Registration — approval, checklist, current-version eligibility | Draft contexts; exact approved state/eligibility contract not present. | Availability, filtering, and UI behavior exist; no accepted UI mutation-to-database current-version/no-write chain was found. | Mutation not accepted | Approved eligibility/state contract; synthetic lifecycle; exact request/current-version DB/no-write; cleanup |
| Titles Remarketing — dual-tab actions and repo/title cascade | Draft context; cascade ownership is not approved. | Availability/read assertions exist; no accepted correlated cascade mutation was found. | Mutation not accepted | Stable AppSync/data contract, controlled action, cascade/reconciliation oracle, cleanup |
| Loss Mitigation Repo/Auction Invoice — approve/deny/accounting outcome | App/context confirms invoice endpoints and actions; formal intent remains draft. | UI invoice specs mutate existing invoices, include data-unavailable/skip branches, and have no application-state cleanup. Comments incorrectly rely on `testIsolation` for fresh server state. Backend suites do strong API/Oracle approval/denial assertions with created identifiers, but they are not the same UI lifecycle. | Backend-only accepted | Seed a UI-owned invoice; correlate UI request to backend/Oracle/accounting identity; decimal/no-write assertions; cleanup |
| Loss Mitigation Impound/Transport — hold/status/note/dispatch/email | App/context confirms real status/note/email actions and cross-module Insurance behavior; specs are draft. | Impound restores several changed fields/statuses locally, but note creation is explicitly irreversible. Transport/Impound UI evidence is not correlated to backend state, files, email, or downstream systems. | Partial / not accepted | Reversible synthetic data; note cleanup strategy; exact persisted/downstream outcome and error/no-write branches |
| Loss Mitigation Assignment/Repo/Skip/Remarketing/Recon — recovery cascade | Draft context; individual state owners and reconciliation rules require approval. | Broad read/filter behavior exists; no accepted controlled cascade mutation with exact persisted and downstream reconciliation proof was found. | Mutation not accepted | Split into approved independently valuable transitions; prove each identity, state, no-write, reconciliation, cleanup |
| Complaints — create, status/type, notes link/unlink | Draft context; approved state contract not found. | Production Smoke/read evidence exists; no accepted real mutation and database/no-write chain was found. | Mutation not accepted | Approved workflow, synthetic record, service-side RBAC, exact state/links, cleanup |
| Custodian / Contracts — requests/import/status/location synchronization | App/context confirms two independent access groups under one URL prefix and distinct CSV schemas. Cross-dashboard location sync is explicitly unverified. | E2E specs depend on ordered cross-spec state and write discovered loan/state into fixture files. Fixture reset does not restore server mutations. No correlated database proof exists. | Partial / not accepted | Independent synthetic scenarios; confirm sync rule; exact import/status/current-state DB; server cleanup |
| Document Repository — merge/download/archive job and produced file | Draft context; async job/file contract requires approval. | UI spec has substantial read/interaction assertions, but exact terminal job failure/success, produced-file content, backend state, and permission/no-write evidence are incomplete. | Partial / not accepted | Controlled job; correlation ID; terminal/error oracle; file integrity; authorization; backend state; cleanup |
| Post-Funding — dealer detail annotation | Draft context; portfolio decision excludes it from database-chain closure. | Narrow UI behavior exists; no full-chain claim is made. | N/A | Define and accept the intended UI-only outcome if this remains in scope |

## Portfolio position

| Evidence status | Rows |
|---|---:|
| Accepted full chain | **0** |
| Backend-only accepted | **1** |
| Partial / not accepted | **6** |
| Mutation not accepted | **6** |
| N/A | **1** |

The previous claim of one accepted full chain (Loss Mitigation invoices) is removed. Its UI tests
mutate existing records without a controlled correlated identity or cleanup, so the row fails this
ledger's own acceptance contract.

APD is also demoted from backend-only accepted to partial: its latest real export calls failed and
the dependent database checks skipped, so current execution does not prove the backend workflow.

## Cross-cutting false-green exposure

Static source signals requiring scenario review:

- E2E: 198 skip/data-unavailable/fallback markers across 17 spec files under the documented static pattern.
- Backend: 75 `pytest.skip()` calls across 9 Python files (66 in 7 test files and 9 in 2 `conftest.py` files).
- Production Smoke: one 10-test Checks spec disabled with `describe.skip`.
- Current product YAML: no approved active module/component contract found; draft or explicitly
  unconfirmed content cannot establish approved intent.

These are not failure counts. Each marker must be classified as an intentionally excluded scenario,
a deterministic fixture gap, or a false green. A required precondition that disappears at runtime
must not pass silently.

## Decision and update rule

1. Accept coverage only at the deepest link actually proven.
2. Record the first missing link; do not hide it behind test totals or percentage coverage.
3. Change a row only with source links and accepted native-lane evidence.
4. Recompute the portfolio arithmetic in the same change.
5. Keep structural inventory in `docs/evidence/coverage-computed.json`; it cannot promote this
   ledger.
