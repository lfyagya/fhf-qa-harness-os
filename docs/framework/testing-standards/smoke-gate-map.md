# Smoke Gate Map — UI → API → DB, per sub-module

The concrete instantiation of `smoke-execution-strategy.md` §3: for every sub-module, which existing
test is the gate at each layer, what tag it carries, and where no candidate exists.

**Derived.** Reasoning lives in `smoke-execution-strategy.md`; MUST/SHOULD/MUST NOT in
`smoke-checklist.md`; per-module chain gaps in `planning/smoke-ui-api-db-chain-coverage.md`. This
file adds no policy — it resolves policy to test names.

**Every cited test name was read from source** 2026-08-20: FE `it()` titles from
`cypress/tests/fhf-dashboard/smoke/**`, BE `def test_*` from `tests/smoke/**` @ `b8c6dc4`.
`**GAP**` means no test exists at that layer — not that one exists and is untagged.

---

## Tag vocabulary

Reuses what already exists. **No new tag namespace.**

### UI lane — `cypress/configs/tags/tags.config.js`

Already defines everything needed; nothing to add.

| Tag | Meaning | Applied by this map |
|---|---|---|
| `S.CRITICAL` | gate tier — blocks the push | the gate test per route, **max 3** |
| `S.QUARANTINE` / `S.FLAKY` | runs, excluded from the verdict | unchanged |
| `S.WIP` | excluded from CI | unchanged |
| `C.*` (LOAD, UI, API_SHAPE, FILTER, NAV, DETAIL) | category — orthogonal to tier | unchanged |

Grouping stays `describe` → `context` → `it`, with `SUITE_TAGS.<MODULE>.<SUBMODULE>` on the
`describe`. The gate is selected by `--env grepTags=@critical`, not by directory.

### API + DB lane — new, because it has none

`pytest.ini` declares no markers; the smoke suite uses only `order` and `parametrize`. Two markers,
mirroring the UI vocabulary so one word means one thing in both lanes:

```ini
# pytest.ini
markers =
    critical: smoke gate — blocks the deploy; must pass before any release
    quarantine: isolated from the pass/fail verdict; runs and reports
```

Selection: `pytest tests/smoke -m critical` for the gate, unmarked for the sweep. Layer is already
expressed by filename (`*_db_connectivity.py` / `*_master_data.py` / `*_api_health.py`) — do not
duplicate it as a marker.

### Gate composition per sub-module

Ordered by cost of failure, per the strategy doc's layer table — a broken dependency should never be
discovered by a UI timeout:

| # | Layer | Gate content | Marker / tag |
|---|---|---|---|
| 1 | DB | tables + views exist; packages/procs `VALID` | `@pytest.mark.critical` |
| 2 | DB | reference key set exact | `@pytest.mark.critical` |
| 3 | API | primary endpoint 200 within budget | `@pytest.mark.critical` |
| 4 | UI | route loads + primary container renders | `S.CRITICAL` |

