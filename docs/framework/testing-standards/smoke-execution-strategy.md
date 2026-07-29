# Smoke Suite Execution Strategy

**Owner of:** how the production smoke suite is *tiered, run, gated, and quarantined*.
**Not** how tests are written — that is `FHF/docs/framework/testing-standards/TESTS.md`, which owns
authoring depth (Interaction Impact Tag), AAA structure, and the config/command patterns. This
document starts where a spec already exists and asks: when does it run, and what does its failure
mean?

**Status:** proposed 2026-07-29, not implemented. §6 lists the three changes required.
Grounded in Cypress Cloud runs 141–155 (project `r5k1ro`), not estimates.

**This file must stay committed.** The first draft was written here and lost within the hour: the
`docs/framework/` tree was entirely untracked in the FHF repo, so a concurrent docs
reorganisation removed it with nothing to recover from. It is registered as the `smoke-execution`
owner in `fhf-harness-os/config/qa-control-plane.json`, whose paths resolve relative to the FHF
workspace root — which is why it lives here rather than in `fhf-harness-os` alongside the
registry. If you find it untracked again, commit it before editing it.

---

## 1. The measured problem

| Fact | Value | Source |
|---|---|---|
| Live tests | 669 across 40 specs | run 155 |
| Specs entirely dead | 1 (Checks, 10 tests, `describe.skip` — no Okta group) | run 141 |
| Tiers | **1** — every test blocks every push | `buildspec.yml` build phase |
| Retries | `runMode: 0` | `cypress.config.js:107` |
| Cloud-reported flake | `0` in every run | runs 141–155 |
| `@critical`-tagged tests | ~20 of 669, in 9 of 40 specs | `grep tags:` |
| Latest full-suite result | 634 pass / 13 fail | run 155 |

Five things follow, and each is a defect in the *strategy*, not in any individual test.

**1. There is exactly one suite, and it blocks.** `SPEC_PATTERN` is the whole smoke directory on
every branch. There is no fast signal and no slow signal — only a ~669-test signal.

**2. The quarantine process in TESTS.md is unimplementable as written.** It says to tag a flaky
test `@flaky` and "move out of blocking suite (runs but doesn't gate merge)". No such suite
exists. The tag is honoured by nothing; a `@flaky` test blocks exactly as hard as any other.

**3. `flaky_test_count: 0` is structurally guaranteed, not good news.** Cypress Cloud detects
flake by observing a test that fails then passes *within a run*, which requires retries. With
`runMode: 0` that can never happen. The field reads `0` forever, including for a suite that is
entirely flake. Anyone reading the Cloud dashboard for reliability is reading a constant.

