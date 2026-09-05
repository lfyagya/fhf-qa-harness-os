---
paths:
  - "CypressFHF/fhf-dashboards/cypress/**"
---
# Contract-First Cypress Architecture

Read `ai-pilot.md` before starting a new or intentionally migrated domain. An approved scenario,
published contract, controlled state, and required evidence are entry criteria; missing selectors
or state are a testability proposal, not an automation shortcut.

Automation mirrors the application's **public domain contract**, not its internal component,
hook, service, or migration-era folder structure. A domain contract has five stable parts:

1. **Route** - a named application route, published by the application and consumed through
   `cypress/configs/app/routes.js`.
2. **Access** - the role/group precondition required to reach the surface.
3. **API** - named request contracts (method, endpoint, alias, status) in the domain API config.
4. **UI** - supported `data-cy` hooks in the domain UI config.
5. **Scenario** - the approved user outcome, traceability, and assertions.

New or deliberately migrated domains use this shape:

```text
cypress/
  configs/
    app/routes.js                          # application-published route contract
    ui/.../{surface}.ui.js                  # data-cy contract only
    api/.../{surface}.api.js                # request contract only
    tags/                                   # tag taxonomy constants
  fixtures/{module}/{surface}/              # deterministic response/request data
  support/commands/
    common/                                 # proven cross-domain behaviour only
    .../{surface}.setup.commands.js         # intercept/stub ownership
    .../{surface}.navigate.commands.js
    .../{surface}.interact.commands.js
    .../{surface}.assert.commands.js
  tests/fhf-dashboard/{e2e|smoke}/{module}/ # thin orchestration only
```

**The module level differs by lane and is not yet converged.** Measured 2026-09-05. The `...` above
is deliberate: no single module path is true in both lanes.

| | E2E | Smoke |
|---|---|---|
| `configs/` subdirs | `api app scenarios shared tags ui` | `api app tags ui` |
| module level under `configs/ui/` | `modules/{module}/` (9) | flat `{module}/` (14), plus a stray `modules/unifi/` |
| module level under `support/commands/` | `modules/{module}/` | flat `{module}/` (18) |
| top-level exception | `doc-repository/` in both trees | `doc-repository/` in both trees |

Do not "fix" a path to match this document. Follow the layout of the lane you are editing and put a
new module where that lane's siblings already are. Converging the two is a real refactor across both
repositories and needs its own decision - it is not drift to be silently corrected file by file.

Known deviations, recorded rather than hidden:

- `configs/ui/modules/lossMitigation/` (E2E) is the only camelCase directory in either lane and
  breaks the kebab-case rule below. It is also the cause of 19 duplicate-selector collisions: one
  module with two spellings declares the same literals in `loss-mitigation.ui.js` and
  `lossMitigationFilter.config.js`. Renaming it to `loss-mitigation/` and updating its two importers
  (`dashboardFilterRegistry.config.js`, `loss-mitigation.commands.js`) removes the cause; the
  duplicates are carried in `duplicate-selector-baseline.json` until then.
- `doc-repository/` sits beside `modules/` rather than inside it, in both lanes and both trees.
- `configs/scenarios/` and `configs/shared/` exist only in E2E.

The application publishes route and selector contracts; Cypress consumes a checked-in generated
or validated representation. Cypress must never import application source directly, duplicate
application implementation details, or rely on a redirect as proof that a route is current.

**Layer ownership is strict:** specs call domain commands; domain commands own
`cy.apiIntercept()` / `cy.apiInterceptAll()` / `cy.intercept()` and waits; configs own constants;
fixtures own deterministic stub bodies. A spec may select a named fixture through a setup command,
but it must not register a raw intercept or embed a large stub payload. A missing stable `data-cy`
hook is an application testability backlog item, not a reason to normalize CSS or text-selector
fallbacks.

Legacy layouts are migration candidates, not a second standard. Do not reorganize an untouched
working module opportunistically. Apply this structure whenever a domain is added or intentionally
refactored, then retire the old path only after its imports and command ownership are migrated.

# Selector Hierarchy - No Duplication

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

A second class the duplicate check cannot see, because there is only ever one of each:
a **pass-through** — a command whose body forwards its own parameters unchanged to another
command. It contributes a name and nothing else. Three existed (2026-07-26), two of them in the
shared tier so every module wrapper inherited the extra hop:
`interceptDashboardApis`→`apiInterceptAll`, `waitForDashboardApis`→`apiWaitAll`, and
`getElement`→`cy.get` (318 sites — a rename of a Cypress built-in with no added behaviour).

Never alias a Cypress built-in. `cy.getElement(x)` for `cy.get(x)` forces every reader to learn
a synonym and hides which primitive is actually running. A command wrapping a plain *function*
(`apiInterceptAll` → `registerAllIntercepts`) is a real boundary and stays.

Both classes are enforced by `scripts/check-alias-commands.js` (smoke repo), wired into
`buildspec.yml` `pre_build`.

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
