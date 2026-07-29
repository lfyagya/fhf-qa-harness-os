---
paths:
  - "CypressFHF/fhf-dashboards/cypress/**"
---
# Source Map — App Evidence

## fhf-dashboards (App Source)

```
fhf-dashboards/          (sibling checkout in the FHF workspace)
```

Read-only evidence source for QA. **NEVER write, edit, or create files there** — it is owned by the frontend dev team. Missing `data-cy` hook → record as a gap in the exploration report; propose upstream via PR.

Use `docs/framework/application-intelligence/` only after the source lookup needs product context.

Source shows *intended* behavior; tests verify *actual* behavior. When they diverge, the divergence IS the bug — never resolve it by adjusting tests.

Verify planning/Jira/Confluence names against live source before citing them.

### Evidence map — grep here first, browser second

| What you need | Where in fhf-dashboards | Notes |
|---|---|---|
| `data-cy` selectors | grep BOTH `src/components/{domain}/` (legacy) AND `src/modules/{domain}/` (newer) | always check both paths |
| Route constants | `src/constants/routes.js` | `DASHBOARD_MODULES` + `*_PATHS` |
| API endpoints | `src/constants/network.js` | `mainEndpoints` + `wrapperEndpoints`; ORDS calls tunnel via `ordswrapper` proxy |
| Form validation | `src/schema/{domain}/*.js` | Yup schemas — mine `.required/.min/.max/.matches` for negative cases |
| Permissions | `src/config/oktaAccessGroups.ts` + grep `useHasAccess` in `src/**` | dashboard → Okta group map; call sites = gated renders |
| Redux state shape | `src/reducers/` | state-dependent UI |
| GraphQL subscriptions | `src/schema/{domain}/` | AppSync real-time |
| Blast radius of a shared component | grep `import.*from.*'<component>'` across `src/` | importer count = regression scope; shared filter/table/nav/auth/`useHasAccess` touch every module |
| Permission-denied assertion | `useHasAccess` returns null render | unauthorized = element absent: `cy.get(sel).should('not.exist')`, never a visibility check |

### Workflow

1. Grep the App Source per the map above.
2. Cross-reference existing configs in the target repo's `CypressFHF/fhf-dashboards/cypress/configs/`.
3. Gap-list what source cannot prove (conditional renders on live data, timing).
4. Browser only for gaps — never to re-discover what grep already answered.
5. Before creating a new spec file, check the naming/structure of sibling files in the same `cypress/tests/fhf-dashboard/smoke/{module}/` directory. One file per dashboard/route is the dominant convention across the smoke repo — don't bundle multiple distinct routes into one `describe`/file unless an existing sibling already establishes that exact pattern for a comparable case. Bundling routes into one file also collapses their feature tags into one, which blocks running any one dashboard's suite independently later.

### Raw API response vs. client-side model — don't assert against the wrong shape

`cy.intercept`'s captured `response.body` is the **raw HTTP payload**, before any client-side transform. A service function in `src/services/{domain}/` commonly re-maps that raw shape into a different one (renamed fields, restructured envelope) before the rest of the app ever sees it — e.g. a raw `{ items: [{ status, status_key }] }` mapped via `.map(val => ({ label: val.status, value: val.status_key }))` into the `{ label, value }` shape components actually consume. If you assert against the field names in the *component's* type instead of the *service function's pre-map return* (grep the actual `.map()`/transform call in `src/services/{domain}/`), the assertion silently checks fields that don't exist on the real intercepted body. Always trace the service function's raw-to-model mapping (or confirm there isn't one) before writing an assertion on an intercepted response's field names.
