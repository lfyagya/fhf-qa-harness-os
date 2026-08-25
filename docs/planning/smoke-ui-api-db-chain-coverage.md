# Smoke Coverage: UI → API → DB Chain

Complete three-layer smoke picture across the two lanes: what each sub-module covers at the UI,
API, and DB layer; where the chain breaks; what closes it.

> **Intended location:** `docs/planning/coverage/`. That directory is currently blocked by a
> read/write deny rule in this environment, so the file lives one level up. Move it when the rule
> is lifted, and reconcile against `docs/planning/coverage/fullstack-chain-risk-matrix.md` — which
> could not be read to merge into.

**Verified** 2026-08-20 against:

| Lane | Repository / ref | Inventory |
|---|---|---|
| UI | `front-end-automation-smoke` @ `codex/serv-12318-latency` (`f87304d5`) | 40 specs, 666 `it` blocks — **642 running, 24 skipped**, 308 endpoint contracts (re-counted 2026-08-21, after the Lockbox Checks suite landed) |
| API + DB | `fhf-backend-automation` @ `SERV-12270` (`b8c6dc4`) | 42 files, 391 test functions, 14 sub-modules |

Join key is the resolved endpoint path: backend `os.getenv("*_ENDPOINT")` resolved through
`tests/example_env`, frontend globs read from `cypress/configs/api/**`. Both sides address the same
`firsthelp_coll` proxy segment, so paths compare directly.

---

## Method and limits

All backend figures are **static counts read from source**, not results of a run. The suite was
never executed: the bundled `venv/` is a POSIX build (`venv/bin/python`, no `Scripts/python.exe`)
and is not callable from this environment. So this document establishes that the tests exist and
which paths and DB objects they target — **not that they pass**, and not that those endpoints
currently return 200.

Sources read, per figure:

| Source | Establishes |
|---|---|
| `tests/smoke/**/test_*.py` | test-function counts, names, parametrize counts, per-layer split |
| `api/*_client.py` | method → endpoint-env-var mapping (17 clients) |
| `tests/example_env` | resolves every `*_ENDPOINT` var to a real path — the FE↔BE join key |
| `tests/commons/db_schema.py` | resolves DB object constants to table/view names |
| `tests/commons/api_schemas/*.py` | field contracts, for comparison against FE baselines |
| `git ls-tree` across all 50 refs | what exists on which branch |

Endpoint counts per sub-module are derived by matching client-method call sites in each smoke file
back through the env map. Two caveats on that derivation: method names duplicated across clients
(e.g. `get_process_statuses` in both `acd_client` and `apd_client`) collide in the mapping, so the
Ancillary endpoint count is approximate; and DB-object counts are pattern-matched on Oracle naming
conventions, so treat them as magnitudes, not exact inventories.

---

## Layer inventory

| Layer | Owner lane | Tests | Sub-modules reached |
|---|---|---:|---:|
| UI — render, structure, behaviour | FE Cypress | 652 | 38 of 38 |
| API — contract, health, parity | BE pytest | 238 | 21 of 38 |
| DB — objects, validity, master data | BE pytest | 153 | 20 of 38 |

Backend layer split: 238 API health · 87 DB connectivity · 66 master data.

UI coverage is complete across every sub-module **that this document counts** — the 38-sub-module
denominator is the set with at least one smoke spec, not the set of shipped application modules.
Six sub-modules sit outside it entirely (see *Descoped — outside the 38*), so "38 of 38" reads as
100% only because the uncovered modules were never in the denominator. API and DB coverage reach
just over half the counted surface. **There is no sub-module where the backend leads the
frontend** — every gap is on the backend side.

Of the 666 UI `it` blocks, 642 run. The other 24 are both Checks suites — 10 under Insurance
Repair (`insuranceRepairChecks.cy.js:28`) and 14 under Lockbox (`lockboxChecks.cy.js:28`) — both
`describe.skip` behind the same Okta gate, and neither proves anything until the grant lands.

---

## Chain matrix