**Four per sub-module, not three.** §3's cap of 3 governs the *UI lane only*, which is what it was
written about. In practice 32 of 39 UI specs need just **one** critical test, because their load
test already asserts route + API 200 + table render in one go ("dashboard loads with API responses
and table UI"). Ancillary is the exception — it uses granular `TC-` IDs and needs 2–3.

---

## The map

Cited names are exact. `—` = covered by a shared module-level test, not a per-sub-module one.

⚠ **Name is not unique.** `test_dashboard_returns_200_and_within_time` is defined three times —
`impound/`, `recon/`, and `transport/test_*_api_health.py`. Always qualify it by path; `pytest -k`
on the bare name selects all three. Across the suite there are 391 test definitions under 365
distinct names, so this is a general hazard, not a one-off — prefer `-m critical` over `-k` for
selection.

### Core

| Sub-module | DB gate | MD gate | API gate | UI gate |
|---|---|---|---|---|
| Oracle connectivity | `test_oracle_db_connection_is_operational` | n/a | n/a | n/a |

### Ancillary — BE is one module (`tests/smoke/ancillary`) covering ACD + APD

| Sub-module | DB gate | MD gate | API gate | UI gate |
|---|---|---|---|---|
| ACD General Dashboard | `test_ancillary_tables_exist` | `test_acd_cancellation_reason_keys_exist` | `test_get_main_dashboard` | `TC-GEN-LOAD` ✅, `TC-GEN-UI-001` ✅, `TC-GEN-API` ✅ |
| ACD Followup | — | — | `test_get_provider_group_by_administrator` | `TC-FUP-LOAD` ✅, `TC-FUP-LOAD-003` ✅, `TC-FUP-UI-001` ✅ |
| ACD Record Details | — | — | **GAP** | `TC-DET-LOAD` ✅, `TC-DET-LEFT-001` ✅ |
| APD Products | — | `test_apd_process_status_keys_exist` | `test_get_products_dashboard` | `TC-PRD-LOAD` ✅, `TC-PRD-UI-001` ✅ |
| APD Verification | — | — | `test_get_administrator_dashboard` | `TC-VER-LOAD` ✅, `TC-VER-LOAD-003` ✅, `TC-VER-UI-001` ✅ |
| APD Product Details | — | — | **GAP** | `TC-PDT-LOAD` ✅, `TC-PDT-LEFT-001` ✅ |
| Export Activity | — | — | `test_get_export_activity_status` | `TC-EXP-LOAD` ✅, `TC-EXP-LOAD-003` ✅, `TC-EXP-UI-001` ✅ |

✅ = already tagged `S.CRITICAL`. Ancillary is the only module where tagging is done.

### Loss Mitigation

| Sub-module | DB gate | MD gate | API gate | UI gate |
|---|---|---|---|---|
| Assignment | `test_assignment_tables_exist` + `test_qualification_trigger_is_valid` | `test_exactly_two_assignment_actions_exist` | `test_get_assignment_accounts` | `dashboard loads with API responses and card UI` |
| Repo | `test_repo_tables_exist` + `test_repo_procedures_exist_and_valid` | `test_exactly_six_repo_rows_exist` | `test_get_repo_accounts` | `dashboard loads with API responses and card UI` |
| Skip | `test_skip_tables_exist` + `test_skip_tasklist_flush_package_is_valid` | `test_expected_skip_rows_exist` | `test_get_skip_accounts` | `dashboard loads with API responses and card UI` |
| Remarketing | `test_remarketing_tables_exist` + `test_titles_remarketing_package_is_valid` | `test_active_remarketing_action_keys_exact_set` | `test_get_remarketing_accounts` | `dashboard loads with API responses and card UI` |
| Impound | `test_impound_tables_exist` + `test_pkg_impound_dashboard_is_valid` | `test_impound_status_exact_set` | `test_dashboard_returns_200_and_within_time` ⚠ | `dashboard loads with API responses and table UI` |
| Transport | `test_transport_tables_exist` + `test_pkg_transport_is_valid` | **GAP — no `test_transport_master_data.py`** | `test_dashboard_returns_200_and_within_time` ⚠ | `dashboard loads with API responses and table data` |
| Recon | `test_recon_tables_exist` + `test_pkg_recon_dashboard_body_is_valid` | `test_recon_action_status_exact_set` | `test_dashboard_returns_200_and_within_time` ⚠ | `all dashboard APIs return 200 and table renders with rows` |
| Repo Invoice | `test_repo_invoice_tables_exist` | `test_repo_invoice_status_keys_exist` | `test_get_repo_invoices_list_returns_200_within_response_time` | `Invoices tab loads with API responses and table data` |
| Auction Invoice | `test_auction_invoice_tables_exist` | `test_auction_invoice_status_keys_exist` | `test_get_auction_invoices_list_returns_200_within_response_time` | `Invoices tab loads with API responses and table data` |

### Titles

| Sub-module | DB gate | MD gate | API gate | UI gate |
|---|---|---|---|---|
| General | `test_titles_general_tables_exist` + `test_pkg_titles_dashboard_body_is_valid` | `test_title_location_exact_set` | `test_titles_general_dashboard_returns_200` | `dashboard loads with API responses and table UI` |
| Missing Titles | `test_missing_titles_tables_exist` + `test_pkg_missing_titles_spec_is_valid` | `test_scenario_type_exact_set` | `test_client_summary_returns_200_within_time` | `client list loads with API responses and table UI` |
| Re-Registration | `test_rereg_tables_exist` + `test_pkg_rereg_dashboard_is_valid` | `test_rereg_status_has_expected_rows` | `test_rereg_tracker_priority_0_returns_200` | `dashboard loads with API responses and table UI` |
| Release | **GAP** | **GAP** | **GAP** | `dashboard loads with API responses and table UI` |
| Remarketing | ◐ via LM Remarketing | ◐ via LM Remarketing | **GAP** | `dashboard loads with API responses and table UI` |
| Remarketing-Titles | ◐ via LM Remarketing | ◐ via LM Remarketing | **GAP** | `dashboard loads with Remarketing tab (default-active) API 200 and table rows` |

### UniFi

| Sub-module | DB gate | MD gate | API gate | UI gate |
|---|---|---|---|---|
| Collections | `test_unifi_tables_exist` | `test_unifi_master_data_lookup` | `test_get_collection_lookup` | `dashboard loads with API responses and table UI` |
| Servicing | — | — | `test_get_collection_lookup_non_delinquent` | `Servicing dashboard loads with API responses and table rows visible` |

### UI-only — no backend module exists

Gate is the UI test alone until the backend lands. Listed so the absence is explicit, not implied.

| Module | Sub-module | UI gate | DB / MD / API |
|---|---|---|---|
| Custodian | Dashboard | `dashboard loads with API responses and all tabs visible` | **GAP** |
| Custodian | Exception Queue | `loads dashboard with 200 API responses for all three endpoints` | **GAP** |
| Custodian | Portfolio View | `returns a valid paginated API envelope and renders table rows` | **GAP** |
| Custodian | Request | `returns a valid paginated API envelope and renders table rows` | **GAP** |
| Doc Repository | Dashboard | `Loan Packages loads with API responses and table UI` | **GAP** |
| Complaints | Dashboard | `dashboard loads with API responses and table rows` | ◐ 3 views via UniFi DB; API **GAP** |
| Contracts | Dashboard | `dashboard loads with API responses and table UI` | **GAP** |
| Insurance | Lienholder Claim | `dashboard loads with all APIs 200 and table renders with row data` | **GAP** |
| Insurance | Total Loss | `dashboard loads with all APIs 200 and table renders with row data` | **GAP** |
| Call Reports | Agent Call Volume | `Agent Call Volume loads with API response and table UI` | **GAP** |
| Call Reports | Call Recording | `Call Recording loads with API response and table UI` | **GAP** |
| Letters Tracking | Dashboard | `dashboard loads with API responses and table rows` | **GAP** |
| Checks | Insurance Repair | `Main tab loads with API response and table UI` | **GAP** — and the spec is `describe.skip` pending the Okta grant (§9) |
| Post Funding | Dashboard | `dashboard loads with API responses and card UI` | **GAP** |

### Cross-cutting

| Scenario | Test | Tag |
|---|---|---|
| Unauthenticated access is rejected | `common/unauthenticated.smoke.cy.js` (2 tests) | `S.CRITICAL` — but see §9: this spec currently fails the raw-intercept rule |

---

## Resulting gate size

| Lane | Gate tests | Of total | Budget |
|---|---:|---:|---|
| DB connectivity | 14 + 11 validity = 25 | of 87 | — |
| Master data | 13 | of 66 | — |
| API health | 21 | of 238 | — |
| **Backend total** | **59** | of 391 | < 5 min |
| UI | 19 tagged (Ancillary) + 32 to tag = **51** | of 652 | < 3 min |
| **Gate total** | **110** | of 1,043 (**10.5%**) | < 8 min |

10.5% lands almost exactly on the ~10% top-of-pyramid ratio the strategy doc's §8 cites, arrived at
independently — which is a reasonable sign the cap is calibrated rather than guessed.

---

## Work order

1. **Tag the 32 untagged UI specs** — one `S.CRITICAL` on the load test named in the map above.
   Mechanical; the 7 Ancillary specs are the reference. Inert until `SMOKE_TIER` lands (§6 change 2).
   `validate-cypress-rules.mjs` already warns on every untagged smoke spec, so progress is visible.
2. **Add the two pytest markers** to `pytest.ini`, then mark the 59 backend gate tests.
3. **Close the two cheap MD/API gaps** so no gate row reads GAP for a module that has the other two
   layers: Transport master data (5 tests), ACD Record Details + APD Product Details API health
   (6–12 tests).
4. **Then the module-shaped gaps** — Titles Release / Remarketing / Remarketing-Titles, then
   Custodian / Doc Repository / Complaints. Sequenced and sized in
   `planning/smoke-ui-api-db-chain-coverage.md`.

Do **not** tag a test that does not yet exist. A gate row reading `**GAP**` is the honest state; a
tag on a placeholder is how a dead module hides inside a green build (§1.5).
