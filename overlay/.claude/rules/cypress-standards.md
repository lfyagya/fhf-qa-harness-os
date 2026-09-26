---
paths:
  - "front-end-automation-e2e/**"
  - "front-end-automation-smoke/**"
---
# Cypress Standards — both lanes

Package root in both lanes: `CypressFHF/fhf-dashboards/`. Architecture and file layout:
`ui-config-hierarchy.md`. Selector/assertion scoping: `assertion-precision.md`. Failures:
`failure-classification.md`. App evidence: `source-map.md`.

## Lanes

| Lane | Repo @ branch | Environment | Mutations |
|---|---|---|---|
| Smoke | `front-end-automation-smoke` @ `staging` | Production | Never. GET-only. No submit, send, export, upload, or download actions. Retries `runMode: 0` — smoke failure = production incident |
| E2E | `front-end-automation-e2e` @ `dev` | Dev/QA | Read interactions, or controlled synthetic mutations with verified cleanup |

Signals: "smoke", "availability", "production", or no interaction depth → Smoke. "filter",
"sort", "tab", "expand", "E2E", or explicit workflow depth → E2E. Genuinely ambiguous → ask; never
silently pick one. Production smoke rules for artifacts: `prod-data-handling.md`.

## Entry criteria (new or migrated domain)

Before writing a spec, have: an approved scenario with traceability and expected outcome; the
application route, access precondition, API contract, and stable `data-cy` hooks; controlled
state (deterministic fixtures/stubs, or a Dev/QA seed-and-cleanup plan); the lane and the evidence
that accepts the change. Anything missing → stop and write a testability/specification proposal.
Never substitute CSS, text, index, or real-record selectors, arbitrary waits, or a broader scope
for a missing contract. AI-generated changes are an uncommitted patch or draft PR only — never
self-approved, never merged by the agent.

## Non-negotiables

```
NEVER  cy.wait(number)                Use cy.apiWait() or .should('be.visible')
NEVER  hardcoded selectors            Constants from cypress/configs/ui/**
NEVER  hardcoded endpoints/routes     Constants from cypress/configs/api/** and configs/app/routes.js
NEVER  new *.actions.js / page-object Command-first only; migrate legacy ones when touched
NEVER  real PII in fixtures           Faker.js or anonymized data
NEVER  real credentials in code       cypress.env.json (gitignored) / cy.env(); never Cypress.env()
NEVER  mutations in smoke             GET-only, always
NEVER  monetary/date via .contain()   Exact match; dayjs for dates
NEVER  --retries / { timeout: 60000 } as a flake fix — find the root cause

ALWAYS cy.ensureAuthenticated()       In before() AND beforeEach() of every auth-required describe
ALWAYS intercept before navigate      cy.intercept*Apis() before cy.navigateTo*() in beforeEach()
ALWAYS testIsolation: true            On every describe() options object
ALWAYS Object.freeze()                On every exported config object
ALWAYS ≥1 .should() per it()          No assertion-free test blocks
```

Cypress mechanics (correctness, not style):

- Register aliases (`.as()`, including intercept aliases) in `beforeEach`, not `before` — Cypress
  clears aliases between tests.
- Never mix the command queue with manual Promises/`async`/`await`. Stay in `.then()` chains; only
  return Cypress chains.
- Reset state before a test rather than cleaning up after it.
- `cy.env()` is built in (Cypress 15.10+); `allowCypressEnv: false` in `cypress.config.*` blocks
  `Cypress.env()` on purpose. Never flag `cy.env()` as unregistered.
- Titles: `'[action] → [expected result]'`, plain English. The title is a claim the assertions must
  make (`assertion-precision.md` rule 7).
- One Arrange → Act → Assert pass per `it()`, not interleaved act/assert.

## Tags

Tag constants live in `cypress/configs/tags/`. Every `describe` carries TYPE + MODULE + FEATURE +
BEHAVIOR, always through `SUITE_TAGS` — never a raw tag array. `context()` carries no tags. Every
`it` carries exactly the STATUS flags it needs, only from `@critical | @flaky | @wip | @quarantine`.
Currently a warning, not a blocker, until both lanes are tagged — flag under-tagging, do not block
on it.

## Commands and reuse

Reuse before you write: grep `cypress/support/commands/**` and `cypress/configs/**` for an
existing command, selector, route, or API entry before adding one. A second command or constant
doing the same job is a defect even if both pass (`ui-config-hierarchy.md`).

Commands are verb-first camelCase, registered with `Cypress.Commands.add`, and named for the
business surface they act on — `assertRepoAssignmentQueueCount`, not `checkTable2`:

| Job | Pattern |
|---|---|
| Register GET intercepts | `intercept<Surface>DashboardApis` / `intercept<Surface>DetailApis` |
| Navigate | `navigateTo<Surface>` (asserts the landed URL) |
| Wait | `waitFor<Surface>DashboardApis` (via `cy.apiWaitAll`) |
| Assert | `assert<Surface><What>` |
| Act | `clickFirst<Surface>Card`, `apply<Surface>Filter`, … |

- No `if/else` or DOM-conditional branching inside a command; drive the state so the path is
  known. Assertions live only in `assert*` commands.
- A command that navigates (click → new page) registers the next page's intercepts first.
- Selectors, routes, and endpoints come only from `cypress/configs/**` constants — in commands and
  in specs alike. Spec files call commands; they never hold raw selectors.
- One command file per surface (`dashboard.commands.js`, `detail.commands.js`), imported by the
  surface entry point `cypress/support/commands/<surface>.commands.js`. File and folder naming:
  `ui-config-hierarchy.md`.

## Cypress practices (official docs)

From docs.cypress.io best practices; each is a correctness rule here, not style:

