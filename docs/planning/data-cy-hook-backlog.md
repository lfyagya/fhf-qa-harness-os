# `data-cy` Product Hook Ledger

**Owner:** frontend instrumentation gaps that block or weaken Cypress  
**Last consolidated:** 2026-08-21 (re-verified 2026-09-05)  
**Not owned here:** test coverage, product behavior, priorities, delivery dates, or Jira status

This is the only maintained selector backlog. Re-verify the cited frontend source before filing or
closing an item; line numbers and branch state age faster than the requested contract.

- Structural coverage: `docs/evidence/coverage-computed.json`.
- Product behavior: `docs/framework/application-intelligence/`.
- Workflow readiness/sequence: `docs/planning/roadmap/effort-breakdown-by-module-and-subdashboard.md`.

## Status

| Value | Meaning |
|---|---|
| Proposed | Source-confirmed gap; re-verify before filing |
| PO/security review | Product or access decision is required before selector work |
| Close | Hook landed and Cypress consumers were migrated |

## Re-verification 2026-09-05

Required by this ledger before filing. Checked against the local `fhf-dashboards` checkout on
`master` at `1b44f0c38`. Note the selector inventory that drives the automated dead-selector check
was built from `dev@545f15c5a`, so the two are different branches; nothing below depends on that
difference, but a filing that cites line numbers should state which branch it read.

| Item | Verified state on `master` | Change to the row |
|---|---|---|
| SH-02 | `Dropdown.tsx` emits `dropdown-toggle` plus `option-${label}`; `FormDropdown.tsx` and `FormAsyncDropdown.tsx` the same shape. `EnhancedDropdown.tsx`, `AsyncDropdown.tsx` and `CreatableAsyncDropdown.tsx` emit **zero** `data-cy`. `MultiSelect.jsx` emits zero. | Confirmed and **widened**: `AsyncDropdown` and `CreatableAsyncDropdown` were not listed and are exactly what the `asyncSelect-*` / `creatableAsyncSelect-*` consumers need. |
| SH-06 | `components/common/datePicker/DatePicker.jsx` emits **zero** `data-cy`. | Confirmed, path prefixed with `components/`. |
| SH-07 | `DatePickerTs.tsx` emits **zero** `data-cy`. `DateRangePickerTs.tsx` **does not exist** on `master`, and no `*RangePicker*` file matches. | Confirmed for `DatePickerTs.tsx`; the `DateRangePickerTs.tsx` citation needs re-confirming against `dev` or removing. |

### What is blocked today

Nine selectors declared by the automation are not emitted anywhere in the application, and are
recorded in `.claude/hooks/dead-selector-baseline.json` so the configs stay editable:

| Consumer | Selectors | Blocked by |
|---|---|---|
| Smoke `configs/ui/complaints/complaints.ui.js` | `select-complaint_type`, `select-complaint_sub_type`, `select-current_status`, `select-is_escalation`, `asyncSelect-assign_to`, `asyncSelect-dealer`, `creatableAsyncSelect-involves_user_id` | SH-02 |
| E2E `configs/ui/modules/ancillary/ancillaryDetails.ui.js` | `select-gap_status` | SH-02 |
| E2E `configs/ui/modules/ancillary/ancillaryDetails.ui.js` | `datePicker-contract_date` | SH-06 / SH-07 |

Every component that renders `complaint_type` emits zero `data-cy`, and no literal containing
`contract_date`, `gap_status`, `complaint_type`, `assign_to` or `current_status` exists in any
naming convention. These are not renames and not selectors to guess at (`source-map.md`); the
complaint form fields cannot be addressed by field name until SH-02 ships.

## Shared component contracts

