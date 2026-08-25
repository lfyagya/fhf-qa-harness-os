# FHF Test Execution Strategy

**Owner:** QA engineering
**Status:** Proposed for QA and CI owner adoption
**Audit date:** 2026-08-04
**Scope:** when each lane runs, how the run is scoped to a change, what blocks a merge or a release,
and how any QA triggers a run on demand.

This document owns **execution and triggering only**. It does not define coverage, acceptance, or
product behavior:

| Question | Owner |
|---|---|
| What counts as coverage, and the cross-lane validation split | `framework/testing-standards/TESTS.md` |
| What product behavior is intended | `Test-Case-Automation-Using-Claude-Agents/specs` |
| Which workflows and seams are accepted today | `planning/coverage/fullstack-chain-risk-matrix.md` |
| What test presence exists structurally | `evidence/coverage-computed.json` |
| Priority, sequencing, estimates | `planning/roadmap/effort-breakdown-by-module-and-subdashboard.md` |
| **When to run what, and what blocks** | **this document** |

## Strategy in one sentence

Run the smallest set of tests that can observe a regression from *this* change, on every change;
run everything on a schedule and before a release; and never let a narrowed run stand in for a
release decision.

## Position this strategy has to start from

These are measured facts from the current worktree and run history, not assumptions. Two of them
constrain the design directly.

| Fact | Source | Consequence for execution |
|---|---|---|
| E2E run 666: 36 specs / 380 tests in **28m 42s** on 2 machines × 3 workers | `evidence/execution-history.md` | A full E2E run is cheap enough to schedule often. Impact selection is for feedback speed, not cost. |
| Smoke run 161: **2h 0m 34s**, 13 of 40 specs never started (`startedAt: null`) | `evidence/execution-history.md` | **A full production smoke does not currently complete.** Any "smoke after deploy" trigger would report a partial run as a deploy verdict. Fix orchestration before wiring this trigger. |
| 0 of 14 workflow rows accepted; 0 of 12 cross-module seams have evidence | chain ledger | Gates cannot yet block on accepted-scenario loss, because there is nothing to lose. Ratchet R1 starts as a floor at today's numbers. |
| 198 E2E fallback markers, 1 disabled smoke suite, 75 backend `pytest.skip()` calls | `evidence/coverage-computed.json` | Debt is the only portfolio metric currently large enough to ratchet meaningfully. Freeze it now. |
| E2E and Smoke live in **one** GitHub repository (`treacyandcoventures/front-end-automation`), lane selected by spec pattern | git remotes; both buildspecs | One dispatch workflow serves both lanes. Lane is an input, not a repository. |
| Backend automation is a separate repository and a separate CodeBuild project | git remote; `fhf-backend-automation/buildspec.yml` | Backend needs its own dispatch workflow with its own inputs. |
| Cypress Cloud already distributes specs across workers via `--ci-build-id` | both buildspecs | Selection passes a spec pattern; it must never hand-shard. Cloud owns balancing. |
| Neither lane records the deployed application SHA | chain ledger | Until it does, an execution result cannot be attributed to an application version. Every trigger below must carry it. |

## Scope boundary

This strategy covers the `CypressFHF/fhf-dashboards` package (E2E + Smoke lanes) and
`fhf-backend-automation`. Two Cypress Cloud projects are **deliberately excluded**, recorded here so
they are not repeatedly rediscovered as coverage gaps:

| Excluded | Cloud project | Reason | Decided |
|---|---|---|---|
| `CypressFHF/fhf-los` — loan origination (B2F queues, Matching Module) | `fcnnrc` `FHF-LOS-Spark` | Not this team's remit | QA owner, 2026-08-04 |
| Scratch project | `8ezjbp` `Local Testing` | Not a release-bearing lane; never cite its runs as evidence | 2026-08-04 |

The `fhf-los` package shares the UI automation repository and uses a different spec convention
(`.E2E.js` / `.smoke.js` rather than `.cy.js`), so the `*.cy.js`-based inventory generator does not
count it. **Given the scope decision that is correct behaviour, not a defect** — the only thing needed
is the qualifier below.

**One reporting consequence to honour.** "47 E2E specs / 40 Smoke specs" and every ratchet number
describe `fhf-dashboards` only. They are lane figures, not whole-organisation figures. Any coverage
claim taken outside the team should carry that qualifier, otherwise the same number gets read as
portfolio-wide by someone who does not know the boundary. Selection, the coverage ratchet, and the
chain ledger all exclude `fhf-los` by design.

Reopen the decision only if ownership of loan origination moves to this team, or if an
origination-to-servicing seam becomes a stated product risk.

## Trigger matrix

`Blocking` means a non-zero exit fails a required status check or the build.

