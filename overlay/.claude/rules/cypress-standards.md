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
BEHAVIOR (directly or via `SUITE_TAGS`); every `it` carries STATUS. Currently a warning, not a
blocker, until both lanes are tagged — flag under-tagging, do not block on it.

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

## Studio AI / `cy.prompt()` — discovery only

- E2E lane only, and only when the source pass leaves real gaps on an unfamiliar dashboard.
- Disposable file under `cypress/tests/scratch/**`; delete it before finishing. Translate findings
  into configs/commands/specs.
- Never on production smoke. Never commit `cy.prompt(` outside scratch. Never leave Studio/
  self-healing selectors inline. Never use Studio output instead of reuse-first search or
  product-contract evidence.