| ID | Component / source | Requested stable contract | Why | Status |
|---|---|---|---|---|
| SH-02 | `components/common/dropdown/{Dropdown,FormDropdown,EnhancedDropdown,FormAsyncDropdown,AsyncDropdown,CreatableAsyncDropdown}.tsx` and filter `MultiSelect.jsx` | A caller-supplied or `id`/`name`-derived field wrapper, control, and searchable-input hook; retain existing FilterController `multi-select-*` hooks | `dropdown-input` and `dropdown-toggle` are shared across form fields, while `EnhancedDropdown` has no control hook; the generic identities cannot be reliably scoped when multiple fields coexist | Proposed |
| SH-05 | `common/dashboard/DashboardHeader.jsx` and Titles export controls | Product-specific export-action hooks | Six remaining export buttons expose only the shared `.export-btn` class; the Titles General button has only the generic `export-csv-btn`. Neither identifies the intended export action without CSS or text | Proposed |
| SH-06 | `common/datePicker/DatePicker.jsx` and seven equivalent month renderers | Field- and calendar-instance-keyed month/year select hooks | The same month/year hook pair repeats in all eight renderers, so a range picker or multiple date fields produces duplicate identities | Proposed |
| SH-07 | `DatePickerTs.tsx`, `DateRangePickerTs.tsx` | Previous/next/day hooks plus field-keyed start/end input hooks | `react-dates` classes and server-field IDs are implementation detail | Proposed |
| SH-08 | `common/tanstackTable/TanstackTable.tsx` and every `TanstackTable` mount | Require an actual stable `getRowId` at each row-producing mount; resolve selection by that opaque ID; namespace row attributes per table; make cell/action hooks row-ID-based | The shared table supports row-ID selection, but unconfigured mounts still expose visual indexes, including LHC/Total Loss Dates and Payoff plus Ancillary nested rows; raw `data-row-id` collides across table instances; cell/action `data-cy` values still embed `row.index` | Proposed |
| SH-09 | `common/checkbox/EnhancedCheckbox.tsx` consumers | Unique `'data-cy'` per call site, including `insurance-lhc-hide-completed-items` | `InsuranceTabExtraContent` leaves Hide Completed Items on the generic `checkbox` fallback, which duplicates any other default checkbox on the page | Proposed |
| SH-10 | Notes-card emitter inventory: `common/notesPanel/NoteCard.jsx`, `common/notesModal/NotesCard.jsx`, `insurance/modals/noteHistory/NoteCard.jsx`, `lossMitigation/modals/modalContent/NoteCard.jsx`, `titles/notes/NoteCard.jsx` | Add stable card hooks to the three uninstrumented emitters and maintain the five-emitter/consumer matrix; known consumers include Complaints, Funding, invoice notes, and Ancillary | Insurance, Loss Mitigation, and Titles still expose only the reused `.note-card` class; without the complete matrix, later selector work can miss a copied implementation or assign the shared card to the wrong consumer | Proposed |
| SH-11 | `commonWidgets/basicDetailsWidget/BasicDetailsWidget.js` | `basic-detail-edit-<field-key>` | Multiple edit icons require label-text scoping | Proposed |
| SH-12 | `common/accordion/Accordion.tsx` / `ExpandableTable` | Stable row and expand-toggle identity | Ancillary Verification renders many indistinguishable accordion instances | Proposed |
| SH-13 | `GlobalHeader` filter indicator | `btn-filter-menu` contract used by other dashboards | Lienholder Claim panel is mounted off-screen but has no stable open/close trigger | Proposed |
| SH-15 | `modules/callLog/contactManagement/components/Switch.tsx:10` | `dataCy` prop forwarded onto the switch input, per call site | The component takes `wrapperClassName`, so each call site contributes a different layout class and the toggle is named by whatever class the path picked: run 155 reported `.switch-wrapper > .relative` (tested) alongside `.ml-3 > .relative`, `.ml-auto > .relative`, `:nth-child(6) > .relative`, `:nth-child(8) > .relative`, `.gap-10 > :nth-child(2) > .relative`, `.pr-5 > :nth-child(1) > .relative` — the same component, seven identities. Not groupable: a `.switch-wrapper .relative` rule would collapse every toggle in the app into one control, which is too coarse to be useful. Verified 2026-07-29 | Proposed |
| SH-16 | `common/navigationBar/NavigationSlideBar.tsx:55,60` | `data-cy="btn-nav-expand-collapse"` on the toggle (`:60`), and on the slide-bar container (`:55`) both `data-cy="nav-slide-bar"` and `aria-expanded={navigationBarExpanded}` | The component carries ZERO `data-cy`. Expanded state is observable only through presentation: a framer-motion transform (`:52`, `x: -225` collapsed vs `0`), the toggle's `expand-collapse` class, a bare caret glyph (`›`/`‹`, `:64`), and `bg-blue-800` on the active item (`:74`). None is usable — `expand-collapse` is NOT unique (`modules/servicing/dashboard/ReplicantPopupHeader.tsx` carries it too), the caret is a text selector, and a transform assertion pins an animation detail so any styling change reports as a nav-state regression. `aria-expanded` is the correct accessibility attribute for a disclosure control, so it earns its place independently of the suite. Blocks all five SERV-12262 scenarios (B4.1-B4.5), including the critical root-cause case: `HeaderContext.tsx` hoists `navigationBarExpanded` out of `meta` precisely because `clearHeaderMeta` nulled it on every `usePageHeader` re-run, and nothing pins that today. Verified 2026-08-17 against origin/dev | Proposed |
| SH-17 | `common/table/multiSelect/` | Stable trigger, option, and searchable-input hooks, with an optional field prefix at each table-filter mount | The table multi-select implementation emits no `data-cy`, so a table filter cannot be targeted without DOM structure or copy | Proposed |
| SH-14 | Letter/document widgets that bypass `withWidgetContainer`: `titles/missingTitles/details/widgets/Letter60Day.jsx`, `Letter90Day.jsx`, `PayoffNotice.tsx`, `titles/release/details/LienReleaseLetter.jsx`, `ReleaseNotice.jsx`, `titles/general/details/GeneralReleaseNotice.jsx`, `modules/ancillary/details/components/GeneralInformation.tsx` | Route through `withWidgetContainer`, or emit the same container identity it does — `widgetWrapper--<className>` (`withWidgetContainer.jsx:58`) plus `widget-<widgetKey>` (`:40`) | Wrapped document widgets can be scoped by container; these cannot, so no per-widget assertion or UI Coverage rule can reach their form fields. Verified 2026-07-29: the 9 document/email entries in `components/hoc/constants.js:88-145` all carry a `widgetWrapper--` class; these seven components render equivalent letter forms with no container hook at all | Proposed |

