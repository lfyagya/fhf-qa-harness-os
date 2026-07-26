# UI Config Hierarchy — No Duplication

Selectors live in a strict two-level hierarchy. Never duplicate a `data-cy` value across module configs.

1. **`cypress/configs/ui/common.ui.js`** — selectors used by 2+ dashboards or platform-level components (filter menu, pagination, breadcrumbs, shared modals/tables).
2. **`cypress/configs/ui/{module}/`** — selectors unique to one dashboard/flow (module tables, tabs, badges, empty states).

Decision: used in 2+ modules, a shared platform component, or likely to be copy-pasted by future dashboards → `common.ui.js`. Otherwise → module config.

Reuse pattern — import, never re-declare:

```javascript
import { COMMON_UI } from '../common.ui.js';
export const ANCILLARY_EXPORT_UI = Object.freeze({
  FILTER_MENU: COMMON_UI.FILTER_MENU,  // reuse, not duplicate
});
```

Partially hook-enforced (2026-07-10) — `validate-cypress-rules.mjs` (PostToolUse) flags any `data-cy` string literal in a new/edited `configs/ui/**` file that's also declared verbatim in a sibling config file outside `common.ui.js`. It only catches literal re-declarations within the same repo's `cypress/configs/ui` tree — it can't see legitimate `COMMON_UI.X` imports (no violation) and won't catch duplication across the two separate sub-repos (E2E vs Smoke), or CSS-class selectors (too many legitimately repeat, e.g. Tailwind-ish names, to check without noise). `cypress-gate` and config audits still need to cover those two gaps.

Bare value is canonical; derive the bracket form from it (`export const TABLE_BODY_ROW = 'table-body-row'; export const TABLE_ROW = \`[data-cy="${TABLE_BODY_ROW}"]\`;`). Declaring both independently is two sources for one selector that can drift apart. Watch the naming when you add a bare constant next to an existing one: `FILTER_LOAN_NUMBER_FIELD` (`filter-loan-number`, the wrapper) beside `FILTER_LOAN_NUMBER_INPUT` (`input-field-loan-number`, the input) are different elements with near-identical names, and a mixup passes silently because `.should('be.visible')` is true of both.

## Commands — same no-duplication rule, different test

A per-module command earns its name only if its body references module-specific config.
Thin wrappers that bind config to a shared generic are the architecture working, not
duplication — do not collapse them:

```javascript
Cypress.Commands.add('interceptTitlesGeneralDashboardApis', () => {
  cy.interceptDashboardApis(TITLES_GENERAL_API, { only: TITLES_GENERAL_ALIASES });
});
```

A structural sweep of the smoke suite (912 commands, 2026-07-26) found 114 groups with an
identical implementation *shape*. 111 were legitimate per-module bindings; collapsing them
would push config imports into every spec and break Config → Commands → Tests. Only 3 groups
were real: bodies identical **and** referencing no module config — N names for one behaviour.
The first pass through that sweep misread the 111 as duplication, so apply the test, don't eyeball it.

Enforced by `scripts/check-alias-commands.js` (smoke repo), wired into `buildspec.yml` `pre_build`.
Rationale and the rejected alternative: `docs/adr/0005-per-module-command-wrappers.md`.

## Directory and file naming

**Directories are kebab-case** (`doc-repository/`, `loss-mitigation/`, `re-registration/`,
`auction-invoice/`) in all four trees — `cypress/tests`, `configs/ui`, `configs/api`,
`support/commands` — matching the app route and the `@feature-tag` for the same module
(`/post-funding`, `@post-funding`, `smoke/post-funding/`). One module, one spelling, everywhere.
`_shared/` keeps its underscore prefix.

**Files stay camelCase** (`titlesGeneral.ui.js`, `postFundingDashboard.cy.js`) — a file is named
after the constant it exports, a directory after the route it covers. That split is deliberate,
not drift.

Spec files are `<camelCaseRoute>Dashboard.cy.js` for dashboard routes; detail/sub-pages drop the
`Dashboard` suffix (`ancillaryProductsDetails.cy.js`). No `.smoke` infix — the `smoke/` directory
already says that.

Getting here took two wrong turns worth remembering. The first pass proposed kebab → camel on a
majority head-count of directory names, before checking that the kebab ones were the ones
mirroring app routes. The second kept camel for directories on the theory that filesystem and
app-facing identifiers are different namespaces — defensible in isolation, but it left the same
module spelled two ways depending on which tree you were in. Count names last; ask what the name
refers to first.