- Never assign a command's return value to a variable; use aliases or `.then()` closures.
- Every `it()` passes on its own, in any order. No test relies on state a previous test left.
- Log in programmatically and cache it (`cy.ensureAuthenticated()` / `cy.session()`), never through
  the login UI in every test.
- Wait on explicit conditions only: intercept aliases (`cy.apiWait`/`cy.apiWaitAll`) and retrying
  `.should()` assertions. No `cy.wait(ms)`, no hand-written polling loops.
- Never branch on what the DOM happens to show (conditional testing). Control the data instead.
- Visit only apps we control; reach third-party systems through `cy.request()`, never `cy.visit()`.
- `cy.visit()` uses relative routes against the configured `baseUrl`.
- Secrets through `cy.env()` only; `Cypress.expose()` is for non-secret public configuration.

## Merge readiness

A new or changed spec is merge-ready only when it has passed **5 consecutive Cypress Cloud runs
with no retries**, and every `it()` narrates its steps with `cy.step()`. A spec that needed a retry
to pass is flaky, not green (`failure-classification.md`).

## Test data

- Allowed sources: fixture key, synthetic builder, API seed, hermetic inline data.
- Forbidden: production PII, shared mutable records, untracked live records.
- Each test owns or resets every record it mutates; verify cleanup before reporting pass.
- A persistent E2E mutation needs: synthetic owned identity, known baseline, exact request and
  result, prohibited outcome, verified cleanup.
- Missing required state fails with diagnostics or is excluded before execution with an owned
  reason. It never logs "Skipping" and passes.
- Smoke may compare a live read response to its rendered DOM without retaining the payload.

## False green

Not accepted as coverage: fallback markers, disabled suites, a stubbed mutation claimed as a
workflow, structural inventory claimed as product coverage. A status code, visibility check, row
count, or stub alone cannot claim workflow protection. Only a product spec with status `approved`
supports an "accepted workflow coverage" claim; against a draft spec, label the test
structural/implementation evidence.

## Scenarios

Scenario objects (E2E: `cypress/configs/scenarios/**`) carry: `id` (`[TICKET]-[type]-[nn]`),
`jiraId`, `ac`, `name`, `type` (positive|negative|edge), `given`, `when`, `then` (an observable UI
or API outcome), `priority` (critical|high|medium|low), `testType` (smoke|e2e), `riskCategory`,
`impact` (one line: what breaks, for whom, if this silently fails), `productSpec` (exact path under
`Test-Case-Automation-Using-Claude-Agents/specs/`), `productSpecStatus`, `applicationEvidence`
(implementation source paths), `assertions` (required and, where applicable, prohibited outcomes).

`riskCategory` is one of `money-flow`, `data-integrity`, `daily-workflow`, `integration-api`,
`state-transition`, `compliance-regulatory`, `cosmetic-low-risk`; it decides what the assertion
must check — exact value for `money-flow`, actual persisted state for `data-integrity`, contract
shape for `integration-api`, audit trail for `compliance-regulatory`. `priority` decides depth for
a filter/sort/search/toggle control: critical/high → one test that both earns UI Coverage credit
and asserts real behavior; medium/low → render-only is the complete answer, and a dedicated
behavior test on top is over-testing. Modules are retrofitted opportunistically; an untagged
module is not a violation. A documented deliberate render-only exception (e.g. search's SERV-3637
nondeterminism) is not a violation either.

## Interaction contract (every filter/sort/search/clear test)

Prove the request, returned records, and rendered records correspond — a smaller count alone
proves nothing:

```javascript
cy.apply[Dashboard]Filter(knownFilter);
cy.apiWait(DASHBOARD_API.LIST).then(({ request, response }) => {
  expect(request.query.<filter_field>).to.equal(knownFilter);
  expect(response.body.data.every(item => <source-verified predicate>)).to.equal(true);
  cy.get(<ROW_SELECTOR>).should('have.length', response.body.data.length);
});
```

Sort: prove monotonic order of known returned values. Clear: prove the filter parameter is
absent/reset and rendered rows map to that response. Never assume a filter must reduce count.

Schema contract (once per new API config entry): `include.all.keys([...real field names])`,
never `deep.equal`. Never invent field names; without a sample response leave
`// TODO: add field names from live response` and flag it.

## Smoke gate (production)

Smoke exists to catch a broken production read path before users do. Coverage must be protective,
not decorative:

- **No mutation, ever** (Lanes table). Read paths only.
- **Cover what matters:** the business-critical read surfaces first — balances and payment
  history, delinquency queues and their counts, loss-mitigation and repo queues, title/lien status,
  complaints. A dashboard that renders the wrong count or a stale balance is a failure even with no
  error thrown.
- **Assert every GET the page makes:** status, the schema keys the UI depends on
  (`include.all.keys`), and the response-to-DOM relationship (count == rendered rows, value shown ==
  value returned). A 200 alone proves nothing.
- **Fail loudly:** never suppress uncaught application exceptions globally; a 4xx/5xx, a failed
  required request, an auth failure, or an empty required response fails the test — never converts
  to a skip or a pass.
- **Gate tier:** each smoke spec has at least 1 and at most 3 `@critical` tests (the release gate).
  `@quarantine`/`@flaky` need a ticket and a quarantine date; quarantined tests still run and are
  reported, only excluded from the verdict. No `describe.skip`/`it.skip` without a ticket.

## Studio AI / `cy.prompt()` — discovery only

- E2E lane only, and only when the source pass leaves real gaps on an unfamiliar dashboard.
- Disposable file under `cypress/tests/scratch/**`; delete it before finishing. Translate findings
  into configs/commands/specs.
- Never on production smoke. Never commit `cy.prompt(` outside scratch. Never leave Studio/
  self-healing selectors inline. Never use Studio output instead of reuse-first search or
  product-contract evidence.