**4. Two documents disagree about retries.** TESTS.md prescribes `retries: { runMode: 1 }`; the
smoke lane runs `0` on purpose (`cypress.config.js:103` — "smoke failure = production incident.
Retries mask outages"). The lane is right and TESTS.md is stale. §5 fixes the reference, and the
fix is *not* to turn retries on.

**5. Failures are not independent, so the aggregate lies.** A `before each` failure kills every
remaining test in its spec — run 155's `collectionsDetailsDashboard` did exactly that. And Checks
sat at 0/10 for a full run while the headline read 634/669, which looks like a 95% pass rate. A
dead module is invisible in an aggregate.

### On comparing two runs

Runs 150 and 155 both record commit `51bc3c39` with 65 and 13 failures. **That is not a
measurement of flake** — the triage fixes were uncommitted in the working tree when 155 was
recorded, so Cloud attributed a dirty tree to the last clean SHA. The two runs executed different
code.

The lesson is method: **Cloud's `commit_sha` is only a trustworthy code identity when the tree is
clean at record time.** Any two-run flake comparison (`failure-classification.md`, "Flake is
measured, never retried away") must run from a clean tree or its result means nothing. That
precondition was not met here, so this suite's flake rate is **unmeasured**, not zero.

---

## 2. Three tiers

| Tier | Tag filter | Size | Runs on | Blocks? | Budget |
|---|---|---|---|---|---|
| **Gate** | `@critical` and not `@quarantine` | ~80 | every push to `staging`/`main` | **yes** | < 3 min |
| **Sweep** | everything not `@quarantine` | ~660 | scheduled (nightly) + on demand | no — reports | < 10 min |
| **Quarantine** | `@quarantine` or `@flaky` | 0 today | with the sweep | no | — |

The 10-minute sweep budget is TESTS.md's existing "Full smoke run" target, reused rather than
re-invented. The 3-minute gate budget is derived from it: ~12% of the tests over the same 6 workers.

Quarantined tests **still execute**. They are excluded from the pass/fail verdict, not from the
report — `it.skip()` removes them from reports entirely, which is how a quarantined test becomes a
permanently forgotten one.

---

## 3. What earns `@critical`

The smoke lane answers one question: *is this dashboard up in production right now?* `@critical`
marks the tests that answer it, and nothing else.

**Earns it — up to three per dashboard route:**

1. The route loads for the authenticated smoke account.
2. The dashboard's primary GET returns 200.
3. The primary data container renders (table body, or card grid).

**Does not earn it,** however well written:

| Excluded | Why it is sweep-tier |
|---|---|
| Filter panel controls | A broken filter is a bug, not an outage |
| Column sort ordering | Depends on live data distribution — run 155's Collector sort failed for want of 2 non-null values, a data condition, not a deploy break |
| Tab-by-tab API validation | The first tab already proves the module is up |
| Detail-page deep links | Second-order; needs a live parent record |
| API envelope field-type checks | Catches contract drift, which is not time-critical |
| Quick Search reveal/filter | Not present on every dashboard (Recon has no `dashboardNames` entry) |

**Budget: 3 × (number of dashboard routes), as a hard cap.** ~40 routes → ~120 ceiling, ~80
expected. A real constraint, not advice: a gate that grows without a cap becomes the sweep again,
at which point the tiering bought nothing.

---

## 4. Per-module verdict, not aggregate

The UI Coverage gate already refuses to accept an aggregate: `UI_COVERAGE_CRITICAL_VIEWS` sets a
per-view floor so "a dead module can't hide behind a healthy aggregate" (`buildspec.yml:249`).
Pass/fail needs the same treatment and does not have it.

- The sweep reports **pass rate per module**; a module at 0% is an incident at any aggregate.
- A `before each` failure is reported as *spec-fatal*, distinct from N individual failures —
  losing 24 tests to one broken hook is one problem, not 24.

### 4a. The UI Coverage gate is mis-calibrated in both directions

Verified by replaying `check-ui-coverage.js`'s own logic over run 155's real per-view numbers with
the live `buildspec.yml` config (`UI_COVERAGE_CRITICAL_MIN=30`; patterns compiled as **unanchored**
`new RegExp(s)`, so they substring-match).

**Too strict — 10 of the 25 reported views fail.** The patterns are module names, but unanchored
matching sweeps in every nested detail route, and detail views are the least-covered surfaces:

| View | Coverage | Matched by |
|---|---|---|
| `/insurance/lienholder-claim/details/*` | 7.69% | `insurance` |
| `/ancillary/details/*` | 8.11% | `ancillary` |
| `/titles/remarketing-titles/titles/details/*` | 11.11% | `titles` |
| `/ancillary/products/details/*` | 16.67% | `ancillary` |
| `/complaints/details/*` | 16.67% | `complaints` |
| `/loss-mitigation/invoices/auction-invoice/details` | 16.67% | `loss-mitigation` |
| `/loss-mitigation/invoices/repo-invoice/details` | 16.67% | `loss-mitigation` |
| `/titles/re-registration/details/*` | 18.60% | `titles` |
| `/insurance/total-loss/details/*` | 22.86% | `insurance` |
| `/titles/missing-titles-client/details/*` | 23.53% | `titles` |

Overall coverage (36.45%) clears `UI_COVERAGE_MIN=30`, so the *aggregate* passes while ten per-view
checks fail. `check-ui-coverage.js` exits 1, and `post_build` declares no `on-failure`, so it
defaults to ABORT — **the build fails even when every test passes.**

**Too lax — a module with zero tests is invisible.** The gate iterates only views *present in the
report*, so a critical pattern matching nothing is never evaluated. `checks` matches zero views in
run 155, because that suite is `describe.skip` pending an Okta grant. A fully dead module sails
through the exact check written to stop a dead module hiding.

Both are calibration, not code, and both need deciding before the cutover build:

1. **Anchor the patterns to dashboard roots** (`^/ancillary$`, not `ancillary`), or lower
   `UI_COVERAGE_CRITICAL_MIN` to a floor real data supports. Detail-view coverage is a genuine gap
   — it belongs in the backlog, not in a release gate calibrated by guess. The buildspec's own
   comment anticipated this ("Raise per-module only after post-config-change run data exists");
   that data now exists and says 30 is too high for nested views.
2. **Fail on an unmatched critical pattern** — after the loop, a pattern matching zero views is a
   failure ("critical view absent from report"), not a pass. Consequence: the build stays red while
   Checks is skipped, which is arguably correct. If that is unwanted, the honest fix is to drop
   `checks` from the critical list until the grant lands, not to leave a hole that hides every
   future dead module.

---

## 5. Retries and flake

**No retries, in any tier.** The gate keeps `runMode: 0` because retrying a critical failure is how
a real outage gets absorbed into a green build. The sweep keeps it because flake is supposed to be
*measured*, and a retry destroys the measurement.

Flake is measured by the two-run diff in `failure-classification.md`: run a module twice from a
**clean tree**; tests failing in one run but not the other are the flake list. Failing in both is
deterministic and gets classified normally.

**Action on TESTS.md:** its "Retry policy" block prescribes `retries: { runMode: 1 }`, contradicting
the smoke lane. Correct it to state the per-lane split — smoke `0`, E2E `1` — with the reasoning
already in `cypress.config.js:103-106`.

**Quarantine needs an expiry.** TESTS.md says "quarantine is not a parking lot — fix within the same
sprint," enforced by nothing. Make it checkable: every `@quarantine` carries a ticket reference and
the date it was quarantined, and a static check fails the build on any entry older than 30 days. Per
`session-rules.md`, that check gets wired into `buildspec.yml` `pre_build` in the same change that
adds it, and gets tested in both directions — passes clean, fails on an injected stale entry.

---

## 6. Implementation — three changes

Everything needed exists: `@cypress/grep` is installed and configured (`cypress.config.js:176-181`,
`grepFilterSpecs` and `grepOmitFiltered` both on), `TAGS.STATUS.CRITICAL` and
`TAGS.STATUS.QUARANTINE` are defined (`tags.config.js:123-128`), and `run-parallel.sh` forwards
`EXTRA_CYPRESS_ARGS`. No new configuration layer is required.

1. **Tag the gate.** Add `{ tags: [TAGS.STATUS.CRITICAL] }` to the load test in the 31 specs that
   lack it. Mechanical; the 9 specs that already have it are the reference.
2. **Tier selection in `buildspec.yml`.** Read a `SMOKE_TIER` variable (`gate` | `full`, defaulting
   to `gate` on branch push and `full` on a scheduled trigger) and set
   `EXTRA_CYPRESS_ARGS="--env grepTags=@critical"` for the gate. One `if` block in the build phase.
3. **Two npm scripts.** `cy:run:smoke:gate` and `cy:run:smoke:full`, so the tiers are runnable
   locally and the gate is not a CI-only concept.

Sequenced deliberately: (1) is inert until (2) exists, so the tags can land and be reviewed without
changing any CI behaviour.

### Not doing, and why

- **A separate gate spec directory.** Duplicates assertions the module specs already own, and the
  copy drifts. Tags select; they don't duplicate.
- **Cypress Cloud Smart Orchestration / auto-flake-detection.** Both need retries.
- **Raising `retries` to stabilise the build.** The failure this document exists to prevent,
  arrived at from the opposite direction.

---

## 7. UI Coverage — what the 36% actually measures

All 284 distinct untested elements from run 155 were pulled via the Cypress Cloud MCP and
classified. The headline number is not 64% test debt; most of it is measurement error or surface
this lane is forbidden to touch.

| # | % | Bucket | Nature |
|---:|---:|---|---|
| 78 | 27.5% | Date-range pair half — one control counted twice | measurement artefact |
| 69 | 24.3% | Write-form field names (letter / settlement / cancellation / email) | un-earnable |
| 62 | 21.8% | **No stable hook** — coverage fell back to a CSS/DOM path | app testability gap |
| 38 | 13.4% | Write / export / mutation controls | un-earnable |
| 16 | 5.6% | **Genuinely uncovered, stably hooked, read-safe** | **real test debt** |
| 11 | 3.9% | react-dates calendar icon — same control, 11 DOM paths | measurement artefact |
| 7 | 2.5% | react-datepicker library internals (2nd date lib, unfiltered) | measurement artefact |
| 3 | 1.1% | react-select async input — unstable emotion hash in the name | measurement artefact |

Rolled up: **92 measurement artefact, 114 un-earnable in a GET-only prod lane, 62 app hook gaps,
16 real test debt.** Sixteen. Out of 284.

### Why each artefact class exists

- **Date ranges are one widget, two inputs.** `${fieldName}_start_date` and `${fieldName}_end_date`
  come from a single react-dates `DateRangePicker`, emitted by five shared components
  (`DateRangePickerTs.tsx:151-153`, `DateRangeInputPicker.tsx:161/187`, `SearchDate.jsx:42-44`,
  `RangeDatePicker.jsx:75-76`, `dateRangePicker.jsx:68-70`). Run 155 has **69 distinct date-range
  fields**: 3 with both halves driven, **55 with exactly one**, 11 with neither. Each of those 55
  reports as 1 tested + 1 untested — pure double-counting, 66 phantom gaps.
- **Unhooked controls get named by DOM path, and the path is not identity.**
  `.SingleDatePickerInput_calendarIcon` appeared as 11 different "elements" (`.column1 > .date-picker
  > …`, `.gap-2 > .date-picker > …`, `:nth-child(9) > .block__content > .row > …`) — while the bare
  class was simultaneously reported **tested**. Same button, 12 rows in the report.
- **Two date libraries, one filtered.** react-dates internals were already grouped; react-datepicker's
  were not, so its day cells and month/year/nav controls leak in individually.
- **Emotion/CSS-module hashes are build artefacts.** Names containing `.css-1g6gooi` or
  `._flexContainer_dgi6c_1` change on any styling change — they cannot be stable identities, and any
  rule written against them is pre-broken.

### Config corrections applied

`cypress/configs/ui-coverage.common.json` (shared-component tier, identical across both repos):

- `elementFilters`: `[id$='_end_date']` — makes the start input the single representative of each
  date-range control. Chosen over an `elementGroups` rule deliberately: one group name would collapse
  all 69 fields into one element and hide the 11 real gaps, whereas the filter keeps per-field
  identity. Verified safe — zero hardcoded `_end_date` ids exist in `fhf-dashboards/src`, and no field
  is end-tested-but-start-untested.
- `elementGroups`: `react-dates-calendar-icon`, `react-datepicker-day-cell`,
  `react-datepicker-month-year-select`, `react-datepicker-navigation`, `async-select-filter-input`.

`cypress/configs/ui-coverage.modules.json` (Smoke-lane policy — E2E drives these with a write account):

- Export / download / import / packet-generation triggers. Not "no test yet" — the lane forbids
  clicking them (GET-only ≠ safe-to-click; each pulls a full unpaginated dataset and starts a real
  download against production).
- Mutation controls (send email, mark sent/excluded, archive, create row, save inline edit, file
  picker), enumerated explicitly rather than prefix-matched, so a read-safe `btn-*` added later isn't
  silently dropped.
- `[data-cy$='-checkbox']` — document-selection checkboxes in write-only generation widgets. The
  suffix is the discriminator: the read-safe checkboxes the suite does exercise (`checkbox`,
  `checkbox-hide-sms-text`, `checkbox-hide-system-messages`) carry the token bare or as a prefix and
  are not matched. **Known limitation:** this rests on that convention; a future read-safe
  `<x>-checkbox` would be excluded silently. Re-check on any new filter checkbox.

Verified mechanically, not by reading the diff: semantic entry-set comparison before/after shows
**0 entries lost, 9 added**; the only tested elements any new filter removes are the 3 `_end_date`
inputs whose `_start_date` twin is also tested, so no control loses tested status.

### Projected effect

| | tested | untested | coverage |
|---|---:|---:|---:|
| Run 155 as reported | 152 | 284 | 34.9% (Cloud: 36.45%) |
| After the corrections above | 149 | 91 | **62.1%** |
| If the 62 unhooked elements are also excluded | 149 | 29 | **83.7%** |

The third row is **not** recommended as-is. Those 62 are real app surface with no stable hook —
excluding them would make the score look good by hiding a testability debt. They belong in
`docs/planning/data-cy-hook-backlog.md` (the registered `selectors` owner) as upstream `data-cy`
requests, and should stay counted until hooks land.

### Then re-calibrate the gate, don't guess

§4a's per-view floor was set blind. Once a run exists with this config applied, set
`UI_COVERAGE_CRITICAL_MIN` and the view patterns from that run's real distribution — and anchor the
patterns (`^/ancillary$`) so module floors stop swallowing nested detail routes.

### 7a. The write-form fields — half reachable, half a hook request

Resolved against source rather than pattern-guessed. `withWidgetContainer.jsx:58` renders
`widgetWrapper--${className}` on every widget's content container, and `components/hoc/constants.js:88-145`
names the nine document/email widgets: Re-Reg Letter, Re-Reg Checklist, Cover Letter, Other Owner
Addendum, Cancellation Packet, Payoff Notice Letter, Letter of Guarantee, Email Auction, Email.
Scoping the filter to those nine wrappers (`input`, `textarea`, `select`) covers roughly half the
write-form fields — **27 of 68 mapped to a wrapped renderer.**

The other half cannot be reached by config, and it matters why:

- **27 fields render in components that use no widget container at all** — Ancillary details
  `GeneralInformation.tsx` / `AncillaryProvider.tsx`, Titles Missing-Titles `Letter60Day.jsx` /
  `Letter90Day.jsx` / `PayoffNotice.tsx`, Titles Release `LienReleaseLetter.jsx` / `ReleaseNotice.jsx`,
  Titles General `GeneralReleaseNotice.jsx`. Four of the five Titles letter components were checked
  individually: none is wrapped. No ancestor exists to scope to.
- **14 field names resolve to no source literal at all** — the `products[0].*` formik array fields,
  and the document codes `PAYOFF_NOTICE`, `VALID_PHOTO_ID`, `POI`, `POA`, `FHF_AUTH`, `PAPER_TITLE`,
  `DMV`. Those seven are one checkbox per document type returned by the API, so the `name` is data,
  not contract, and shifts with the document list.

Both went to the `selectors` owner (`docs/planning/data-cy-hook-backlog.md`) as **SH-14** and
**TI-03** — not papered over with a broad `[name]` filter, which would also remove read-safe
dashboard filter inputs. Several other findings from this pass were already logged there and were
deliberately not duplicated: **SH-07** already requests field-keyed date-range start/end hooks,
**SH-02** the react-select input, **SH-06** the month/year selects, **TI-01** the Re-Registration
acknowledgement checkboxes.

### 7b. Custodian Contracts had no view pattern

Twenty-four sibling module detail routes have one; `custodian/contracts/details/*` did not, so every
record id became its own entry — that is why run 155's untested-links list is 20+ rows of
`/custodian/contracts/details/300019`, `300023`, `300028`, `300050`, … Added, positioned before the
`https://*/:path*` host-consolidation catch-all.

Stated rather than assumed: whether a `views` pattern also collapses the per-record entries in the
untested-**links** list is **not documented**. `docs.cypress.io/ui-coverage/configuration/views`
covers URL→view grouping for coverage metrics and says nothing about link-level reporting, and there
is no `linkFilters` property in the schema. The view grouping itself is correct and consistent with
its siblings either way; confirm the link effect against the next run.

### 7c. `AQ_PROFILE` is dead config

`buildspec.yml` exports `AQ_PROFILE="aq-config-smoke"` and `run-parallel.sh:112` passes it as a
Cloud run tag — but the UI Coverage config has **no `profiles` array**, so nothing matches it and the
tag has no effect.

Per Cypress's docs, `profiles` selects config by exact, case-sensitive match against a run tag, and
a profile **replaces** rather than merges most settings (`accessibility` and `uiCoverage` merge one
level deep). That makes it the right mechanism for the §2 tiering, and worth knowing before the gate
tier ships: a `@critical` gate run (~80 tests) measured against the full element denominator will
score terribly for a reason that has nothing to do with quality. Either exempt gate-tier runs from
the coverage gate, or give them a profile. Do not compare a gate run's score to a sweep run's.

### Schema note

Verified against `docs.cypress.io/ui-coverage/configuration/*`: the real top-level properties are
`views`, `viewFilters`, `elementFilters`, `significantAttributes`, `attributeFilters`, `uiCoverage`
(containing `elements`, `elementGroups`, `additionalInteractionCommands`,
`allowedInteractionCommands`), and `profiles`. There is no link-filtering property. `uiCoverage.elements`
assigns stable identity/names to elements whose attributes change between snapshots — it explicitly
does **not** mark anything tested or change counts, so it is not a lever on the 62 unhooked elements.

---

## 8. Open, and not the agent's call

- **The 13 remaining run-155 failures are not triaged here.** Four are Impound Quick Search failing
  on an absent `[data-cy="search-icon"]` — same shape as the Recon Quick Search tests deleted as
  INVALID, so Impound may be a product gap rather than a test bug. Three are
  Collections/Collections-Detail `collectionsLookup` never responding, which needs checking against
  the recently anchored intercept glob; a matcher now too narrow produces exactly this symptom.
- **The Checks Okta grant.** 10 tests stay skipped until the smoke account can reach the module —
  and see §4a(2) for how that interacts with the coverage gate.
- **Whether the sweep runs nightly or per-merge** — a cost decision (Cloud minutes vs. staleness).
- **Whether the gate also runs on `dev`/`qa`,** or only the branches that map to prod.