`✓` covered · `◐` partial · `✗` absent. Counts are test functions; `ep` = distinct endpoints
exercised; `obj` = distinct Oracle objects asserted.

| Module | Sub-module | UI | API | DB | Chain | Gap |
|---|---|:--:|:--:|:--:|:--:|---|
| Ancillary | ACD General Dashboard | ✓ 20 | ✓ 8 ep | ✓ 42 obj | **✓** | acdwrapper drift (D1) |
| Ancillary | ACD Followup | ✓ 17 | ✓ 3 ep | ✓ shared | **✓** | — |
| Ancillary | ACD Record Details | ✓ 7 | ✗ 0 | ✓ shared | **◐** | 5 API-health tests |
| Ancillary | APD Products | ✓ 13 | ✓ 2 ep | ✓ shared | **✓** | — |
| Ancillary | APD Verification | ✓ 21 | ✓ 2 ep | ✓ shared | **✓** | — |
| Ancillary | APD Product Details | ✓ 9 | ✗ 0 | ✓ shared | **◐** | 1 API-health test |
| Ancillary | Export Activity | ✓ 13 | ✓ 2 ep | ✓ shared | **✓** | — |
| Loss Mitigation | Assignment | ✓ 16 | ✓ 11 | ✓ 5+6 | **✓** | — |
| Loss Mitigation | Repo | ✓ 17 | ✓ 12 | ✓ 4+2 | **✓** | — |
| Loss Mitigation | Skip | ✓ 16 | ✓ 10 | ✓ 7+2 | **✓** | — |
| Loss Mitigation | Remarketing | ✓ 15 | ✓ 19 | ✓ 11+6 | **✓** | FE lacks `eligibility/profile` |
| Loss Mitigation | Impound | ✓ 31 | ✓ 22 | ✓ 7+8 | **✓** | notification path mismatch (D4) |
| Loss Mitigation | Transport | ✓ 18 | ✓ 25 | ◐ 10+**0** | **◐** | no master-data file |
| Loss Mitigation | Recon | ✓ 19 | ✓ 22 | ✓ 8+6 | **✓** | — |
| Loss Mitigation | Repo Invoice | ✓ 24 | ✓ 8 | ✓ 2+7 | **✓** | `repo_instance` drift (D3) |
| Loss Mitigation | Auction Invoice | ✓ 24 | ◐ 3 | ✓ 2+5 | **◐** | 3 endpoints unreachable |
| Titles | General | ✓ 33 | ✓ 17 | ✓ 7+8 | **✓** | — |
| Titles | Missing Titles | ✓ 26 | ✓ 27 | ✓ 10+9 | **✓** | — |
| Titles | Re-Registration | ✓ 24 | ✓ 27 | ✓ 9+3 | **✓** | — |
| Titles | Release | ✓ 23 | ✗ | ✗ | **✗** | whole BE module |
| Titles | Remarketing | ✓ 18 | ✗ | ◐ via LM | **✗** | whole BE module |
| Titles | Remarketing-Titles | ✓ 14 | ✗ | ◐ via LM | **✗** | whole BE module |
| UniFi | Collections | ✓ 12 | ◐ 15 | ✓ 62 obj | **◐** | 6 endpoints DB-covered, API-uncovered |
| UniFi | Servicing | ✓ 13 | ◐ shared | ✓ shared | **◐** | `calllog` not health-checked |
| Custodian | Dashboard | ✓ 21 | ✗ | ✗ | **✗** | whole BE module |
| Custodian | Exception Queue | ✓ 13 | ✗ | ✗ | **✗** | whole BE module |
| Custodian | Portfolio View | ✓ 7 | ✗ | ✗ | **✗** | whole BE module |
| Custodian | Request | ✓ 7 | ✗ | ✗ | **✗** | whole BE module |
| Doc Repository | Dashboard | ✓ 36 | ✗ | ✗ | **✗** | whole BE module |
| Complaints | Dashboard | ✓ 25 | ✗ | ◐ 3 views via UniFi | **✗** | API + own DB file |
| Contracts | Dashboard | ✓ 23 | ✗ | ✗ | **✗** | whole BE module |
| Insurance | Lienholder Claim | ✓ 17 | ✗ | ✗ | **✗** | whole BE module |
| Insurance | Total Loss | ✓ 16 | ✗ | ✗ | **✗** | whole BE module |
| Call Reports | Agent Call Volume | ✓ 8 | ✗ | ✗ | **✗** | whole BE module |
| Call Reports | Call Recording | ✓ 7 | ✗ | ✗ | **✗** | whole BE module |
| Letters Tracking | Dashboard | ✓ 11 | ✗ | ✗ | **✗** | whole BE module |
| Checks | Insurance Repair | ✗ 0 (10 written, `describe.skip`) | ✗ | ✗ | **✗** | Okta grant blocks the UI suite; whole BE module |
| Checks | Lockbox | ✗ 0 (14 written, `describe.skip`) | ✗ | ✗ | **✗** | same Okta gate as Insurance Repair; whole BE module |
| Post Funding | Dashboard | ✓ 6 | ✗ | ✗ | **✗** | whole BE module |
| *Cross-cutting* | Unauthenticated access | ✓ 2 | n/a | n/a | n/a | — |