| # | Trigger | Lane | Scope | Env | Blocking | Fires from |
|---:|---|---|---|---|---|---|
| 1 | PR opened/synchronised, automation repo | harness contract | changed files | n/a | Yes (exists today) | `cypress-nonnegotiable-rules.yml` |
| 2 | PR opened/synchronised, automation repo | e2e | impact-selected from changed specs and support files | dev | Yes | new PR workflow |
| 3 | PR opened/synchronised, application repo | e2e | impact-selected from changed source paths | dev | Yes for modules with e2e coverage; reports the gap otherwise | new PR workflow |
| 4 | PR opened/synchronised, either repo | ratchet gate | portfolio-wide | n/a | Yes | `coverage-ratchet.mjs check` |
| 5 | Merge to `dev` | e2e | impact-selected from the merge diff | dev | No — informational, feeds history | CodeBuild webhook |
| 6 | Sprint boundary (schedule) | e2e | **full** | dev then qa | No — this is the regression baseline | scheduled dispatch |
| 7 | Pre-release, before staging promotion | e2e + backend | **full**, both lanes | qa | Yes — release gate | scheduled or manual dispatch |
| 8 | Production deploy completed | smoke | **full**, GET-only | prod | Yes — **blocked on the orchestration fix below** | deploy webhook |
| 9 | Nightly | backend | **full** pytest | dev | No — informational | CodeBuild schedule |
| 10 | On demand, any QA | any | operator-chosen | operator-chosen | Configurable per run | `qa-on-demand.yml` dispatch |

### Deliberately not triggered

- **Full E2E on every PR.** 29 minutes per PR buys nothing over an impact-selected run plus the
  scheduled full baseline, and it trains people to ignore red.
- **Smoke on a PR or a feature branch.** Smoke is production and GET-only. It answers "is the
  deployed system readable and authorised", which a pre-merge branch cannot change.
- **Any mutating lane against production.** Trigger 8 is the only production trigger and it inherits
  the GET-only lane contract without exception.
- **Impact-selected runs as a release verdict.** Triggers 7 and 8 are full runs for exactly this
  reason. A narrowed run is feedback; a release claim needs the whole suite.

### Trigger 8 is blocked, and should stay blocked

Wiring "full smoke after every production deploy" today would produce a green deploy verdict from a
run where 13 of 40 specs never started. That is precisely the false-green pattern the testing
standard prohibits. Two things must land first, both already P0 in the planning owner:

1. every configured smoke spec starts within the run budget, and an unstarted or `noTests` spec
   fails the orchestration gate with an exact reason;
2. the run records the deployed application version.

Until then, run smoke on a schedule, read it as diagnostic evidence, and do not gate deploys on it.

## Impact-based selection

Implemented by `scripts/execution/select-impacted.mjs` against `scripts/execution/impact-map.json`.
Deterministic: no LLM, no network, no clock. Output is a spec pattern for Cypress `--spec` and a
path list for pytest.

### The one invariant

**Selection may only ever narrow a run that would otherwise be full.** Everything below follows from
that. A selector that can silently omit a spec that would have failed is worse than no selector,
because it converts an unknown into a green.

### Escalation ladder

Evaluated per changed file; the first rule that matches wins.

| Rule | Trigger | Result |
|---:|---|---|
| 1 | Path is an auth/session path | **Full run.** A broken session invalidates every other result in the run. |
| 2 | Path is a shared path — common component, `DashboardGenerator`, network/axios layer, router, store, utils, hooks, context, deps | **Full run.** A shared component has no owning module; attributing it to one is a guess. |
| 3 | Path is owned by one or more modules | Select those modules. |
| 4 | Path is under `src/` but unattributable | **Full run**, and the path is listed in `unmapped` so the map gets fixed. |
| 5 | Path is outside `src/` (docs, README, `.github`, tooling) | Selects nothing on its own. |

Then, only if no rule forced a full run:

| Rule | Trigger | Result |
|---:|---|---|
| 6 | A selected module is upstream of a cross-module seam | Add the downstream module, **one hop only**, and only for lanes where `observableBy` says the seam is visible. |

One hop is deliberate. Transitive closure over the 12 seams degenerates to "run everything" within
two hops, at which point the signal is gone. Two hops is a scheduled full run's job, not a PR's.

### Worked examples, verified against the working tree

