# `data-cy` Product Hook Ledger

**Owner:** frontend instrumentation gaps that block or weaken Cypress  
**Last consolidated:** 2026-07-29  
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

## Shared component contracts

| ID | Component / source | Requested stable contract | Why | Status |
|---|---|---|---|---|
| SH-01 | `common/table/TableMeatBallMenu.tsx` | Trigger hook plus `meatball-item-<action>` | Shared trigger/items otherwise rely on a reused class; broad dashboard reach | Proposed |
| SH-02 | `DashboardGenerator/.../Dropdown*.tsx`, `MultiSelect*.tsx` | Field-keyed control and searchable-input hooks | Generic `dropdown-toggle`/`multi-select-toggle` repeats on a page; the react-select input is unhooked | Proposed |
| SH-03 | `commonTabs/TabElements.js` | `tab-<stable-key>` on each tab | Tab items have only a shared class | Proposed |
| SH-04 | `common/notifications/NotificationItem.tsx` | Stable notification-item identity | Notification rows have no product hook | Proposed |
| SH-05 | Call Recording, Custodian Exception Queue, Agent Call Volume export controls | Shared export-action hook | Current `.export-btn` class is cross-module and copy/CSS coupled | Proposed |
| SH-06 | `common/datePicker/DatePicker.jsx` and seven equivalent month renderers | Month/year select hooks | Bare native selects repeat across date-picker consumers | Proposed |
| SH-07 | `DatePickerTs.tsx`, `DateRangePickerTs.tsx` | Previous/next/day hooks plus field-keyed start/end input hooks | `react-dates` classes and server-field IDs are implementation detail | Proposed |
| SH-08 | `common/tanstackTable/TanstackTable.tsx` | Row-ID-based cell/action/select hooks | Index-based identity moves after sort/filter and row checkboxes lack hooks | Proposed |
| SH-09 | `common/checkbox/EnhancedCheckbox.tsx` consumers | Unique `dataCy` per call site | Twelve consumers inherit the generic `checkbox` fallback | Proposed |
| SH-10 | `common/notesPanel/NoteCard.js`, `notesModal/NotesCard.js` | Card, author, and content hooks | Reused `.note-card` class prevents direct per-field assertions | Proposed |
| SH-11 | `commonWidgets/basicDetailsWidget/BasicDetailsWidget.js` | `basic-detail-edit-<field-key>` | Multiple edit icons require label-text scoping | Proposed |
| SH-12 | `common/accordion/Accordion.tsx` / `ExpandableTable` | Stable row and expand-toggle identity | Ancillary Verification renders many indistinguishable accordion instances | Proposed |
| SH-13 | `GlobalHeader` filter indicator | `btn-filter-menu` contract used by other dashboards | Lienholder Claim panel is mounted off-screen but has no stable open/close trigger | Proposed |
| SH-15 | `modules/callLog/contactManagement/components/Switch.tsx:10` | `dataCy` prop forwarded onto the switch input, per call site | The component takes `wrapperClassName`, so each call site contributes a different layout class and the toggle is named by whatever class the path picked: run 155 reported `.switch-wrapper > .relative` (tested) alongside `.ml-3 > .relative`, `.ml-auto > .relative`, `:nth-child(6) > .relative`, `:nth-child(8) > .relative`, `.gap-10 > :nth-child(2) > .relative`, `.pr-5 > :nth-child(1) > .relative` — the same component, seven identities. Not groupable: a `.switch-wrapper .relative` rule would collapse every toggle in the app into one control, which is too coarse to be useful. Verified 2026-07-29 | Proposed |
| SH-14 | Letter/document widgets that bypass `withWidgetContainer`: `titles/missingTitles/details/widgets/Letter60Day.jsx`, `Letter90Day.jsx`, `PayoffNotice.tsx`, `titles/release/details/LienReleaseLetter.jsx`, `ReleaseNotice.jsx`, `titles/general/details/GeneralReleaseNotice.jsx`, `modules/ancillary/details/components/GeneralInformation.tsx` | Route through `withWidgetContainer`, or emit the same container identity it does — `widgetWrapper--<className>` (`withWidgetContainer.jsx:58`) plus `widget-<widgetKey>` (`:40`) | Wrapped document widgets can be scoped by container; these cannot, so no per-widget assertion or UI Coverage rule can reach their form fields. Verified 2026-07-29: the 9 document/email entries in `components/hoc/constants.js:88-145` all carry a `widgetWrapper--` class; these seven components render equivalent letter forms with no container hook at all | Proposed |