### Descoped — outside the 38

Shipped application sub-modules with **no smoke spec at all**. They are absent from the matrix
above and from every percentage in this document; listing them here keeps "38 of 38" from reading
as full application coverage.

| Module | Sub-module | Application evidence | Automation state | Blocker |
|---|---|---|---|---|
| Funding | Dashboard | `dashboardsNavigationConfig.tsx:117-121` | `specs/modules/funding/dashboard.yaml`, no spec | nav gated on `dashboardAccessGroups.FUNDING.PRIMARY` |
| Funding | Sigma / My Queue | `dashboardsNavigationConfig.tsx:123-127` | `specs/modules/funding/my-queue.yaml`, no spec | same group gate |
| Funding | Monthly Spreadsheet | `dashboardsNavigationConfig.tsx:130-133` | `specs/modules/funding/monthly-spreadsheet.yaml`, no spec | same group gate |
| Funding | Coordinator | `dashboardsNavigationConfig.tsx:136-141` | `specs/modules/funding/coordinator.yaml`, no spec | `FUNDING_COORDINATOR_ASSIGNMENT` + `_AUDIT` groups |
| Funding | Funder View | `dashboardsNavigationConfig.tsx:148` | no spec | `FUNDING.FUNDER_VIEW` group |
*(Checks / Lockbox left this table on 2026-08-21 — the suite now exists and is
counted in the matrix above as written-but-skipped.)*

Access status for the five Funding rows is **inferred from the nav gate in application source, not
confirmed against the smoke account's Okta groups**. Confirm before treating them as blocked rather
than simply unwritten. Lockbox Checks is confirmed: it shares the `#menu-Checks-Module` nav entry
that Cloud run 141 could not reach.

Counting these, application coverage is **39 of 44 sub-modules (89%) at the UI layer**, not 100%.
Two of the 39 (Insurance Repair, Lockbox) are written but cannot run, so **37 of 44 (84%) actually
execute**.

### Why the five Funding sub-modules are not simply "next"

They fail the `ai-pilot.md` entry criteria on two counts beyond access, and neither is fixable
inside this repository:

1. **No approved scenarios.** All four `specs/modules/funding/*.yaml` are `status: draft` with
   `business_rules`, `fields`, `flows`, `negative_scenarios` and `edge_scenarios` all empty. There
   is nothing to derive a suite from. Owner: PO + QA Lead.
2. **No test hooks.** `src/components/funding/` carries **3 hooks across 41 files**, all three on a
   single Coordinator dropdown (`FundingCoordinatorAccountDetail.tsx:79-96`). Verified against
   `data-cy`, `dataCy`, `data-testid` and `data-test`. A suite written today would be CSS/text
   selectors, which `ui-config-hierarchy.md` and `ai-pilot.md` both forbid. Owner: FE dev team,
   tracked in `data-cy-hook-backlog.md`.