| Change | Selected | Why |
|---|---|---|
| `src/modules/titles/TitleGrid.tsx` | `titles` | Direct ownership. No seam is downstream of titles. |
| `src/services/lossMitigation/invoice.js` | `loss-mitigation`, `titles`, `checks` | Direct, plus the repo→title flip cascade (e2e/smoke) and the invoice-accounting→check-posting money seam (backend). |
| `src/modules/insurance/TotalLoss.tsx`, lane `e2e` | `insurance`, `loss-mitigation` | Total Loss movement raises Impound notification behavior, observable in e2e. |
| `src/modules/insurance/TotalLoss.tsx`, lane `backend` | `insurance` | The same seam is not backend-observable, so it is not added. |
| `src/components/common/Table/index.tsx` | all 14 modules + `auth/login.cy.js` | Shared path. Rule 2. |
| `src/services/authAxiosInstance.js` | all 14 modules + auth specs | Rule 1. |
| `api/base_client.py` (backend repo) | full backend lane | Shared backend layer. |
| `cypress/support/commands/modules/titles.commands.js` | full e2e lane | Shared automation plumbing. |
| `README.md` | nothing | Rule 5. |

### Coverage gaps are reported, not hidden

Selection also emits `gaps` for every selected module missing a lane. A titles change reports
`titles: no backend automation`. This is the honest output: the run is green *for the lanes that
exist*, and the missing lane is a stated gap rather than an implied pass. Verified today:

- no backend suite exists for 11 of 14 modules (only ancillary, loss-mitigation, unifi have one);
- no e2e specs exist for complaints, contracts, letters;
- no smoke specs exist for funding.

### Maintaining the map

`impact-map.json` is the single place a new module, route, or seam is registered. Two guards keep it
honest:

1. Rule 4 fails loudly — an unmapped `src/` path forces a full run and names itself, so drift costs
   run time immediately instead of silently shrinking coverage.
2. The map's module keys are the same keys as `.harness/config.json` `moduleAliases`. A key that
   does not exist there is a bug in one of the two.

The map currently lives in the consumer root. Its long-term home is the canonical harness config
alongside `moduleAliases` and `moduleSpecPaths`, so there is one module vocabulary rather than two —
see "Owner actions" below.

## Gates

Three independent gates. They judge different things and must not be collapsed.

| Gate | Judges | When | Decider | Exists today |
|---|---|---|---|---|
| Harness contract | code compliance on the diff | PR | `.harness/verify.mjs change` | Yes |
| Static architecture | duplicate selectors, aliases, command refs, undefined refs | pre-run | 4 scripts in the smoke repo | Smoke only — E2E parity is a P0 gap |
| Release gate | test **results**: criticals pass, P1 coverage, regression pins | after a run | `release-gate.mjs` | Yes, not wired into CodeBuild |
| **Coverage ratchet** | **portfolio not left worse protected** | PR | `coverage-ratchet.mjs check` | New, this document |

### The coverage ratchet

`scripts/execution/coverage-ratchet.mjs`. Reads the artifacts that already own each fact rather than
inventing a fourth coverage definition. Exit 0 = GO, 1 = NO-GO, 2 = missing artifact.

| Ratchet | Rule | Source | Why this one |
|---|---|---|---|
| R1 accepted evidence | `acceptedFullChain` and `backendOnlyAccepted` may not fall | chain ledger Portfolio position table | The only metric that tracks real product protection. A drop blocks even if every test passes. |
| R2 false-green debt | E2E/smoke fallback markers, disabled suite files, backend skip calls may not rise | `coverage-computed.json` `signals` | Stops "add a test that logs Skipping and returns" from reading as progress. |
| R3 UI coverage floors | every critical view stays at or above its committed floor; no view drops more than 5 points | UI Coverage results JSON | Structural only. It can block; it can never promote a workflow to accepted. |

Committed baseline: `scripts/execution/ratchet-baseline.json`, captured 2026-08-04 —
0 accepted full chains, 1 backend-only accepted, and debt frozen at 198 / 0 / 1 / 1 / 75.

Three properties worth stating explicitly:

- **Missing input is never a pass.** An absent artifact exits 2 and fails CI loudly. A critical view
  that vanishes from the results is NO-GO, not a skip — an unstarted view is not a covered view.
- **A malformed portfolio table throws** rather than parsing as zero, so a documentation edit cannot
  silently relax R1.
- **R3 tolerates 5 points of drift** because UI Coverage is sampled from a real browser run and a
  zero-drift rule would flake constantly. Floors do not drift.

Raising the baseline is a reviewed PR with a stated reason. Lowering it to make CI pass is the one
change this gate exists to make visible.

### Ratchet rollout

R2 blocks from day one — the debt numbers are large, stable, and generated. R1 is a floor at zero
until the first chain is accepted, then becomes the strongest gate you have. R3 stays advisory until
one clean run produces per-view numbers to set floors from; the buildspec UI Coverage gate remains
the authority in the meantime, and the baseline ships floors at 0 so the first commit cannot
false-block.

## On-demand execution

