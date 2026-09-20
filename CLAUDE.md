# fhf-harness-os — QA Engineering Harness

This repo is the **harness**: the scaffolding that compensates for what a model can't do reliably on its own — deterministic hooks, role-separated agents (generator vs evaluator), skills, and the routing rules that tie them together. Full topology: `docs/framework/harness-engineering.md`.

It is not a QA test suite. It contains no Cypress specs, no application docs, no coverage data. Those are payload, and payload lives in the configured consumer workspace:

- `paths.consumerRoot` in `config/qa-control-plane.json` — QA docs, coverage evidence, and the automation backlog
- `paths.lanes.e2e.rootEnv` — the E2E lane root selected by local environment/setup
- `paths.lanes.smoke.rootEnv` — the Smoke lane root selected by local environment/setup

`fhf-backend-automation` is a lane on equal footing with E2E and Smoke: it is covered by the same
unflagged `sync-loader-shims.mjs` run and the same unflagged `check-loader-drift.mjs` run. Since
ADR-0032 a lane receives no `.claude/` of its own — one central set lives at the workspace root and
is selected per task, so backend agents and Cypress agents are both reachable from a single session.
Backend authoring and pytest execution remain task-scoped: writes and runs require an active, validated `FHF_ACTIVE_TASK`
manifest and stay inside its selected paths in a non-production environment — see
`.claude/rules/agent-spawning-gate.md` and `.claude/rules/backend-automation.md`.

## What lives here

```
.claude/
    hooks/      — the 26 deterministic gates, across SessionStart, UserPromptSubmit,
                  PreToolUse, PostToolUse, PostToolUseFailure, SubagentStart, SubagentStop,
                  PreCompact, Stop and SessionEnd. The control plane, the generated settings
                  and the hook sources are themselves default-deny for agent writes
                  (ADR-0027); owner opt-in is FHF_ALLOW_HARNESS_EDIT=1. Every hook must
                  record the model limitation it compensates for, ratcheted against
                  .claude/hooks/rationale-baseline.json.
    agents/     — 7 agents. Cypress lane, one per phase: cypress-generator (build), cypress-gate
                  (evaluator), cypress-debugger (diagnose/fix), cypress-shipper (ship/report).
                  Cross-layer/backend: qa-automation-generator, qa-automation-debugger,
                  qa-automation-gate
    rules/      — routing map, source map, session discipline, assertion precision
    skills/     — cypress-author (vendored; FHF convention-only, no spec writes), cypress-docs, cypress-explain, cypress-tap (Cypress AI Toolkit; not ours), backend-test-author
scripts/harness/
    generate-coverage.mjs      — consent-gated scan; writes ignored runtime evidence into FHF/docs/evidence/
    qa-command-center.mjs      — sprint/spec intake plus portable JSON/Markdown/HTML dashboard
    eval-harness.mjs            — route, calibration, and trace-derived repair evaluation
    calibrate-gate.mjs          — imports machine verdicts and records explicit human labels
    record-loop-event.mjs       — redacted runtime loop state and trace recorder
    verify-canonical.mjs       — runs engineering.harness.verify.canonical, the 18 self-checks
    test-hooks.mjs             — hook regression tests
    check-docs-links.mjs       — docs integrity check, including payload duplication (ADR-0026)
    loader-templates.mjs       — single source of truth for generated consumer-repo content
    sync-loader-shims.mjs      — regenerates the FHF root plus E2E and Smoke consumer configuration
    check-loader-drift.mjs     — local gate: fails if a consumer repo's generated files drifted
docs/
    framework/harness-engineering.md  — control-plane reference (hook topology, agent roles, model config)
    adr/                              — architecture decision records for harness changes
    governance.md                     — when an ADR is required
```

## Consumer contract

The FHF root is the workspace root: a local aggregation folder holding every clone. It is the only
target that receives a full projection — `.claude/{hooks,agents,rules,skills}/`, the generated Claude
settings and `harness.config.json`, `.cursor/hooks.json`, `.cursor/rules/*.mdc`,
`.github/copilot-instructions.md`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, and the `.harness/` runtime
CLIs (`setup.mjs`, `verify.mjs`, `task-protocol.mjs`, `backend-task-runner.mjs`, the doctors). That
projection is local-only and is not committed. Sessions open here, for every lane.

A lane receives no `.claude/` — no config, no settings, no agents, rules, skills or hooks, and no
Cursor adapter (ADR-0032). `loadHarnessConfig()` walks up to the workspace projection and
`markerLane()` walks up for identity, which is why `.harness/lane.json` is the one file a lane must
keep. E2E and Smoke additionally commit `.harness/prepare-execution.mjs`,
`.harness/execution.example.json`, `<package>/.npmrc.example`, `.github/copilot-instructions.md`,
`GEMINI.md`, and the documentation overlays (`README.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`,
`docs/README.md`). `fhf-backend-automation` commits only `.harness/lane.json`; its pytest architecture
docs (e.g. `fhf-backend-automation/CLAUDE.md`) remain backend-owned and are not generated here. Only
runtime state such as `**/cypress/handoff/` and `.claude/hooks/.sweep-retries` remains ignored.
Sibling `.cursor/*` and `.github/*` files, plus optional `architecture/`, are consumer-owned and are not drift.

A standalone clone-ready consumer is the `--only-baseline` target (`FHF_BASELINE_TARGET`): it receives
the full root projection plus `README.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md` and `docs/README.md`,
so it works after cloning without this repository. The lanes are not that; they are folders inside a
workspace.

Regenerate with `node scripts/harness/sync-loader-shims.mjs`, then run `engineering.harness.verify.canonical` from this repo. The workspace root and a baseline clone run `node .harness/verify.mjs`; a lane has no verifier of its own. Generated adapters resolve hooks through `CLAUDE_PROJECT_DIR` / `CURSOR_PROJECT_DIR`; they must not embed a developer home path. Canonical scripts resolve the consumer root from `FHF_CONSUMER_ROOT`, then `paths.consumerRoot`; sync and drift retain `FHF_SYNC_TARGET_ROOT` as a more-specific compatibility override. Lane roots resolve from their `rootEnv`, then configured `paths.lanes.<lane>.root`. Local checkout locations belong in the ignored setup file or environment variables, never in committed policy.

## Configuration layers

`config/qa-control-plane.json` is the reviewed static policy. Generated projections are derived
from it and must be regenerated rather than hand-edited. A validated `FHF_HARNESS_OVERLAY` may
provide short-lived session selection or lower-budget changes; it cannot widen permissions, change
hook or agent topology, disable data protections, or raise hard safety limits. Runtime loop state,
traces, and evidence are separate artifacts and never become policy automatically.

## Self-verification

`node scripts/harness/verify-canonical.mjs` runs every script in
`engineering.harness.verify.canonical` and exits non-zero on the first failing one (~30s).
`--list` prints the set without running it. Add a check by adding it to the control plane, not
to a second list here.

`.githooks/pre-commit` runs that same command. It is versioned so a fresh clone gets it; enable
it once per clone with `git config core.hooksPath .githooks`. The older `.git/hooks/pre-commit`
ran 4 of the 18 and existed on one machine only.

## Governance

Any change to hook topology, agent roster, or the skill-routing map requires an ADR in `docs/adr/` — see `docs/governance.md`.

## Centralized QA control plane

Use `docs/framework/qa-control-plane.md` for current-sprint intake, connected Atlassian context,
application-spec proposals, two Cypress lanes, and dashboard refreshes. Read-only discovery is
autonomous; Jira, Confluence, and application-spec writes require explicit single-use approval.