Lockbox Checks was writable despite the same access gate precisely because neither of those two
applied: it renders shared, already-instrumented platform components (`Tablist.jsx`,
`tableTS/*`, `FilterGeneratorByTab`) plus three real module hooks, so the contract existed even
though the module spec was an empty stub.

---

## Coverage

**Full UI→API→DB chain: 15 of 38 sub-modules = 39%.** Counting partials at half: **47%**.

| Chain state | Sub-modules | FE tests behind | BE tests behind |
|---|---:|---:|---:|
| ✓ Complete (all three layers) | 15 | 288 | 306 |
| ◐ Partial (one layer thin) | 6 | 103 | 84 |
| ✗ UI-only (no API, no DB) | 17 | 259 | 0 |

288 of 652 FE tests (44%) sit on a verified API + DB foundation. **259 FE tests (40%) are UI
assertions with nothing behind them**, and 24 of them (both Checks suites) do not run at all — a green FE run tells you the page renders, not that the
data is real.

**What these numbers mean for strategy: the pyramid is inverted.** 652 UI tests reach all 38
sub-modules while 238 API tests reach 21 — thickest where industry practice says thinnest, thinnest
where it says thickest. The consequence is that **rebalancing beats adding**: promoting API-health
coverage to the remaining 17 sub-modules buys more deploy confidence than any further UI test, and
carries none of the flake cost. Reasoning and sourcing in
`framework/testing-standards/smoke-execution-strategy.md` §8; the derived MUST/SHOULD/MUST NOT form
is `framework/testing-standards/smoke-checklist.md`.

---

## Closing the gaps

### Tier 1 — client methods already exist, only tests missing

| Sub-module | Add | Est. |
|---|---|---:|
| UniFi Collections | API health for `collection/calllog`, `collection/collection_payment_due`, `contact-management/contact`, `common/language_preference`, `contacts/phone`, `complaints/complaint_tracker/v2`. All six DB objects are already asserted in `test_unifi_db_connectivity.py` (62 objects) — highest coverage gain per unit of work in the suite. | 12–18 |
| LM Transport | `test_transport_master_data.py` — `TRANSPORT_STATUS` exact 6-key set, 5-active/1-inactive split, `IS_FINAL` 3/2 split, `SORT_ORDER` sequential, required columns not null. The counts already exist inside `db_connectivity`; split them out so all 14 modules are layer-consistent. | 5 |
| ACD Record Details | API health for `/ancillary-cancellation/:loan/general-information/`, `/documents/:app`, `/notes/note/:app`, `/state_timeframe`, `/cancellation/products/:app` — all five have `acd_client` methods. | 5–10 |
| APD Product Details | API health for `/ancillary_products/products/by_id`. | 2 |

### Tier 2 — needs new client methods

| Sub-module | Add | Est. |
|---|---|---:|
| LM Auction Invoice | 3 client methods + health tests: `auction_invoice_status`, `transaction_failed_invoice`, `auction_invoice_line_items`, plus API-vs-DB count parity on status. Closes the asymmetry with Repo Invoice (3 API tests vs 8, near-identical dashboard). DB already covers all four views. | 6–8 |
| Titles Release | New module: `/title/release`, `/title/api_coll_title_release_status_dt`, `/title/loan_owner`, `/custodian_reason_status` + DB (`TITLE_TRACKER`, release views, `FHF_TITLE_STATUS` release key-set). | ~25 |
| Titles Remarketing + Remarketing-Titles | New module: `/title/remarketing`, `/title/remarketing/titles`. DB partly exists under LM Remarketing (`LM_REMARKETING_TRACKER`, `LM_TITLE_TRACKER`, `LM_TITLE_ACTION_PROFILE`) — reuse it. | ~20 |
| Complaints | API health for `complaint_types`, `complaint_status_codes`, `complaint_tracker`, `complaint/v2`, `complaint_notes/v2`. DB partly exists — `COMPLAINT_DSHBRD_VW`, `COMPLAINT_TYPE_VW`, `COMPLAINT_STATUS_CODE_VW` are asserted under UniFi. | ~18 |