Any QA triggers any lane, at any scope, from the GitHub Actions UI. GitHub Actions is the trigger
surface and audit trail; AWS CodeBuild remains the execution engine, so no QA needs AWS console
access and nothing about the existing batch/parallel/Secrets Manager setup changes.

```text
  QA picks inputs in the GH Actions UI
        │
        ├─ select-impacted.mjs resolves modules → spec pattern      (deterministic)
        ├─ lane policy check: smoke ⇒ prod + GET-only, refuse otherwise
        │
        └─ aws codebuild start-build-batch --environment-variables-override
                 SPEC_PATTERN, ENV, TEST_TYPE, WORKERS, DEPLOYED_APP_SHA, TRIGGERED_BY, CHAIN_ID
                     │
                     └─ existing buildspec runs unchanged → Cypress Cloud + JUnit + TestRail
```

### Dispatch inputs

`front-end-automation/.github/workflows/qa-on-demand.yml`:

| Input | Values | Notes |
|---|---|---|
| `lane` | `e2e`, `smoke` | Sets the spec root. `smoke` forces `environment: prod`. |
| `scope` | `impacted`, `modules`, `full`, `spec` | `impacted` needs `base_ref`; `spec` takes a literal pattern for a single-spec rerun. |
| `modules` | comma-separated module keys, or `all` | Validated against the map; an unknown key fails fast rather than silently running nothing. |
| `base_ref` | git ref | Only for `scope: impacted`. |
| `spec_pattern` | Cypress glob | Only for `scope: spec`. |
| `environment` | `dev`, `qa`, `prod` | `prod` + `lane: e2e` is refused by the policy step. |
| `deployed_app_sha` | SHA or `unknown` | Recorded as run provenance. `unknown` is allowed but stamped as such, never omitted. |
| `chain_id` | optional | Tags the run against a chain in the seam artifact. |
| `reason` | free text, required | Appears in the Cloud run description and the execution history row. |

`fhf-backend-automation/.github/workflows/qa-on-demand.yml`:

| Input | Values | Notes |
|---|---|---|
| `scope` | `impacted`, `modules`, `full`, `keyword` | `keyword` maps to `pytest -k`. |
| `modules` | `ancillary`, `loss-mitigation`, `unifi`, `all` | Only these three have suites today. |
| `keyword` | pytest `-k` expression | e.g. `approval`. |
| `order_scope` | `module` (default) | The repo's conftest enforces file ordering; changing this is an expert action. |
| `upload_testrail` | boolean, default false | An ad-hoc debugging run should not pollute the TestRail run history. |
| `deployed_api_version`, `reason` | | Provenance, both recorded. |

### Config contract: the variables that actually work

Dispatch only works if the buildspec lets the override survive. It did not.

**The bug.** Both Cypress buildspecs assigned scope variables unconditionally in the `build` phase:

```yaml
export SPEC_PATTERN="cypress/tests/fhf-dashboard/e2e/**/*.cy.js"   # before
```

`run-parallel.sh` reads `SPEC_PATTERN` as `${SPEC_PATTERN:-default}`, so it always honoured an
override — but the buildspec overwrote the variable moments before calling the script. A CodeBuild
`--environment-variables-override` was therefore accepted, ignored, and the **full suite ran while
the dispatch UI reported a narrowed scope**. A narrowed run that silently becomes a full run is a
correctness failure, not just wasted minutes: it makes the trigger surface lie about what it ran.

The same held for the backend, where `testrail_integration.sh` hardcoded `TEST_TARGET="tests/"` and
`buildspec.yml` hardcoded `all -n auto`, so no scope could be passed at all.

**The fix** was to make each assignment defaulting rather than absolute, matching the idiom
`run-parallel.sh` already used. Defaults are unchanged, so every existing webhook build behaves
exactly as before.

| Variable | Honoured in | Effect | Default |
|---|---|---|---|
| `SPEC_PATTERN` | both Cypress buildspecs → `run-parallel.sh` | Cypress `--spec`; comma-separated globs | lane root |
| `FHF_LANE_OVERRIDE` | E2E buildspec | Forces `e2e` or `smoke` instead of inferring from `ENV` | inferred |
| `FHF_ENV_OVERRIDE` | both Cypress buildspecs | Sets the target env for a branch-less dispatch; **still validated** against `dev|qa|prod` | branch-derived |
| `WORKERS` | both | Workers per machine | 3 |
| `TEST_TYPE`, `AQ_PROFILE`, `CONFIG_FILE` | both | Cloud grouping/tags and env config file | lane defaults |
| `TEST_TARGET` | `testrail_integration.sh` | pytest collection paths; space-separated, split into an array | `tests/` |
| `FHF_PYTEST_TARGET` | backend buildspec → `TEST_TARGET` | same, via dispatch | `tests/` |
| `FHF_PYTEST_EXTRA` | backend buildspec | Extra pytest args, e.g. `-k approval` | none |
| `FHF_UPLOAD_TESTRAIL` | backend buildspec | `false` runs tests without writing TestRail history | `true` |
| `FHF_TRIGGER`, `FHF_TRIGGERED_BY`, `FHF_RUN_REASON` | all three | Provenance, echoed into the build log | webhook/ci |
| `FHF_DEPLOYED_APP_SHA`, `FHF_DEPLOYED_API_VERSION` | all three | Version attribution; echoed even when `unknown` | `unknown` |
| `FHF_CHAIN_ID` | all three | Tags the run against a cross-lane chain | none |

