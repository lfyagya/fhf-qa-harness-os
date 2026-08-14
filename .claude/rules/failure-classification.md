---
paths:
  - "CypressFHF/fhf-dashboards/cypress/**"
---
# Failure Classification — Actual vs False, and How to Actually Know

A red test is a question, not an answer. Before a failure is called a test bug (fix the test) or
an app regression (file a ticket), it goes through five checks in order. Skipping any of them is
how a real production defect gets closed as "flaky test", and how a broken test gets escalated as
a fake outage. Both destroy confidence in the suite, which is the only thing the suite is for.

## The five checks, in order

1. **Test intent.** What is this test claiming to prove? Read the test name AND the command it
   calls — the name is a claim, and it can already be wrong (see `assertion-precision.md` rule 7).
2. **Implementation.** Does the code actually implement that intent? A chain that yields the wrong
   subject, an alias that never matched, a scan that runs before the data arrives — none of these
   are statements about the app.
3. **Assertion correctness.** Does the assertion, as written, prove the intent? Asserting
   `be.visible` proves nothing about `disabled`; comparing a page count proves nothing about
   filtering.
4. **Intent vs app source.** Check the intent against `fhf-dashboards/src`. **Necessary, but never
   sufficient** — source shows *intended* behaviour. If you stop here and agree with source, you
   have only confirmed the app does what the app says it does, which is exactly where a genuine
   defect hides.
5. **Adjudicate with the application specs.** The configured `documentation.owners.application` path —
   including per-module `modules/<module>/specs/*.yaml` with numbered business rules
   (`BR-<MOD>-NNN`). This is the independent third reference: it states what the app is
   *supposed* to do, so it can disagree with source. When spec and source disagree, that
   disagreement IS the finding — escalate it, do not silently pick one.

Confidence comes from **independent agreement**, not from any single source. Three references
agreeing (test failure evidence + source + spec) is a defensible verdict. Source alone is not.

### 5a. A spec sentence only governs the case its preconditions describe

Quoting the spec is not the same as quoting the *applicable* spec. Before leaning on a rule,
check that the request/state the test actually exercises matches the rule's stated conditions.

Real error, 2026-07-27: Collections' `collectionsLookup` returned 0 items and the spec says
"Fetching the delinquent account list with **no filters** returns at least one record". That was
read as proof of a production regression and a backend Bug was nearly filed. But the dashboard
was not issuing the unfiltered query — a real browser capture showed
`/collection/lookup?limit=35&collector_id=1472%2C1472`, i.e. scoped by a Collector filter. The
spec line describes the *unfiltered* case and did not govern that request.

### 5b. Five wrong verdicts on one failure — and the fix that made it worse

Collections' empty Contact Log dashboard is the worked example of how one failure can support
several confident, defensible, wrong diagnoses in sequence. Recorded in full because the
eliminations are the value.

| Verdict | Basis at the time | How it died |
|---|---|---|
| App/data regression | spec: "no filters returns >= 1 record"; API returned 0 | The request was filtered (`collector_id=…`) — that spec line governs the unfiltered case only (§5a) |
| Test config defect only | `lookup**` glob over-matches `lookup-nd` | Real, and fixed — but the dashboard's own request was `/lookup?…`, so it never explained the 0 |
| Account has no data | collector-scoped request legitimately empty | Owner cleared the filter in a browser: records returned, 0.6 kB → 10 kB |
| Remembered filter in browser storage | `_getDefaultFilters` + redux-persist are both real, and `cy.session()` restores localStorage | Clearing EVERY non-auth key in `onBeforeLoad`, before any app script ran, changed nothing |
| (implicit) clearing state will help | — | **It is what CAUSES the filter.** The fix was counterproductive by design |

**Actual cause** (`src/modules/callLog/dashboards/CallLog.tsx:176-196`): when the collector filter
is *empty*, the app deliberately applies the logged-in user as the default — "If current user is
collector, set the default collector filter". So `isCollectorFilterEmpty === true` is the
*trigger*, not the cure, and clearing persisted state guarantees the filtered request. The app
re-derives the filter from the authenticated user on every mount; no client-side state
manipulation can avoid it. Confirmed intended product behaviour by the owner.

The sharpest lesson is the fourth row: the mechanism was real, documented in source, and
sufficient to explain the symptom — and still was not the cause. **A mechanism you can point at
in source is not evidence that it is the mechanism operating here.** The fifth row is worse: the
remedy derived from that mechanism actively produced the symptom, and three runs of identical
0/12 results looked like "no effect" rather than "wrong direction".

What actually resolved it: the owner's DevTools capture (§5c), then reading the *enum* usage
(`EFilterFieldKey.COLLECTOR_ID`) rather than the literal string `collector_id` — the earlier grep
for the literal found only type declarations and missed the assignment entirely. **When a search
for a config key comes back empty-but-the-behaviour-exists, search for the enum/constant that
names it.**

Also standing: stop at `engineering.loops.sameFailureLimit` from `.claude/harness.config.json`,
escalate, and prefer instrumentation over another fix. Verify that a manual browser session and
the automated run are the same user before treating one as reproducing the other; here they were,
which is what made the contradiction meaningful.

