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
