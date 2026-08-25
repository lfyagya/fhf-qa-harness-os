# Regression-Effort Evidence Workflow

**Canonical owner:** `docs/planning/roadmap/effort-breakdown-by-module-and-subdashboard.md`.
This directory contains the local, versioned evidence format that implements its regression-effort
measurement gate. It does not establish an ROI result by itself.

> **Per-sprint records moved 2026-08-17.** `records/` no longer holds the sprint scenario lists,
> plans, automation backlogs or release-confidence views. Those are now versioned at
> `front-end-automation-e2e/docs/evidence/regression-effort/records/`, because this directory sits
> in the FHF workspace, which excludes `/docs/` and has no remote — anything written here is
> ignored by git and destroyed by `git clean -fdx`. Two sprint records were nearly lost that way.
>
> **This workflow — the methodology above, the `*.v1.json` templates, and the intake config —
> deliberately stayed here**, because `scripts/evidence/calculate-regression-effort.mjs` reads the
> templates by local path and this directory already has a declared canonical owner. If that
> script gains a remote-backed home, the templates should follow the records.
>
> These files are still unversioned and still at risk. Treat that as open.

## What this measures

The unit is an observed **person-minute**, not a pipeline's elapsed duration. Collect two comparable
releases against one frozen checklist:

1. a manual baseline, with one observation for every activity;
2. a later automation-assisted release, with every activity recorded as either automated or still
   manual, plus human time to trigger, monitor, triage, and report automation.

An activity must be narrow enough to be wholly automated or wholly residual manual. Split a partly
automated task into separate checklist activities before freezing the checklist.

## Collection procedure

1. At sprint planning and backlog refinement, query the **entire current sprint** using the intake
   configuration. QA must classify every returned ticket as `regression_required`, `not_applicable`,
   `deferred`, or `blocked`. A `regression_required` ticket maps to one or more business regression
   activities; every other disposition needs a reason. This is QA's scope assessment, not a release
   owner selection. After pre-sprint planning resolves new/changed work, copy
   `checklist-template.v1.json`, replace all placeholders, enumerate the required activities, and
   set `status` to `frozen`. Record the scope freeze in each release capture. Do not change that
   checklist version once its baseline starts.
2. Copy `manual-baseline-template.v1.json`; record the release-plan URL, Jira release version(s),
   release task, in-scope issue keys, explicit DB/API/Cron dependency review, and immutable final
   Dev-build identity. Then record one observed person-minute entry for every
   frozen activity. `performed` must be `true` for the baseline.
3. On the comparable automation-assisted release, copy
   `automation-assisted-template.v1.json`. Record every checklist activity. An `automated` mapping
   needs exact scenario, test, lane, passed run ID, and native artifact reference; its residual row
   must explicitly say it was not performed. A `residual_manual` activity must include its observed
   manual person-minutes.
4. Confirm the later release still fits the same frozen checklist. If refinement or a new task adds
   an activity, create a new checklist version and collect a new baseline; do not compare it to the
   old scope. Record all four automation operating activities: `trigger`, `monitor`, `triage`, and `report`.
   If one did not occur, record `performed: false`, zero minutes, and the reason. Zero is evidence;
   a missing row is not.
5. Run the calculator. Keep the input files and JSON output together locally under a release-specific
   folder such as `docs/evidence/regression-effort/records/<release-id>/`. Do not add customer
   payloads, credentials, or production identifiers.

```powershell
node scripts/evidence/calculate-regression-effort.mjs `
  docs/evidence/regression-effort/records/checklist-v1.json `
  docs/evidence/regression-effort/records/release-a-manual-baseline.json `
  docs/evidence/regression-effort/records/release-b-automation-assisted.json

node scripts/evidence/calculate-regression-effort.mjs --self-test
```

The calculator writes `evidenceStatus: "UNKNOWN"` and makes every metric `"UNKNOWN"` if an input,
activity, timestamp, person-minute capture, mapping, passed run/artifact, or operating activity is
missing or invalid. It does not produce partial savings.

## FHF release-plan alignment

The FHF source-of-truth release pages identify the release version(s), in-scope Jira work, release
owner, dependencies, and the required final-Dev Smoke/regression and post-release Production
Smoke/regression checks. This workflow adds measurement evidence to that process; it does not
replace the release plan.

- **Pre-release Dev regression:** use the frozen `pre-release-regression` checklist, final Dev build,
  and its manual/automation evidence. It can support a regression-effort calculation.
- **Post-release Production Smoke:** use a separate `post-deploy-smoke` checklist and GET-only
  evidence. Do not combine it with the Dev calculation because it is a different environment and
  safety lane.
- A `COMPLETE` calculation is required for a saved-time claim, not automatically for a Go/No-Go
  decision. Missing evidence remains `UNKNOWN` and must not be presented as zero savings.

## SERV Jira intake configuration

Use `serv-jira-intake-config.v1.json` for the Services Team board. It records the verified project
key, board ID, JQL scope-query shape, and field IDs used to snapshot release scope. Each capture
must name that config, the actual sprint ID, and a read-only sprint-scope snapshot before scope is
frozen.

Story points, original estimate, time tracking, and Estimate Hours are planning inputs only. They
must never enter the saved-time calculation: only observed person-minutes do. Jira status is also
context, not proof that a regression activity was tested or automated. The TestRail Cases/Runs
controls are visible in Jira, but their field IDs were not exposed by the read-only Jira metadata;
the config intentionally marks them `UNKNOWN` and requires a manually recorded case/run reference
until that integration can be verified.

A completed ticket assessment is not the same as a completed regression. The `scopeAssessment`
array proves that QA considered every sprint ticket. Only `regression_required` entries become
checklist activities, and each must then have final-build execution evidence or an explicit blocked
release risk. The release owner confirms deployment/release intent; they do not replace this QA
analysis.

## Calculation contract

- Manual baseline = all observed baseline activity person-minutes.
- Residual manual = all observed person-minutes still required in the automation-assisted release.
- Automation operating = observed human person-minutes for trigger + monitor + triage + report.
- Gross manual-equivalent displaced = baseline person-minutes for activities with an exact passed
  automation test/run mapping.
- Net regression minutes saved = baseline − residual manual − automation operating.
- Scope-match rate = exact passed replacement mappings / replacement activities claimed. The result
  is emitted only when every claimed replacement mapping is complete; otherwise it is `UNKNOWN`.

The workflow reports hours only by converting the final net minutes. Cost savings and ROI always
remain `UNKNOWN` until finance supplies an approved loaded-cost method.
