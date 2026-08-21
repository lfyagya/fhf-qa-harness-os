# Smoke Suite Execution Strategy

**Owner of:** how the production smoke suite is *tiered, run, gated, and quarantined*.
**Not** how tests are written — that is `FHF/docs/framework/testing-standards/TESTS.md`, which owns
authoring depth (Interaction Impact Tag), AAA structure, and the config/command patterns. This
document starts where a spec already exists and asks: when does it run, and what does its failure
mean?

**Quick-look form:** `smoke-checklist.md` — a one-screen MUST / SHOULD / MUST NOT derived from this
document. It is derived, not authoritative: change the reasoning here first, then re-derive it.
Rows enforceable from source text are guarded in `.claude/hooks/validate-cypress-rules.mjs`.

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
| `@critical`-tagged tests | 19 of 669, in **7** of 39 specs — all Ancillary | `grep -E '\b[A-Z]\.CRITICAL'`, 2026-08-20 |
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

**The score includes links.** `(tested_elements + tested_links) / (all elements + all links)` —
confirmed to the decimal in both directions: 51% = (149+35)/(171+6+149+35), and the original
36.45% = (152+35)/(285+41+152+35). This is why the naive element-only arithmetic (34.9%) never
matched Cloud's 36.45%; the gap was links, not rounding.

| Stage | tested el. | untested el. | untested links | coverage |
|---|---:|---:|---:|---:|
| Run 155 as originally reported | 152 | 285 | 41 | 36.45% |
| Predicted after the first corrections | 149 | 91 | — | 62.1% ❌ |
| **Actual** after the first corrections | 149 | 195 | 40 | **43.91%** |
| **Actual** after §7a/7b corrections | 149 | 171 | **6** | **50.97%** |
| Projected after §7d groups | 149 | ~150 | 6 | **~54%** |

**The 62.1% prediction was wrong, and the error is worth naming.** It projected the *classification*
rather than the *config*: it assumed all 114 un-earnable elements would be filtered, when the
selectors written only targeted a subset. Two lessons carried into §7d — project from the rules you
actually wrote, and never validate against a report whose `is_partial_report` flag is set.

The remaining ~150 is deliberately not driven lower by filtering. The unhooked elements are real app
surface; excluding them would buy a nicer number by hiding testability debt. They belong in
`docs/planning/data-cy-hook-backlog.md` (the registered `selectors` owner) as SH-14/SH-15/TI-03, and
stay counted until hooks land.

### 7d. Second grouping pass — index-varying families

The re-analysis exposed families that were invisible while the bigger artefacts dominated. Two have
stable anchors and were grouped; two do not and became hook requests.

**Grouped:**

- `.checklist-section label` → `rereg-checklist-document-label`. The Re-Registration document
  checklist rendered as up to **20** separate entries — `:nth-child(5..15) > label` (11),
  `._fill_dgi6c_6 > :nth-child(1..5) > label` (5), `.checklist-section > ._flexContainer_dgi6c_1 >
  :nth-child(1..4) > label` (4) — for one data-driven list. `.checklist-section` is the stable anchor
  (`ReRegistrationChecklist.tsx:390`, `ServicingReRegistrationChecklist.tsx:51`); the intermediate
  `_flexContainer_dgi6c_1` / `_fill_dgi6c_6` are CSS-module hashes that change on any build and must
  never appear in a rule.
- `input[type='radio'][id^='radio']` → `radio-filter-option`. `DropdownRadio.jsx:58` and
  `Radio.jsx:24` emit `id={`radio${i}`}`. Run 155 had `#radio0`/`#radio1` tested and
  `#radio2`/`#radio3`/`#radio4` untested purely by list position — position is not identity
  (`assertion-precision.md` rule 6). One radio group is one control.

**Not grouped, on purpose:**

- **Switch toggles** (~7 identities for one component). `.switch-wrapper .relative` would collapse
  every toggle in the app into one control — too coarse to mean anything. Filed as **SH-15**.
- **Letter-form text inputs** (~27: `.make > .text-field__control`, `.buyerName > …`,
  `.streetAddress1 > …`, `:nth-child(N) > .text-field > .text-field__control`, and the `.error >
  .text-field__control` variants). A rule on `.text-field__control` would sweep in the ~30 *tested*
  `input-field-*` controls too, since `elementGroups` is first-match-wins. These need **SH-14**'s
  container hook before they can be addressed at all — which is the concrete cost of that gap.

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