## Module-specific contracts

| ID | Module / source | Requested stable contract | Current impact | Status |
|---|---|---|---|---|
| LM-01 | Impound table loan cell | `impound-loan-link`, `impound-view-documents` | Four smoke assertions remain blocked | Proposed |
| LM-02 | Impound `ImpoundTable.tsx` | Field-keyed inline-edit trigger | Drivable/action/follow-up editing uses an unhooked target | Proposed |
| AN-01 | Ancillary `tableConfig.tsx` client links | `ancillary-client-link` | Cypress scopes by Call Log href pattern | Proposed |
| AN-02 | Ancillary Products details widgets | Hooks for products table, document upload, and notes wrappers | Smoke relies on structural classes/text | Proposed |
| AN-03 | Ancillary Verification bulk export | Hooks for Bulk Actions, Export to Dealer, and confirmation | SERV-11868 commands use copy-text fallbacks | Proposed |
| AN-04 | Ancillary Verification contact fields | Field-name hooks for phone/email/outside-sales/web-portal inputs | Verify `GenericReactFinalField` DOM propagation before filing | Proposed |
| TI-01 | Re-Registration checklist and `AdditionalLetter.tsx` | Per-document/static-checklist and per-letter acknowledgement hooks | Same-page checkboxes cannot be uniquely targeted by product contract | Proposed |
| TI-02 | Titles/Checks loan-document name links | Module/action hook at both render sites | Identical unhooked link pattern spans two modules | Proposed |
| TI-03 | Missing Titles Payoff Notice / letter document-code checkboxes | Stable per-row hook keyed on the document code, e.g. `document-select-<code>` | The `name` attribute is the API-supplied document code (`PAYOFF_NOTICE`, `VALID_PHOTO_ID`, `POI`, `POA`, `FHF_AUTH`, `PAPER_TITLE`, `DMV`), so identity comes from data rather than the contract and shifts with the document list. Broader than TI-01, which covers Re-Registration only. Verified 2026-07-29: none of these seven names resolve to a source literal in `fhf-dashboards/src` | Proposed |
| TI-04 | Titles `loanDocuments/TitleApplications.tsx` | Key each rendered row and selection state by `letter_file_id` | React keys and selected-row state remain index-based, so a reordered or refreshed document list can bind selection to its visual position rather than its document | Proposed |
| IN-01 | Insurance Total Loss and Lienholder Claim headers/filters | `insurance-dashboard-header`, field-keyed status hook, SH-13 trigger | Filter interaction cannot be proven reliably | Proposed |
| DR-01 | Document Repository `ActionBar.tsx` | `download-queue-btn` | Current selector is title/copy coupled | Proposed |
| FU-01 | Funding Coordinator table config | Hook for external TCI/Freedom application link | Only unstable title/structure identifies the action | Proposed |
| FU-02 | Whole Funding module — `src/components/funding/` | Baseline instrumentation for all five sub-dashboards (Dashboard, Sigma/My Queue, Monthly Spreadsheet, Coordinator, Funder View): dashboard root, tab strip, table headers/cells, filter fields | **3 hooks across 92 code files**, all three on one Coordinator dropdown (`FundingCoordinatorAccountDetail.tsx:79-96`). Verified 2026-08-21 against `data-cy`, `dataCy`, `data-testid`, `data-test`. This is a broad baseline gap beyond FU-01, which covers one link. Unlike Lockbox Checks, Funding does not route through the already-instrumented shared `Tablist.jsx` / `tableTS` components, so there is no fallback contract | Proposed |
| CK-01 | `LockboxChecksDashboard.tsx:270,277` | `lbc-dashboard-container` and `lbc-tablist-container`, matching the sibling `irc-*` pair at `InsuranceChecksDashboard.tsx:119,126` | The Lockbox dashboard instead exposes the `.lockbox-checks-dashboard-wrapper` class, which occurs in three source locations. The sibling IRC dashboard has the product hooks while this one does not, purely by omission | Proposed |
| CU-01 | Custodian dashboard table config | Field-keyed hooks for eOriginal/eContract/tracking inline edits | Inline-edit cells lack product identity | Proposed |
| UC-01 | Collections payment/question-flow `ServicingTabList.tsx` | Stable key per sub-flow tab | CSS-class workaround already diverged between dev and production | Proposed |
| CO-01 | Complaints Notes and Basic Details | Apply SH-10 and SH-11 | Current checks use label/class scoping and substring matching | Proposed |
| CL-01 | Call Log `makeCall/MakeCallDropdown.tsx` and `notes/CallLogDropdown.tsx` | Inner react-select input hooks, scoped respectively to their existing dropdown containers | Both controls bypass the shared Dropdown component; their inner search inputs have no product hook | Proposed |

## Decision-gated findings discovered during selector review

These are not selector backlog items. Route the decision to the linked owner and return here only
after an approved product/access decision creates a concrete hook requirement. Application-contract
updates remain approval-gated.

| Finding | Canonical route |
|---|---|
| Missing Titles Dealer list route is unreachable; its hidden dealer field is not a selector defect | `docs/framework/application-intelligence/modules/titles/specs/missing-titles.yaml` |
| Re-Registration duplicate checkbox names/static Additional Letter identity need product confirmation as well as hooks | Proposed target: `docs/framework/application-intelligence/modules/titles/specs/re-registration.yaml` |
| Post-Funding infraction status and Titles Move-to-Main-Queue access gating need explicit RBAC review | `docs/planning/coverage/fullstack-chain-risk-matrix.md`; then the relevant application contract with approval |

## Update rule

1. Search this ledger before adding an item.
2. Cite the exact frontend component and verification date; do not infer a missing hook from a
   Cypress failure alone.
3. Keep requested hooks additive; never rename an existing selector without migrating both lanes.
4. When a hook lands, update affected config/commands/specs in the same change, then mark the row
   `Close` or remove it after generated evidence confirms no consumer remains.
5. Do not add sprint ordering or current Jira status here; those belong to the control plane.
