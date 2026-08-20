# fhf-harness-os — QA Engineering Harness

This repo is the **harness**: the scaffolding that compensates for what a model can't do reliably on its own — deterministic hooks, role-separated agents (generator vs evaluator), skills, and the routing rules that tie them together. Full topology: `docs/framework/harness-engineering.md`.

It is not a QA test suite. It contains no Cypress specs, no application docs, no coverage data. Those are payload, and payload lives in the configured consumer workspace:

- `paths.consumerRoot` in `config/qa-control-plane.json` — QA docs, coverage evidence, and the automation backlog
- `paths.lanes.e2e.rootEnv` — the E2E lane root selected by local environment/setup
- `paths.lanes.smoke.rootEnv` — the Smoke lane root selected by local environment/setup

`fhf-backend-automation` is independently owned and is not a consumer of this harness. When it is
available, use it only for read-only API or Oracle evidence; never install, sync, edit, or write there.

## What lives here

```
.claude/
    hooks/      — the 15 deterministic gates (PreToolUse/PostToolUse/Stop/UserPromptSubmit)
    agents/     — 4 agents, one per harness phase: cypress-generator (build), cypress-gate
                  (evaluator), cypress-debugger (diagnose/fix), cypress-shipper (ship/report)
    rules/      — routing map, source map, session discipline, assertion precision
    skills/     — cypress-author, cypress-docs, cypress-explain (Cypress's own, not ours)
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

The FHF root is a local aggregation workspace. Its generated configuration is local-only. The E2E
and Smoke repositories are clone-ready consumers: commit their generated `.claude/{hooks,agents,rules,skills}/`,
`.claude/settings.json`, `.claude/harness.config.json`, `.cursor/hooks.json`,
`.github/copilot-instructions.md`, `GEMINI.md`, `.harness/`, and documentation overlays (`README.md`,
`ARCHITECTURE.md`, `CONTRIBUTING.md`, `docs/README.md`) so engineers can use the harness after cloning.
Smoke clones also commit the setup example and run `node .harness/setup.mjs`; the local
`.harness/workspace.local.json` remains ignored because it contains checkout paths. Only runtime state
such as `**/cypress/handoff/` and `.claude/hooks/.sweep-retries` remains ignored.
Sibling `.cursor/*` and `.github/*` files, plus optional `architecture/`, are consumer-owned and are not drift.

Regenerate with `node scripts/harness/sync-loader-shims.mjs`, then run `engineering.harness.verify.canonical` from this repo. Consumer clones run `node .harness/verify.mjs`. Generated adapters resolve hooks through `CLAUDE_PROJECT_DIR` / `CURSOR_PROJECT_DIR`; they must not embed a developer home path. Local checkout locations belong in the ignored setup file or environment variables, never in committed policy.

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