**Answered by evidence: `views` patterns DO group untested links.** After the config was applied in
Cloud, untested links fell **41 → 6** and `/custodian/contracts/details/*` now appears as a single
grouped entry. Worth recording how this was nearly got wrong: an intermediate re-analysis showed
41 → 40 with `/custodian/contracts` still holding 36, which read as "views don't affect links" — it
was an incomplete re-analysis, not a result. The docs are silent on link-level reporting and there is
no `linkFilters` property, so this behaviour is established here empirically, from a settled report
rather than a mid-flight one.

Remaining untested links are 6 genuinely unvisited destinations, not per-record noise:
`/collection/call/main/id/*`, `/collection/lookup/get-payment-history-print-view/applicationId`,
`/custodian/contracts/details/*`, two `/repo/index/assignment/id/*`, and `/tci`.

### 7c. `AQ_PROFILE` is dead config

`buildspec.yml` exports `AQ_PROFILE="aq-config-smoke"` and `run-parallel.sh:112` passes it as a
Cloud run tag — but the UI Coverage config has **no `profiles` array**, so nothing matches it and the
tag has no effect.

Per Cypress's docs, `profiles` selects config by exact, case-sensitive match against a run tag, and
a profile **replaces** rather than merges most settings (`accessibility` and `uiCoverage` merge one
level deep).

**Decision: exempt gate runs from the coverage gate. Do not add a profile. Replace the dead
`AQ_PROFILE` with a tier tag.** Four reasons, in order of weight:

1. **A profile cannot fix the gate score, because the score is not a config problem.** UI Coverage's
   denominator comes from elements found in DOM snapshots of the views a run visits — not from which
   tests ran. A gate run still loads all ~40 dashboards, so it discovers nearly the full element set
   while interacting with almost none. ~12% would be *arithmetically correct* and answer a question
   nobody asked. No configuration option changes that. It is a **gating** decision, not a measurement
   one.
2. **Profiles vary config within one Cloud project; both real projects are single-lane and already
   have their own config file.** Prod smoke is `r5k1ro` (this repo), E2E is `nptdoe`
   (`AG Frontend Automation`, `cypress.config.js:39`), and each carries its own
   `ui-coverage.{common,modules,config}.json` trio. There is nothing to vary.
3. **A profile would actively break run-to-run comparability.** `aq-config-smoke` is passed only by
   `run-parallel.sh:112` (the CI path). The manual per-module scripts tag
   `smoke,staging,<module>` (`run-smoke-suite-record.sh`) and carry no profile tag at all — which is
   why runs 141–155 never matched it. A profile would therefore score CI runs under one config and
   manual runs under another, so the *same code* would report different coverage depending on how it
   was launched. That is worse than no profile.
4. **The one place profiles would genuinely fit is `8ezjbp`** — the local scratch project *both*
   lanes record to (`cy:run:record:local` in each repo, tagged `smoke,local,staging` and
   `e2e,local,dev`). One project, two lanes, and Smoke's read-only exclusions must not apply to E2E
   runs. But coverage on a local scratch project is noise by design. Revisit only if that project
   ever becomes a reporting surface — the lane tags needed to key the profiles are already being
   passed.

### How to configure it

Three small changes, all in this repo. They depend on §6 change 2 (`SMOKE_TIER`) landing first.

1. **Gate the coverage check on tier** — `buildspec.yml` `post_build`, wrap the existing block:

   ```bash
   if [ "${SMOKE_TIER:-gate}" = "full" ]; then
     export CYPRESS_PROJECT_ID="r5k1ro"
     ...
     node scripts/check-ui-coverage.js
   else
     echo "── Tier=$SMOKE_TIER — UI Coverage gate is a sweep-tier check, skipped ──"
   fi
   ```

   Coverage becomes a property of the sweep, which is the cadence it belongs on. It also removes the
   §4a failure mode from every push, leaving the calibration work to be done once against sweep data.

2. **Replace the dead profile tag with a tier tag**, so Cloud runs stay filterable and the coverage
   trend can be read per-tier — `run-parallel.sh`:

   ```bash
   -AQ_PROFILE="${AQ_PROFILE:-aq-config-smoke}"
   +SMOKE_TIER="${SMOKE_TIER:-gate}"
   ...
   -  --tag "$ENV,@smoke,$AQ_PROFILE" \
   +  --tag "$ENV,@smoke,smoke-$SMOKE_TIER" \
   ```

   A tag for filtering, not a profile for config. Drop `AQ_PROFILE` from `buildspec.yml:151` in the
   same change.

