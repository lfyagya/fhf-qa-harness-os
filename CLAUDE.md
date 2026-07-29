# fhf-harness-os — QA Engineering Harness

This repo is the **harness**: the scaffolding that compensates for what a model can't do reliably on its own — deterministic hooks, role-separated agents (generator vs evaluator), skills, and the routing rules that tie them together. Full topology: `docs/framework/harness-engineering.md`.

It is not a QA test suite. It contains no Cypress specs, no application docs, no coverage data. Those are payload, and payload lives in consumer repos:

- `C:\Users\Leapfrog\FHF` — QA docs, coverage evidence, the automation backlog
- `C:\Users\Leapfrog\FHF\AG Frontend Automation\front-end-automation` — E2E lane
- `C:\Users\Leapfrog\FHF\ProdSmokeExecution\front-end-automation` — Smoke lane

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
    test-hooks.mjs             — hook regression tests
    check-docs-links.mjs       — docs integrity check
    loader-templates.mjs       — single source of truth for generated consumer-repo content
    sync-loader-shims.mjs      — regenerates every consumer repo's .claude/ + overlay docs
    check-loader-drift.mjs     — local gate: fails if a consumer repo's generated files drifted
docs/
    framework/harness-engineering.md  — control-plane reference (hook topology, agent roles, model config)
    adr/                              — architecture decision records for harness changes
    governance.md                     — when an ADR is required
```

## Consumer contract

The FHF root's `.claude/{hooks,agents,rules,skills}/`, `.claude/settings.json`, `.cursor/hooks.json`, `.github/copilot-instructions.md`, and `GEMINI.md` are generated. Lane repos receive settings plus Cursor, Copilot, Gemini, and documentation overlays. Regenerate with `node scripts/harness/sync-loader-shims.mjs` after any change here, then verify with `node scripts/harness/check-loader-drift.mjs`. Consumers hardcode absolute paths back to this repo (`C:/Users/Leapfrog/fhf-harness-os/.claude/hooks/*.mjs`) in their hook commands — this is a single-machine design, not a portable package; that tradeoff already existed before this repo split out and is unchanged by it.

## Governance

Any change to hook topology, agent roster, or the skill-routing map requires an ADR in `docs/adr/` — see `docs/governance.md`.

## Centralized QA control plane

Use `docs/framework/qa-control-plane.md` for current-sprint intake, connected Atlassian context,
application-spec proposals, three-lane evidence, and dashboard refreshes. Read-only discovery is
autonomous; Jira, Confluence, and application-spec writes require explicit single-use approval.