Two safety rules are now enforced **in the buildspec**, not only in the dispatch layer, so they hold
however the build was started — webhook, console, or workflow:

1. `lane=e2e` with `ENV=prod` aborts the build. E2E mutates real records.
2. Any spec glob outside `cypress/tests/fhf-dashboard/smoke/` aborts a smoke build. Selection may
   narrow the smoke set; it may never step outside it.

An empty selection also aborts rather than running everything or nothing silently — a zero-test run
is not a pass.

### Reuse what already exists

Two existing scripts cover on-demand needs and should be wired in rather than rebuilt:

- **`scripts/gate-module.sh <module-key>`** (smoke repo) already runs one module twice and diffs the
  failing-test *sets*, because smoke sets `retries.runMode = 0` on purpose and Cypress Cloud's flake
  detection needs retries. It measured real run-to-run movement on identical code (assignment 11/5 →
  13/3, auction-invoice 22/2 → 21/3), which is why a single green run never licensed a release. Its
  module keys are the `smoke/` subdirectory names — **the same keys and globs this strategy's impact
  map uses**, so the two compose with no translation. Expose it as an on-demand `scope: flake-gate`.
- **`scripts/release-gate/release-gate.mjs`** (E2E repo) already turns run results into a blocking
  GO/NO-GO and is unit-tested, but is not called from CodeBuild. Wire it into the post-build step for
  triggers 7 and 8 instead of writing a second results gate.

### Guardrails on the dispatch surface

1. `lane: smoke` may only target `prod` and may never receive a spec pattern outside the committed
   smoke root. Selection can subtract smoke specs; it can never add one.
2. `lane: e2e` may never target `prod`. The buildspec currently maps production branches to the smoke
   spec pattern; the dispatch layer refuses the combination outright rather than relying on that.
3. Every dispatch records who triggered it, why, and against which deployed version. A run without
   provenance is diagnostic only and must not be cited in a release decision.
4. TestRail upload is opt-in for on-demand runs and stays automatic for scheduled ones.

## What each execution answers, and what it does not

The honest boundary. This is what stops a green run from being over-claimed.

| Trigger | Answers | Does not answer |
|---|---|---|
| PR impact-selected e2e | did this change break the UI behavior of the modules it touches, in dev | anything about untouched modules, persistence, production, or the seams |
| PR ratchet | did this change leave the portfolio worse protected | whether the portfolio is well protected |
| Sprint full e2e | is the whole committed UI journey set green in dev | correctness of money/date/state — that is the backend lane's oracle |
| Nightly full backend | do the service contracts and Oracle assertions hold for the 3 modules with suites | the 11 modules with no backend suite |
| Pre-release full both lanes | is every committed test green against one candidate | any workflow the chain ledger has not accepted, or any of the 12 seams |
| Post-deploy smoke | is the deployed system readable and authorised, GET-only | anything mutating, and — until orchestration is fixed — whether the whole suite even ran |

## Evidence sources for the triggers

### Cypress Cloud CLI

Cypress Cloud is queried with the CLI configured in `.harness/config.json`
`connectors.cypressCloud.cli`, per <https://docs.cypress.io/cloud/integrations/cloud-cli>. There is
no Cypress Cloud MCP server; the CLI is the access path, so it will never appear as an agent tool.

| Setting | Value |
|---|---|
| Package / command | `@cypress/cloud` / `cy-cloud`, installed globally |
| Minimum Node | 22.21.0 |
| Project ID source | `cypress.config.js` |
| Auth, local | OAuth — interactive browser |
| Auth, CI | `CYPRESS_CLOUD_TOKEN` |
| Lane access | e2e `full-read`, smoke `metadata-only`, root `metadata-only` |
| Projects | E2E `nptdoe`, Smoke `r5k1ro` |

Two config guards apply and are not optional:

- **Never inline a token.** `cy-cloud login --token …` and `CYPRESS_CLOUD_TOKEN=…` on a command line
  are both blocked patterns. In CI the token arrives from Secrets Manager as an environment variable.