3. **Normalise the tag vocabulary across all three entry points.** Today `run-parallel.sh` emits
   `$ENV,@smoke,…` (with an `@`) while `run-smoke-suite-record.sh` emits `smoke,staging,<module>`
   (without). Pick one spelling of the lane tag and one of the env tag, so Cloud filters and any
   future profile key mean the same thing regardless of launch path. This is the prerequisite that
   reason 3 above turned up — worth doing on its own merits.

**Standing rule either way: never compare a gate run's coverage score to a sweep run's.** They have
different denominators by construction.

### Schema note

Verified against `docs.cypress.io/ui-coverage/configuration/*`: the real top-level properties are
`views`, `viewFilters`, `elementFilters`, `significantAttributes`, `attributeFilters`, `uiCoverage`
(containing `elements`, `elementGroups`, `additionalInteractionCommands`,
`allowedInteractionCommands`), and `profiles`. There is no link-filtering property. `uiCoverage.elements`
assigns stable identity/names to elements whose attributes change between snapshots — it explicitly
does **not** mark anything tested or change counts, so it is not a lever on the 62 unhooked elements.

---

## 8. Industry grounding — and the one place this lane diverges

§§2–3 were derived from local measurement (runs 141–155) with no external reference. The
comparison below uses [Google SRE's testing-reliability guidance](https://sre.google/sre-book/testing-reliability/),
[Microsoft's testing guidance](https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/testing),
and [Fowler's subcutaneous-test explanation](https://martinfowler.com/bliki/SubcutaneousTest.html).
**The tiering decisions hold up; the lane's composition does not.**

### What §§2–3 got right without knowing it

- **"Smoke answers one question: is this dashboard up in production right now?"** (§3) fits
  Google SRE's description of smoke tests as simple critical system behavior that short-circuits
  more expensive testing.
- **The three-per-route cap and the ~80-test gate** (§2, §3) fit Microsoft's recommendation to
  run fast smoke tests on every commit while reserving broader regression coverage for a slower
  cadence.
- **The exclusion table** (§3) lines up almost item-for-item with what the sources push out of
  smoke: filter permutations, sort ordering, tab-by-tab validation, detail deep links.
- **`runMode: 0`** (§5) is the strict reading of the reliability bar. Microsoft notes the cost of
  unreliable tests; a retry that absorbs a real outage is the failure mode §5 already names.
- **A prod-targeted read-only lane is endorsed, not merely tolerated.** Google SRE's production
  probes replay known-good requests against production to expose incompatibilities between test and
  production environments. The acdwrapper drift (D1 in
  `planning/smoke-ui-api-db-chain-coverage.md`) is that phenomenon exactly.
- **Canary is not smoke.** Google SRE distinguishes a canary from a test: it is structured user
  acceptance. Preserve that distinction if canarying is proposed as a substitute for the gate.

### Where the lane diverges: the pyramid is inverted

The sources favour selective UI testing and more coverage below the UI. Microsoft identifies UI and
end-to-end tests as costly and fragile, while Fowler's **subcutaneous test** exercises the system
through an API below the UI to retain much of the end-to-end confidence without UI-framework
complexity.

Measured against that, across both lanes:

| | Count | Sub-modules reached | Industry position |
|---|---:|---:|---|
| UI tests (this lane) | 652–669 | 38 of 38 | should be the **thin** layer |
| API health (backend lane) | 238 | 21 of 38 | should be the **thick** layer |
| DB connectivity + master data | 153 | 20 of 38 | best-aligned layer — see below |

**A 669-test suite is not a smoke suite by any definition in these sources; it is a UI regression
suite named smoke.** That is not an argument to delete it — it is the argument for §2's tiering.
The gate tier *is* the smoke suite; the sweep is regression. §2 already resolves this, and the
external sources raise its priority from housekeeping to the thing that makes the word "smoke"
accurate.

The corollary §2 does not cover: **rebalancing beats adding.** The API layer is thinnest where it
should be thickest. Promoting API-health coverage to all 38 sub-modules does more for deploy
confidence than any further UI test, and it carries none of the flake cost.

### Gate composition across layers

§3 defines what earns `@critical` within this lane. The documents above support early, fast checks;
the following dependency-reachability ordering is an internal engineering decision for this suite,
not an attributed industry quotation.

Dependency reachability is the cheapest, most deterministic, highest-triage-value check available
— no flake, no live-data dependency. The backend lane's DB-connectivity layer already implements it
well. Ordering the gate by cost of failure:

| Order | Layer | Gate content | Owner lane |
|---:|---|---|---|
| 1 | Environment | app reachable at configured URL; datastore accepts a connection; every configured dependency resolves **at its configured location**; auth succeeds and unauthenticated is rejected | backend + `unauthenticated.smoke.cy.js` |
| 2 | Schema | every table/view read by the module exists and is queryable; every package, body, procedure, trigger is `VALID`; reference key sets exact | backend |
| 3 | API | every on-load endpoint returns 200 within its **own** latency budget; envelope shape; item schema; count reconciles with DB | backend |
| 4 | UI | route loads; primary data container renders; count reconciles — the three per route from §3, and nothing more | this lane |

Run in that order and fail fast: a broken dependency should never be discovered by a UI timeout.

Layer 4 additions to §3's exclusion table, from these sources — **out of the gate, and out of a
production lane entirely**: any mutating call, any multi-step business workflow, visual/pixel
assertions, and third-party services under test (Cypress: stub or bypass; never drive Gmail, social
login, or anything with rate limiting or bot detection).

### Exit criteria

**Smoke has no acceptable failure rate.** A "known failure" in the gate is a broken gate, and a
green build with a dead module inside it is the §1(5) / §4 aggregate problem restated. This is why
per-module verdicts (§4) are not a refinement but a precondition — 634/669 reads as 95% healthy
while Checks sits at 0/10.

Budget check against the sources' "minutes, not hours": §2's 3-minute gate is right. Layers 1–3
should land inside 5 minutes on their own; if the backend lane's 391 tests cannot, they need the
same gate/sweep split this document specifies for the UI lane.

### Prerequisite

Per-module gap data lives in `planning/smoke-ui-api-db-chain-coverage.md` (15 of 38 sub-modules have
the full UI→API→DB chain). That document's own §1 caveat applies here: **the backend suite has never
been executed in this workspace**, so its 391 tests are counted, not verified. Smoke's exit
criterion is 100% pass; until a baseline run exists, layers 1–3 above describe intent rather than a
gate.

---

## 9. Open, and not the agent's call

- **The 13 remaining run-155 failures are not triaged here.** Four are Impound Quick Search failing
  on an absent `[data-cy="search-icon"]` — same shape as the Recon Quick Search tests deleted as
  INVALID, so Impound may be a product gap rather than a test bug. Three are
  Collections/Collections-Detail `collectionsLookup` never responding, which needs checking against
  the recently anchored intercept glob; a matcher now too narrow produces exactly this symptom.
- **The Checks Okta grant.** 10 tests stay skipped until the smoke account can reach the module —
  and see §4a(2) for how that interacts with the coverage gate.
- **Whether the sweep runs nightly or per-merge** — a cost decision (Cloud minutes vs. staleness).
- **Whether the gate also runs on `dev`/`qa`,** or only the branches that map to prod.
- **`common/unauthenticated.smoke.cy.js` registers a raw intercept** and has been failing
  `validate-cypress-rules.mjs`'s spec-boundary rule the whole time — it is the one remaining
  blocking violation across all 39 specs (swept 2026-08-20). Fixing it means moving interception
  into a command, which is a real refactor with its own blast radius, not a tag edit. Decide whether
  to do that or to grant the auth-error spec an explicit exemption.
- **Three configured harness gates do not exist**, so the checks that reference them silently never
  run: `scripts/harness/sync-loader-shims.mjs` and `scripts/harness/check-loader-drift.mjs`
  (`.claude/harness.config.json:1147,1150`, invoked by the `sync-reminder` hook on every
  framework-file edit) and `scripts/harness/check-docs-links.mjs` (required by
  `.claude/rules/session-rules.md` after any documentation change). `scripts/` contains only
  `evidence/` and `execution/`. Either the tree was never ported into this workspace or the config
  points at `fhf-harness-os`; until it is resolved, "run the sync" is a reminder with nothing behind
  it — the same class of unenforced rule §5 exists to eliminate.