### Tier 3 — greenfield backend modules

| Sub-module | Endpoints to cover | Est. |
|---|---|---:|
| Custodian (4 dashboards) | `custodian_dshbrd_tracker`, `not_sent`, `sent`, `loan_stage_status`, `exception_queue_status`, `exception_queue_tracker`, `custodian_exception_status`, `custodian_department`, `custodian_request_tracker`, `custodian_portfolio_tracker`, `note` — 11 | ~45 |
| Doc Repository | `common/states`, `common/loan_groups`, `common/account`, `dms/docs/job_queue`, `doc_man`, `doctype`, `sub_doctype`, `loan_package_merge` — 8 | ~30 |
| Contracts | `contracts/status`, `dashboard`, `notes/note`, `common/loan_details`, `dms/docs/doc_man` — 5 | ~20 |
| Insurance (2) | `insurance/lienholder_claim` + `/status`, `insurance/total_loss` + `/status` — 4. Note `lienholder_claim/status` is already intercepted by FE Recon (shared endpoint). | ~18 |
| Call Reports (2) | `collectionreports/ffc-call-volume-dashboard`, `collectionreports/api_coll_livevox_call_rec` — 2 | ~12 |
| Letters Tracking | `letter_types`, `letter_dashboard`, `common/states` — 3 | ~12 |
| Checks | `repair_checks/applications` × 3 query states (approved / approval-queue / failed-uploads) | ~10 |
| Post Funding | `post-funding/summary`, `api_fhf_business_states`, `infraction-types`, `infractions`, `status`, `salesbi/dealer_visited_notes` — 6 | ~20 |

Full closure ≈ **230–270 new backend tests**, taking the suite from 391 to ~640 and chain coverage
from 39% to 100%.

---

## Test factors per layer

Derived from what the two suites actually assert. Use as the definition-of-done for any new
sub-module — a module is smoke-complete when it hits every applicable factor in all three layers.

### UI layer

| Factor | Reference implementation |
|---|---|
| Route loads authenticated; unauthenticated redirect | `common/unauthenticated.smoke.cy.js` |
| Page structure — all expected column headers present | every spec |
| Header controls present (dropdown, toggles, notification bell) | impound, transport |
| Filter panel collapsed by default, opens, all N controls visible | impound (11 controls) |
| Filter Apply narrows results; Cancel clears without applying | impound, recon |
| Record-count label matches API count and `items.length` | impound, transport |
| Row actions present (notes icon, copy-to-clipboard, modal open/close) | impound |
| Write-only controls stay hidden; read-only text renders | impound status dropdown |
| Data integrity — no `null/null/null` rendered | impound make/model |
| Toggle × filter interaction still narrows | impound archived toggle |
| Per-endpoint latency budget | `latencyMax` in `configs/api/**` |

### API layer

| Factor | Reference implementation |
|---|---|
| 200 within response-time threshold | all 238 health tests |
| ORDS envelope shape (`items`, `count`, `hasMore`, `total_rows`) | impound, transport, missing titles |
| Item schema — field presence + type | `assert_response_schema` |
| API-vs-DB count parity | 12+ tests across modules |
| Pagination `limit=1` returns exactly 1 | impound, transport, remarketing |
| Filter by key narrows result set | impound, transport, recon |
| Non-existent key → 200 empty, or 404 | impound detail, missing titles |
| Required identifiers not null | transport, recon, impound notification |
| `is_active=1` on every returned item | impound, transport, remarketing |
| `sort_order` type + ascending order | transport, recon |
| Sibling endpoints structurally distinct | assignment `/status` vs `/repo/status` |

### DB layer