Resolution: the default filtered view is correct behaviour, so `minCount: 0` on that alias is
right — asserting `>= 1` would assert that one particular user has assigned accounts. Covering the
spec's unfiltered ">= 1 record" claim needs a test that explicitly clears the filter and asserts
on that second response.

### 5c. Runtime network capture outranks every static source

Source, config and spec all describe intent. A DevTools capture of the actual requests is the
only reference that shows what *happened* — which endpoint fired, with which params, what status
and payload size. When a failure is about data presence, aliasing, or timing, get the capture
before concluding. The same capture above simultaneously (a) disproved the "data regression"
reading and (b) proved a real intercept-aliasing defect, because it showed
`/collection/lookup-nd` firing on the DETAIL page — which the `collection/lookup**` glob was
silently capturing under the delinquent alias.

Corollary: an over-broad intercept glob is the API-layer twin of `assertion-precision.md` rule 8.
`lookup**` matched three distinct endpoints (`lookup?…`, `lookup-nd`, and
`lookup/get-payment-history-print-view/…`). Anchor the matcher (RegExp where a glob cannot
express it) and confirm uniqueness against a real capture, not against the endpoint you assume
is the only one.

## Verdicts

- **FALSE (test bug)** — spec and source agree the app is behaving correctly, and the test's
  intent/implementation/assertion is at fault. Fix the test.
- **FALSE (flake)** — non-deterministic; same code, different result. Prove it by run-to-run
  variance, not by rerunning until green. Stabilise it; never paper over with retries.
- **ACTUAL (app)** — the app diverges from the spec. Never fix the test green
  (`source-map.md`). Escalate to dev/ops with the spec rule id.
- **ACTUAL (test-code defect)** — mechanically impossible to pass regardless of app state
  (e.g. `.click()` on a string subject). This class needs no spec adjudication: no app behaviour
  can make it pass. It is still a test bug, but it is *certain*, not inferred.
- **ENVIRONMENT/ACCESS** — the account or environment cannot reach the feature. Not a defect and
  not a test bug. Escalate for an access grant or descope explicitly; never weaken the assertion.
- **INVALID** — the test asserts a feature that does not exist. Delete it, and raise the
  product-gap question separately if siblings do have the feature.

## Worked examples (all real, 2026-07-27, SERV-11786)

- **Spec adjudicated it, source could not.** Impound "legacy link and View Documents both open"
  failed on `<a>` not visible. Source showed the parent is `opacity-0 hover:opacity-100` — which is
  equally consistent with "hover-reveal by design" and "link wrongly hidden". `impound.yaml`
  **BR-IMP-005** settled it: "hovering the cell reveals a copy icon and two links". Verdict FALSE
  (test bug) with real confidence: the test never hovered. Fix = `realHover`, and the hover is
  required *by spec*, not as a workaround.
- **Checking step 4 alone would have produced the wrong fix.** Transport VIN sort "order broken"
  between `19ude…` and `19UDE…` looks like a case-sensitivity bug with an obvious one-line fix.
  But `DEFAULT_SORT_COMPARE` is code-point *deliberately*, to mirror Oracle BINARY collation, and
  Cloud runs #115/#122 already proved case-folding disagrees with the backend on two other fields.
  Verdict still FALSE (comparator mismatch) — but the fix must be per-column. The naive global fix
  would have re-broken exactly what that comparator was written to protect.
- **Mechanically certain, no adjudication needed.** `.should('be.visible').and('have.attr','href')
  .and('not.be.empty').click()` — `have.attr` yields the attribute STRING, so `.click()` gets a
  String subject. 6 identical sites across Loss Mitigation. No app state can make this pass.
- **Access, not defect.** Checks: `#menu-Checks-Module` absent. Selector verified correct
  (`NavigationMenuItem.tsx:55` + label 'Checks Module'), 13 other modules use the same command
  fine, and the nav entry is gated by `allowedGroups`. A denied `useHasAccess` renders nothing, so
  absence is the CORRECT result. Descoped pending an Okta grant.
- **Invalid.** Recon Quick Search: no `RECON` entry in `dashboardNames`, so Recon never mounts
  `DashboardHeader`; zero quick-search code in its module. 4 tests deleted, product-gap question
  raised separately.

## Flake is measured, never retried away

Smoke runs `retries: { runMode: 0 }` on purpose — "smoke failure = production incident". So
Cypress Cloud's own flake detection (which needs retries) is unavailable here, and raising retries
would hide exactly the signal this rule exists to find.

Measure it instead: run a module **twice** and compare the failing-test SETS.

- Failing in **both** runs → deterministic. Real signal; classify per the five checks above.
- Failing in **one** run only → flaky. That difference is the flake list, and it is debt to
  stabilise, not evidence about the app.

Observed 2026-07-27 on identical code: assignment 11/5 → 13/3, auction-invoice 22/2 → 21/3. Per-spec
counts moved ±2 with zero code change. A single green run therefore does not license a release; two
consecutive clean runs per module is the gate, and the two-run diff is what tells you which
failures were ever real.
