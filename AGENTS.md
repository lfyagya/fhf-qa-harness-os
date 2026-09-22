# fhf-harness-os — QA Engineering Harness

This file is the instruction entry for every tool. `CLAUDE.md` imports it. Rule text lives in `rules/`. `.claude/rules/` symlinks to those files. `.cursor/rules/*.mdc` and `.codex/hooks.json` are generated projections. The only hook list is `engineering.harness.hooks`.

This repo is the **harness**: the scaffolding that compensates for what a model can't do reliably on its own — deterministic hooks, role-separated agents (generator vs evaluator), skills, and the routing rules that tie them together. Full topology: `docs/framework/harness-engineering.md`.

It is not a QA test suite. It contains no Cypress specs, no application docs, no coverage data. Those are payload, and payload lives in the configured consumer workspace:

- `paths.consumerRoot` in `config/qa-control-plane.json` — QA docs, coverage evidence, and the automation backlog
- `paths.lanes.e2e.rootEnv` — the E2E lane root selected by local environment/setup
- `paths.lanes.smoke.rootEnv` — the Smoke lane root selected by local environment/setup

`fhf-backend-automation` is a full harness sync consumer, on equal footing with the E2E and Smoke
lanes: hooks, agents, rules, and skills are all generated from this harness, synced by the same
unflagged `sync-loader-shims.mjs` run and verified by the same unflagged `check-loader-drift.mjs`
run as the lanes; nothing is locally authoritative there anymore. Backend authoring and pytest
execution remain task-scoped: writes and runs require an active, validated `FHF_ACTIVE_TASK`
manifest and stay inside its selected paths in a non-production environment — see
`.claude/rules/agent-spawning-gate.md` and `.claude/rules/backend-automation.md`.

## What lives here

```
rules/          — rule text for every tool
.codex/hooks.json — generated projection of engineering.harness.hooks
.claude/
    hooks/      — the 24 deterministic gates, across SessionStart, UserPromptSubmit,
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
    rules/      — symlinks to `rules/`; routing map, source map, session discipline, assertion precision
    skills/     — cypress-author (vendored; FHF convention-only, no spec writes), cypress-docs, cypress-explain, cypress-tap (Cypress AI Toolkit; not ours), backend-test-author
scripts/harness/
    generate-coverage.mjs      — consent-gated scan; writes ignored runtime evidence into FHF/docs/evidence/
    qa-command-center.mjs      — sprint/spec intake plus portable JSON/Markdown/HTML dashboard
    eval-harness.mjs            — route, calibration, and trace-derived repair evaluation
    calibrate-gate.mjs          — imports machine verdicts and records explicit human labels
    record-loop-event.mjs       — redacted runtime loop state and trace recorder
    test-hooks.mjs             — hook regression tests
    check-docs-links.mjs       — docs integrity check
    loader-templates.mjs       — single source of truth for generated consumer-repo content
    sync-loader-shims.mjs      — regenerates the FHF root plus E2E and Smoke consumer configuration
    check-loader-drift.mjs     — local gate: fails if a consumer repo's generated files drifted
docs/
    framework/harness-engineering.md  — control-plane reference (hook topology, agent roles, model config)
    adr/                              — architecture decision records for harness changes
    governance.md                     — when an ADR is required
```

## Consumer contract

The FHF root is a local aggregation workspace. Its generated configuration is local-only. That
projection includes `AGENTS.md`, `rules/`, `.codex/hooks.json`, Claude settings, and Cursor hooks.
Lane repositories do not receive a second hook list. The E2E
and Smoke repositories are clone-ready consumers: commit their generated `.claude/{hooks,agents,rules,skills}/`,
`.claude/settings.json`, `.claude/harness.config.json`, `.cursor/hooks.json`,
`.github/copilot-instructions.md`, `GEMINI.md`, `.harness/`, and documentation overlays (`README.md`,
`ARCHITECTURE.md`, `CONTRIBUTING.md`, `docs/README.md`) so engineers can use the harness after cloning.
Smoke clones also commit the setup example and run `node .harness/setup.mjs`; the local
`.harness/workspace.local.json` remains ignored because it contains checkout paths. Only runtime state
such as `**/cypress/handoff/` and `.claude/hooks/.sweep-retries` remains ignored.
Sibling `.cursor/*` and `.github/*` files, plus optional `architecture/`, are consumer-owned and are not drift.

`fhf-backend-automation` is likewise a sync consumer: it commits its generated
`.claude/{hooks,agents,rules,skills}/`, `.claude/harness.config.json`, and `.claude/settings.json`.
Its pytest architecture docs (e.g. `fhf-backend-automation/CLAUDE.md`) remain backend-owned and are
not generated by this harness.

Regenerate with `node scripts/harness/sync-loader-shims.mjs`, then run `engineering.harness.verify.canonical` from this repo. Consumer clones run `node .harness/verify.mjs`. Generated adapters resolve hooks through `CLAUDE_PROJECT_DIR` / `CURSOR_PROJECT_DIR`; they must not embed a developer home path. Canonical scripts resolve the consumer root from `FHF_CONSUMER_ROOT`, then `paths.consumerRoot`; sync and drift retain `FHF_SYNC_TARGET_ROOT` as a more-specific compatibility override. Lane roots resolve from their `rootEnv`, then configured `paths.lanes.<lane>.root`. Local checkout locations belong in the ignored setup file or environment variables, never in committed policy.

## Configuration layers

`config/qa-control-plane.json` is the reviewed static policy. Generated projections are derived
from it and must be regenerated rather than hand-edited. A validated `FHF_HARNESS_OVERLAY` may
provide short-lived session selection or lower-budget changes; it cannot widen permissions, change
hook or agent topology, disable data protections, or raise hard safety limits. Runtime loop state,
traces, and evidence are separate artifacts and never become policy automatically.

## Governance

Any change to hook topology, agent roster, or the skill-routing map requires an ADR in `docs/adr/` — see `docs/governance.md`.

## Centralized QA control plane

Use `docs/framework/qa-control-plane.md` for current-sprint intake, connected Atlassian context,
application-spec proposals, two Cypress lanes, and dashboard refreshes. Read-only discovery is
autonomous; Jira, Confluence, and application-spec writes require explicit single-use approval.