- **Production-sensitive commands are gated.** `cy-cloud replay info|timeline` and
  `cy-cloud test get --screenshot` can surface production imagery; the smoke lane is metadata-only
  for exactly this reason, and the smoke build already purges production artifacts.

**`cy-cloud` does not expose UI Coverage.** Its command nouns are `org`, `project`, `run`, `spec`,
`test`, `replay`, `status`, `version`, `login`, `logout`, `cache` — and nothing else. Per-view UI
Coverage percentages come from the `extract-cloud-results` package the two buildspecs already
install from Cypress's CDN, or from the Data Extract API. Do not expect the CLI to feed ratchet R3.

Two more preconditions that look like "the CLI is broken" when unmet:

- **An org admin must enable Cloud CLI** on the organization's Integrations page in Cypress Cloud.
  Until then every authenticated command fails.
- **Rate limit is 100 requests per hour per user.** Paginate with `--limit 100` rather than looping
  one request per test, or a triage script will exhaust the hour.

Useful commands, with the real flag names (`--projectId`, `--runNumber` — not `--project`/`--run`):

```bash
npm install --global @cypress/cloud     # Node >= 22.21.0

# Run-level summary: gitSha, per-status counts, duration
cy-cloud run get --projectId nptdoe --runNumber 666

# The 13 unstarted smoke specs, directly
cy-cloud spec list --projectId r5k1ro --runNumber 161 --status timedOut,noTests

# Failing tests with error and stack trace, paginated
cy-cloud test list --projectId nptdoe --runNumber 666 --status failed --limit 100 --page 1

# Flake without retries enabled: passed tests that needed more than one attempt
cy-cloud test list --projectId nptdoe --runNumber 666 --status passed \
  | jq '.tests[] | select((.attempts | length) > 1) | {testId, testName}'

# Output shape before writing jq filters — no network call
cy-cloud test list --schema
```

`--help` and `--schema` are the two flags the harness config marks safe to run with no network and
no credentials, and the docs confirm `--schema` makes no request.

For the E2E selector cascade specifically, `replay timeline --testId <id> --commands --aroundFailure 5
--network --logs` reconstructs the moment of failure without opening a browser — which is how to
confirm whether the 71 `dashboard-item-count` failures share one root cause.

A **Cloud MCP** also exists (`docs.cypress.io/cloud/integrations/cloud-mcp`). That is what
`connectors.cypressCloud.queryOrder`'s `cloud-mcp` entry refers to; it is simply not installed as a
connector in this workspace yet. Installing it would make Cloud data available to agents directly
instead of via shelling out to the CLI.

### Cloud MCP and Cloud CLI: two paths, no conflict

These are routinely confused because both are called "a Cypress Cloud token". They are **different
credentials, from different places in the Cloud profile, read under different names**, backed by
**separate org integrations** and **separate 100-request/hour limits**.

| | Cloud MCP | Cloud CLI |
|---|---|---|
| What it is | Remote server `https://mcp.cypress.io/mcp` for AI clients | Local binary `cy-cloud` for humans, scripts, shell-running agents |
| PAT generated under | Cloud profile → **MCP personal access token** | Cloud profile → **Cloud CLI access** → Personal access token |
| Env var in Cypress's own examples | **`CYPRESS_MCP_TOKEN`** | **`CYPRESS_CLOUD_TOKEN`** (the only name `cy-cloud` reads) |
| Preferred auth | OAuth via the AI client — no env var | `cy-cloud login` OAuth — no env var |
| Org integration | "Cloud MCP" — enable separately | "Cloud CLI" — enable separately |
| UI Coverage access | **Yes** — `cypress_get_ui_coverage_report` / `_views` / `_elements` | **No** |
| Test Replay depth | Failure details + Replay links | Full `replay timeline` (commands, network, logs) |

So `CYPRESS_CLOUD_TOKEN` is **not** claimed by the MCP. Cypress's own MCP client examples for Claude
Desktop, Codex, and Copilot CLI all use `CYPRESS_MCP_TOKEN`. Putting an MCP token into
`CYPRESS_CLOUD_TOKEN` is what manufactures the appearance of a collision and then forces the CLI
token onto a name nothing reads.

**Same bug, three variables.** Cypress tooling reads exact names; a descriptive suffix silently
disables the credential:

| Name observed | Read by | Consequence |
|---|---|---|
| `CYPRESS_CLOUD_CLI_TOKEN` | nothing | CLI is unauthenticated; indistinguishable from no token |
| `CYPRESS_CLOUD_TOKEN` holding an MCP token | `cy-cloud` | CLI sends the wrong credential and fails auth |
| `CYPRESS_RECORD_KEY_FHF…` | nothing | Local `cypress run --record` cannot record. CI is unaffected — it builds `.env` from Secrets Manager and exports the exact name. |