## Module-specific contracts

| ID | Module / source | Requested stable contract | Current impact | Status |
|---|---|---|---|---|
| LM-01 | Impound table loan cell | `impound-loan-link`, `impound-view-documents` | Four smoke assertions remain blocked | Proposed |
| LM-02 | Impound `ImpoundTable.tsx` | Field-keyed inline-edit trigger | Drivable/action/follow-up editing uses an unhooked target | Proposed |
| LM-03 | Impound Notes column icon, `modules/lossMitigation/dashboard/ImpoundTable.tsx:339-344` | Note-state hook on the cell, e.g. `impound-notes-state-<rowIndex>` valued `has-note`/`no-note`, or a `data-cy` on `IconNote` / `IconPlusCircleOutlined` | `FL-IMP-013` expects a saved note to be observable in the Notes column, but the cell only swaps `IconNote` for `IconPlusCircleOutlined` and both render as a bare `<svg>` with no hook (`assets/svgIcon/note.tsx`, `plusCircleOutlined.tsx`). The wrapper `impound-add-notes-<rowIndex>` is identical in both states. Cypress currently keys on the icon's intrinsic `viewBox` (note 18x20 vs plus-circle 16x16) — component identity rather than layout position, so it holds until the artwork changes. A hook would remove that coupling; this is hardening, not a coverage blocker. Verified 2026-09-03 | Proposed |
| AN-01 | Ancillary `tableConfig.tsx` client links | `ancillary-client-link` | Cypress scopes by Call Log href pattern | Proposed |
| AN-02 | Ancillary Products details widgets | Hooks for products table, document upload, and notes wrappers | Smoke relies on structural classes/text | Proposed |
| AN-03 | Ancillary Verification bulk export | Hooks for Bulk Actions, Export to Dealer, and confirmation | SERV-11868 commands use copy-text fallbacks | Proposed |
| AN-04 | Ancillary Verification contact fields | Field-name hooks for phone/email/outside-sales/web-portal inputs | Verify `GenericReactFinalField` DOM propagation before filing | Proposed |
| TI-01 | Re-Registration checklist and `AdditionalLetter.tsx` | Per-document/static-checklist and per-letter acknowledgement hooks | Same-page checkboxes cannot be uniquely targeted by product contract | Proposed |
| TI-02 | Titles/Checks loan-document name links | Module/action hook at both render sites | Identical unhooked link pattern spans two modules | Proposed |
| TI-03 | Missing Titles Payoff Notice / letter document-code checkboxes | Stable per-row hook keyed on the document code, e.g. `document-select-<code>` | The `name` attribute is the API-supplied document code (`PAYOFF_NOTICE`, `VALID_PHOTO_ID`, `POI`, `POA`, `FHF_AUTH`, `PAPER_TITLE`, `DMV`), so identity comes from data rather than the contract and shifts with the document list. Broader than TI-01, which covers Re-Registration only. Verified 2026-07-29: none of these seven names resolve to a source literal in `fhf-dashboards/src` | Proposed |
| IN-01 | Insurance Total Loss and Lienholder Claim headers/filters | `insurance-dashboard-header`, field-keyed status hook, SH-13 trigger | Filter interaction cannot be proven reliably | Proposed |
| DR-01 | Document Repository `ActionBar.tsx` | `download-queue-btn` | Current selector is title/copy coupled | Proposed |
| FU-01 | Funding Coordinator table config | Hook for external TCI/Freedom application link | Only unstable title/structure identifies the action | Proposed |
| CU-01 | Custodian dashboard table config | Field-keyed hooks for eOriginal/eContract/tracking inline edits | Inline-edit cells lack product identity | Proposed |
| UC-01 | Collections payment/question-flow `ServicingTabList.tsx` | Stable key per sub-flow tab | CSS-class workaround already diverged between dev and production | Proposed |
| CO-01 | Complaints Notes and Basic Details | Apply SH-10 and SH-11 | Current checks use label/class scoping and substring matching | Proposed |

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