| Factor | Reference implementation |
|---|---|
| Tables exist | all 14 modules |
| Views exist and are queryable | all 14 |
| View has active rows (non-zero) | impound, transport, remarketing |
| Package spec **and** body VALID | impound, transport, recon, titles, skip |
| Package exposes all expected members | impound, transport, recon |
| Procedures VALID | assignment, repo, skip, remarketing |
| Triggers VALID / disabled-as-expected | assignment, transport, impound |
| Function callable smoke | `PKG_QUEUE_MANAGEMENT.FN_VERIFY_QUEUE_DISTRIBUTION` |
| Exact key set — no additions, no removals | impound 18, recon 8, transport 6 |
| Exact row count | title location 6, loan owner 3 |
| Flag invariants — one `IS_DEFAULT`, `IS_FINAL` split, all `IS_ACTIVE` | impound, recon |
| Required columns not null | 8 modules |
| `SORT_ORDER` sequential, no gaps | recon 1–8 |
| Legacy table confirmed empty | `LM_TRANSPORT_USERS` |

Transport hits every API factor. Auction Invoice hits 2 of 11. That ratio — not the test count — is
the useful per-module quality signal.

---

## Open cross-layer defects

All four re-verified against `b8c6dc4`; none fixed.

**D1 — ACD acdwrapper drift.** Five ACD lookups (provider list, cancellation reasons, process
status, states, other-product-type) migrated in prod off ORDS onto a non-ORDS `/acdwrapper/*`
proxy; the FE config records a live prod capture dated 2026-07-28 and cross-checks
`wrapperEndpoints.ACD_WRAPPER = 'acdwrapper'` in the application's `network.js`. Grep for
`acdwrapper` across the backend returns zero files — backend health-checks the pre-migration ORDS
paths. **Caveat:** FE reads prod, BE runs Dev/QA, which may still serve the old routes. Verify
against the application contract before treating as a defect.

**D2 — ACD main dashboard path.** `tests/example_env:74` is
`/firsthelp_coll/ancillary-cancellation/cancellations-new/all/loans/collectionsmanager`; the FE
config records the current path as `/ancillary-cancellation/loans/all/{role}`. Also baked into
`tests/commons/api_schemas/ancillary_cancellation_dashboard_schemas.py:67`.

**D3 — Repo instance route.** Backend `REPO_INSTANCE_ENDPOINT=/repo_invoice/repo_instance` vs
frontend `/repo_invoice/rdn_repo_instance/**`. The DB view is `RDN_REPO_INSTANCE_VW`
(`tests/commons/db_schema.py:106`), so the `RDN_` prefix is real at the data layer — which makes
the FE glob the more likely-correct route and the backend env the stale one. One contract check
settles it.

**D4 — Impound notification.** Backend `/impound/notification` vs frontend
`/dashboard-communication/fhf_notification/*/INSURANCE_LC`. Two tests named "notification", two
different routes, neither obviously wrong.

**D5 — Duplicate field contracts (structural).** FE `configs/api/**` and BE
`tests/commons/api_schemas/**` define the same response contracts independently, with no shared
source and no cross-lane diff. Transport verified: 60 fields, identical today. The first backend
rename makes one lane red for a reason nobody will connect to the other lane's green.

---

## Priority

1. **Run the backend suite once and record the result.** Every figure here is static; nothing in
   this document distinguishes a passing test from a failing one. Until that baseline exists, the
   coverage percentage describes intent, not verified behaviour.
2. UniFi API health, 6 endpoints — DB already done, cheapest chain completion.
3. Transport master-data file — 5 tests, makes all 14 modules layer-consistent.
4. Auction Invoice → Repo Invoice parity — 3 methods, 6–8 tests.
5. Resolve D1–D4 — cheap, and D1/D2 are potentially green-against-dead-routes.
6. Titles Release / Remarketing / Remarketing-Titles — 55 FE tests unbacked, backend momentum
   already exists in the Titles family.
7. Custodian, Doc Repository, Complaints — largest remaining UI-only surfaces (48 / 36 / 25 FE tests).