### Where each credential belongs

A PAT is only needed where no browser exists. That is CI — not a workstation.

| | Workstation (interactive) | CI (non-interactive) |
|---|---|---|
| Cloud CLI | `cy-cloud login` — OAuth, stored, **auto-refreshes** | `CYPRESS_CLOUD_TOKEN` from Secrets Manager |
| Cloud MCP | AI-client OAuth — browser sign-in, **30-day auto-refresh** | n/a — CI runs no AI client |
| Recording | `.npmrc` `RECORD_KEY`, or `CYPRESS_RECORD_KEY` at point of use | `CYPRESS_RECORD_KEY` from Secrets Manager (already wired) |

**So the recommended workstation state is zero Cypress tokens in the OS environment.** Nothing to
name, nothing to collide, nothing to rotate, nothing to leak into a shell history or a crash dump.
Authenticate once per path; both then persist and refresh themselves.

One-time setup, each done in the owner's own session:

```bash
# Cloud CLI — any terminal. Browser opens; click Allow.
cy-cloud login
cy-cloud status          # {"authenticated": true, "method": "oauth", ...}
```

Cloud MCP — the root `.mcp.json` already points at `https://mcp.cypress.io/mcp` with **no**
`Authorization` header, so the client triggers OAuth on first use. For Claude Code:
`claude mcp add cypress-cloud https://mcp.cypress.io/mcp --transport http --scope user`, then prompt
it once and approve in the browser. For a desktop client, add it as a custom connector and press
Connect.

**Can one token serve both?** Treat them as separate. Cypress issues them from two different sections
of the Cloud profile and gates them behind two different org integrations, and the documentation never
states they are interchangeable. Even if one happened to work for both today, that is not a contract
Cypress commits to, so it would be a silent breakage waiting for a Cloud release.

Reuse is also the weaker security position, not the stronger one: one credential shared across many
consumers means a wider blast radius, no way to tell which consumer leaked it, and one revocation
takes everything down at once. Separate credentials per integration limit the damage; OAuth is better
still, because nothing is stored in plaintext at all.

If you do prefer tokens on the workstation, the minimal correct mapping is: MCP PAT →
`CYPRESS_MCP_TOKEN` (and the client config must reference that name), Cloud-CLI PAT →
`CYPRESS_CLOUD_TOKEN`, record key → `CYPRESS_RECORD_KEY`. Note that on Windows, environment-variable
changes do not reach already-running processes — restart terminals and AI clients afterwards.

**The precedence trap.** `CYPRESS_CLOUD_TOKEN` **takes precedence over** credentials stored by
`cy-cloud login`. A wrong or MCP-issued value there silently overrides a valid stored session, and
every command fails with an auth error that looks like the login never worked. `cy-cloud logout` does
not clear the variable.

### Detect before configuring

`scripts/execution/cloud-access-doctor.mjs` reports what already exists and names only what is
missing — the "look first, configure only the gap" step.

```bash
node scripts/execution/cloud-access-doctor.mjs            # presence report
node scripts/execution/cloud-access-doctor.mjs --probe    # also runs `cy-cloud status` (network)
node scripts/execution/cloud-access-doctor.mjs --json     # machine-readable
```

It checks the Node floor, whether `cy-cloud` is on PATH, which of the four variables are set, whether
stored CLI credentials exist, which auth path actually resolves, and which AI-client MCP configs are
present. It flags the misnaming case and the precedence trap explicitly, and states the two facts it
cannot detect locally: whether each org integration is enabled, and whether a PAT has expired.

**It reports presence only and never reads, prints, or transmits a token value.** The harness config's
`inlineCredentialPatterns` guard blocks `cy-cloud login --token …` and `CYPRESS_CLOUD_TOKEN=…` from
agent-run shell commands, and that guard should stay: establishing credentials is an owner action in
the owner's own shell or secret store. An agent consumes an already-authenticated session; it never
creates one.

**This cannot be done from an agent sandbox.** Verified on 2026-08-04: `registry.npmjs.org` returns
403 by sandbox security policy, `cloud.cypress.io` returns HTTP 000 (no egress), and none of
`CYPRESS_CLOUD_CLI_TOKEN`, `CYPRESS_CLOUD_TOKEN` or `CYPRESS_RECORD_KEY` is present in the sandbox
environment — the sandbox is an isolated Linux container and does not inherit workstation variables.
Cloud queries are a workstation or CI action. Cloud numbers quoted in any document must name the run
they came from.

### Sprint boundary signal

Trigger 6 says "sprint boundary". Verified against Jira on 2026-08-04:

