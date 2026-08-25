# Smoke Checklist — quick look

One screen. What a smoke test must, should, and must not do.

**Derived, not authoritative.** The reasoning, measurements, and tier definitions live in
`smoke-execution-strategy.md`; authoring depth lives in `TESTS.md`. If this file and either of those
disagree, they win and this file is stale. Change the strategy first, then re-derive this.

Rows marked 🔒 are enforced by `.claude/hooks/` — see [Guards](#guards). The rest are review items.

---

## The one question

> Is this build/deploy so broken that testing it further is a waste of time?

Not "is it correct." Anything that answers a different question belongs in the sweep tier.

---

## Layer 1 — Environment & dependency reachability

Backend lane. Run first: a broken dependency should never be discovered by a UI timeout.

- [ ] **MUST** App reachable at the configured URL
- [ ] **MUST** Datastore accepts a connection (`SELECT 1 FROM DUAL`)
- [ ] **MUST** Every configured dependency resolves **at its configured location** — auth, proxy segment, document service, external APIs
- [ ] **MUST** Auth succeeds; unauthenticated access is rejected
- [ ] **SHOULD** Deployed build/version identifier matches what was released
- [ ] **SHOULD** Required config keys present — presence only, never the value

## Layer 2 — Schema & contract existence

Backend lane. Deterministic, no flake, no live-data dependency. Highest value per second in the suite.

- [ ] **MUST** Every table and view the module reads exists
- [ ] **MUST** Every view is *queryable* — presence is not validity
- [ ] **MUST** Every package, package **body**, procedure, function, trigger is `VALID`
- [ ] **MUST** Packages expose their expected members
- [ ] **SHOULD** Primary view returns a non-zero active row count
- [ ] **SHOULD** Reference tables match an **exact** key set — additions *and* removals fail
- [ ] **SHOULD** Flag invariants: exactly one default, expected final/non-final split, all-active where required
- [ ] **SHOULD** Required columns non-null; ordinals sequential without gaps
- [ ] **MUST NOT** Business-rule assertions on transactional row data

## Layer 3 — API health & contract

Backend lane. This is where smoke should be heaviest — the layer below the UI carries broad-stack
confidence without UI flake.

- [ ] **MUST** Every endpoint fired on dashboard load returns 200
- [ ] **MUST** Within a **per-endpoint** latency budget — not a global default
- [ ] **MUST** Response envelope shape correct (`items`, `count`, `hasMore`, `total_rows`)
- [ ] **MUST** Item schema — required fields present, types correct, nullables declared
- [ ] **SHOULD** API count reconciles with the DB count it derives from
- [ ] **SHOULD** Pagination honours `limit`
- [ ] **SHOULD** A filter narrows the result set
- [ ] **SHOULD** Unknown key returns empty-200 or 404 — never 500
- [ ] **SHOULD** Identity fields non-null
- [ ] **SHOULD** Sibling endpoints structurally distinct — guards against glob over-matching
- [ ] 🔒 **MUST NOT** Any mutating call in a production-targeted lane
- [ ] **MUST NOT** Multi-step business workflows

## Layer 4 — UI reachability

This lane. Thin by mandate: **3 per dashboard route, hard cap.**

- [ ] **MUST** Route loads for the authenticated smoke account
- [ ] **MUST** Primary data container renders — table body or card grid, or an explicit empty state
- [ ] **MUST** Unauthenticated access redirects
- [ ] **SHOULD** Expected column headers present
- [ ] **SHOULD** Rendered record count reconciles with the API count
- [ ] **SHOULD** No `null`/`undefined` leaking into rendered cells
- [ ] **MUST NOT** Filter-permutation matrices, column sort ordering, tab-by-tab API validation, detail-page deep links
- [ ] **MUST NOT** Modal open/close, copy-to-clipboard, hover cards, tooltips
- [ ] 🔒 **MUST NOT** Any click on Export / Download / Import / Submit / Delete
- [ ] **MUST NOT** Visual or pixel assertions
- [ ] **MUST NOT** Third-party services under test — stub or bypass

---

## Hygiene — every layer

- [ ] 🔒 `data-*` selectors only. Never CSS class, generated `id`, or text content
- [ ] 🔒 No `cy.wait(number)` — route aliases or assertions as gates
- [ ] 🔒 `testIsolation: true`; every test passes alone, in any order
- [ ] 🔒 `cy.ensureAuthenticated()` in `before()` **and** `beforeEach()`
- [ ] 🔒 No hardcoded credentials — `Cypress.env()` with `{ log: false }`
- [ ] 🔒 Interception lives in commands, never inline in a spec
- [ ] 🔒 No literal route in `cy.visit()` — named route constant via a navigation command
- [ ] 🔒 Selector literals shared by 2+ modules live in `common.ui.js`, imported not redeclared
- [ ] **No retries, any tier.** A retry absorbs a real outage into a green build
- [ ] Test code reviewed at production-code quality

## Gate tier

- [ ] 🔒 **≤ 3** `@critical` per spec — hard cap, not advice
- [ ] 🔒 **≥ 1** `@critical` per smoke spec, or the module cannot fail the gate
- [ ] 🔒 Every `@quarantine` / `@flaky` carries a ticket ref **and** a quarantine date
- [ ] 🔒 No `describe.skip` / `it.skip` without a ticket reference
- [ ] Quarantined tests still execute — excluded from the verdict, not the report

## Exit criteria

- [ ] **100% pass.** Smoke has no acceptable failure rate; a known failure is a broken gate
- [ ] **Per-module verdict, not aggregate.** A module at 0% is an incident at any headline number
- [ ] A `before each` failure is reported as *spec-fatal*, not as N individual failures
- [ ] Layers 1–3 under 5 min; Layer 4 gate under 3 min
- [ ] On failure: stop the pipeline. Do not proceed to regression

---

## Guards

Enforced by hooks in `FHF/.claude/hooks/`, shared patterns in `lib/cypress-rule-patterns.mjs`:

| Guard | Hook | Effect |
|---|---|---|
| `cy.wait(number)`, smoke mutations | `pre-validate-cypress-rules.mjs` | **blocks the write** |
| auth, isolation, credentials, inline intercept, literal `visit`, selector duplication, config freeze | `validate-cypress-rules.mjs` | **exit 2**, fed back for repair |
| gate-tier tag rules (cap, coverage, quarantine metadata, skip tickets) | `validate-cypress-rules.mjs` | cap **blocks**; the rest warn |
| Export/Download clicks, prod data artefacts | `protect-prod-data.mjs` | default-deny |

Unenforceable by hook, so they stay review items: latency budgets, count reconciliation, exact
key sets, per-module verdicts, tier budgets. These are properties of a *run*, not of source text —
they belong in the buildspec gate, not a PreToolUse hook.
