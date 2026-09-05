# SERV filing drafts — data-cy hook gaps SH-02 / SH-06 / SH-07

**Prepared:** 2026-09-05 · **Status:** awaiting Atlassian authorization, then owner approval to create
**Project:** SERV ("Services Team Scrum") · **Issue type:** Task · **Service App:** Callcenter (default)
**Source of truth:** `docs/planning/data-cy-hook-backlog.md` — do not let these drafts diverge from the ledger

Re-verified against `fhf-dashboards` `master` @ `1b44f0c38` on 2026-09-05, per the ledger's own
"re-verify before filing" requirement. The selector inventory driving the automated check was built
from `dev@545f15c5a`; these drafts cite files, not line numbers, so the branch difference does not
affect them.

Not filed. `capability-doctor --capability jira-ticket-read` returns `access-request-required`, and
`.claude/rules/jira-integration.md` requires a prepared draft plus explicit approval before any
create.

---

## Draft 1 — SH-02

**Summary:** Add field-derived `data-cy` hooks to the shared dropdown family

**Description:**

The dropdown components emit identities that cannot be scoped to a field, so automation cannot
address an individual dropdown on a form that contains more than one.

Verified on `master` @ `1b44f0c38`:

| Component | `data-cy` today |
|---|---|
| `components/common/dropdown/Dropdown.tsx` | `dropdown-toggle` (shared), `option-${label}` |
| `components/common/dropdown/FormDropdown.tsx` | same shape |
| `components/common/dropdown/FormAsyncDropdown.tsx` | same shape |
| `components/common/dropdown/EnhancedDropdown.tsx` | **none** |
| `components/common/dropdown/AsyncDropdown.tsx` | **none** |
| `components/common/dropdown/CreatableAsyncDropdown.tsx` | **none** |
| `components/DashboardGenerator/filterGenerator/Filters/MultiSelect.jsx` | **none** |

`dropdown-toggle` is identical for every dropdown rendered on a page, so a form with several
dropdowns produces several elements with the same identity. `EnhancedDropdown`, `AsyncDropdown` and
`CreatableAsyncDropdown` have no control hook at all.

**Requested contract:** a caller-supplied or `id`/`name`-derived hook on the field wrapper, the
control, and the searchable input. Existing FilterController `multi-select-*` hooks should be
retained; this is additive.

**Why it matters now:** seven selectors in the production-smoke Complaints configuration are
declared against hooks that do not exist, so those assertions cannot pass. Every component that
renders `complaint_type` emits zero `data-cy`, and no literal containing `complaint_type`,
`complaint_sub_type`, `current_status`, `is_escalation`, `assign_to` or `involves_user_id` exists in
the application in any naming convention. One further selector, `select-gap_status` in the E2E
Ancillary cancellation form, has the same cause.

**Acceptance criteria:**
- Each of the seven components above emits a hook derived from the field `id`/`name`, or accepts one
  from the caller.
- Two dropdowns rendered on the same form have distinct identities.
- Existing `multi-select-*` and `option-*` hooks are unchanged.

**Labels:** `testability`, `data-cy`
**Blocked automation:** smoke `configs/ui/complaints/complaints.ui.js` (7 selectors), E2E
`configs/ui/modules/ancillary/ancillaryDetails.ui.js` (`select-gap_status`)

---

## Draft 2 — SH-06

**Summary:** Add field- and calendar-instance-keyed `data-cy` hooks to `DatePicker.jsx`

**Description:**

`components/common/datePicker/DatePicker.jsx` emits **zero** `data-cy` (verified on `master` @
`1b44f0c38`). The same month/year renderer shape repeats across the equivalent month renderers, so a
range picker, or a form with two date fields, produces duplicate identities with nothing to
distinguish them.

**Requested contract:** field-keyed and calendar-instance-keyed hooks on the month and year selects,
so a specific date field's calendar can be addressed unambiguously.

**Acceptance criteria:**
- A date field's calendar controls are addressable by the field key.
- Two date fields on one form do not produce colliding identities.

**Labels:** `testability`, `data-cy`

---

## Draft 3 — SH-07

**Summary:** Add previous/next/day and field-keyed input hooks to `DatePickerTs.tsx`

**Description:**

`components/DashboardGenerator/filterGenerator/Filters/DatePicker/DatePickerTs.tsx` emits **zero**
`data-cy` (verified on `master` @ `1b44f0c38`). Automation currently has to reach for `react-dates`
class names and server-side field ids, both of which are implementation detail and change without
notice.

**Requested contract:** hooks on the previous/next/day controls, plus field-keyed start and end
input hooks.

**Blocked automation:** `datePicker-contract_date` in E2E
`configs/ui/modules/ancillary/ancillaryDetails.ui.js`.

**Acceptance criteria:**
- Previous, next and day controls carry stable hooks.
- Start and end inputs are addressable by field key.
- No automation needs to reference a `react-dates` class.

**Open question for the reporter — resolve before filing:** the ledger row also cites
`DateRangePickerTs.tsx`. That file **does not exist** on `master`, and no `*RangePicker*` file
matches anywhere under `src/`. Either it is `dev`-only, it was renamed, or the citation is stale.
Confirm against `dev` and either add the real path or drop the citation; do not file the name as-is.