- `project = SERV AND sprint in openSprints()` returns **0 issues**;
- `project = SERV AND sprint is not EMPTY` returns **10,336 issues**.

So sprints are used historically but no sprint is open right now. `openSprints()` therefore cannot
be the scheduling signal for trigger 6 — a cron keyed on it would silently never fire. Until a sprint
cadence is confirmed with the delivery owner, schedule the full E2E baseline on a fixed cron
(a weekly slot) and treat "sprint boundary" as the intent, not the implementation.


## Re-run optimization and failed-spec selection

Cypress Cloud **Re-run Optimization** (Smart Orchestration → **Run only failed specs**) re-executes
only specs that failed in the anchor run. Enable it for projects `nptdoe` (E2E) and `r5k1ro` (Smoke).

CI wiring (both lane buildspecs + `run-parallel.sh`):

- `CYPRESS_RERUN_GROUP_ID` — defaults to `CODEBUILD_INITIATOR` / `CODEBUILD_BUILD_ID`. On a manual
  CodeBuild retry, pass the prior build's group id as an environment override so Cloud can pair the
  retry with the failed-spec set.
- `CYPRESS_RERUN_ALL_TESTS=true` — force a full suite when you intentionally want everything again.

Local / dispatch helpers (no network unless you pipe Cloud JSON):

```bash
node scripts/execution/select-failed.mjs --junit reports/junit/merged.xml
cy-cloud test list --projectId nptdoe --runNumber 666 --status failed --limit 100 \
  | node scripts/execution/select-failed.mjs --from-json -
node scripts/execution/night-brief.mjs
```

Human triage order: `docs/framework/triage-runbook.md`. E2E debugger must pull
`cy-cloud replay timeline --aroundFailure 5 --commands --network --logs` (prefix `FHF_LANE=e2e`
from the consumer root). Studio AI limits: harness `.claude/rules/studio-ai-policy.md`.

## Owner actions this strategy needs

| # | Action | Owner | Why it is not done here |
|---:|---|---|---|
| 1 | Register `execution` → `docs/framework/execution-strategy.md` in `documentation.owners` | Harness/CI owner | **Done in qa-control-plane.json** — run `node scripts/harness/sync-loader-shims.mjs` from harness-os to project. Also registered `triage` → `docs/framework/triage-runbook.md`. |
| 2 | Promote `impact-map.json` into the canonical harness config beside `moduleAliases` | Harness/CI owner | Same projection boundary; also removes the two-vocabulary risk. |
| 3 | Create the AWS IAM role and OIDC trust for GitHub Actions to call `StartBuildBatch` | CI/platform owner | Requires AWS account access. |
| 4 | Fix smoke orchestration so every spec starts, then enable trigger 8 | Smoke + CI owner | Already P0 in the planning owner. Trigger 8 stays disabled until then. |
| 5 | Add the deployed application SHA to both buildspecs and the backend buildspec | Application, CI owners | Already P0. Every trigger above depends on it for attribution. |
| 6 | Give E2E the four static architecture checks smoke already runs, from one shared owner | E2E + harness owner | Already P0; do not copy drift-prone scripts between repositories. |
| 7 | Set R3 per-view floors from the first clean run | QA Lead | No clean run exists yet; floors ship at 0 deliberately. |

## Verification

```bash
node --test scripts/execution/test/execution.test.mjs     # selection + ratchet + doctor logic
node scripts/execution/select-impacted.mjs --help
node scripts/execution/coverage-ratchet.mjs check --baseline scripts/execution/ratchet-baseline.json
node scripts/execution/cloud-access-doctor.mjs            # Cloud access preflight
node ../fhf-harness-os/scripts/harness/check-docs-links.mjs   # after any documentation change
```

The buildspec override behaviour is verifiable without a CodeBuild run, by sourcing the real block:

```bash
# extract the patched lane/scope block and prove an override survives
python3 -c "import yaml;d=yaml.safe_load(open('front-end-automation-e2e/CypressFHF/fhf-dashboards/buildspec.yml'));\
[open('/tmp/lane.sh','w').write(c) for c in d['phases']['build']['commands'] if isinstance(c,str) and 'FHF_LANE_OVERRIDE' in c]"

ENV=dev bash -c 'source /tmp/lane.sh; echo "$SPEC_PATTERN"'                       # full e2e
ENV=dev SPEC_PATTERN='cypress/tests/fhf-dashboard/e2e/dashboards/titles/**/*.cy.js' \
  bash -c 'source /tmp/lane.sh; echo "$SPEC_PATTERN"'                             # narrowed, survives
ENV=prod FHF_LANE_OVERRIDE=e2e bash -c 'source /tmp/lane.sh' ; echo "exit=$?"      # must abort
```
