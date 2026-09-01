# ADR-0022 — Allow Cypress TAP as a Vendored AI Toolkit Skill

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-30 |

## Context

FHF already vendors Cypress's AI Toolkit skills in `.claude/skills/` (`cypress-author`,
`cypress-explain`, `cypress-docs`). ADR-0004 and `block-forbidden-skills.mjs` keep
`cypress-author` off the allowlist so it cannot intercept FHF spec authoring.

Cypress now ships `cypress-tap`: a CLI plus skill that drives a live `cypress open` session
from the terminal so Cursor, Claude Code, Codex, Copilot, and Gemini can poll a real verdict
and read Command Log / DOM the same way the Cypress app does. Installing it with
`npx skills add` per agent would scatter copies under `.cursor/skills`, `.agents/skills`,
and similar, which would drift from the generated harness projection.

## Decision

- Vendor the official `cypress-tap` skill from `cypress-io/ai-toolkit` into
  `fhf-harness-os/.claude/skills/cypress-tap/` **unmodified** (same rule as ADR-0002/0004:
  do not inject FHF knowledge into Cypress's files).
- Add `cypress-tap` to `engineering.harness.skills` so every adapter that loads `.claude/skills`
  (Claude Code, Cursor) and every instruction overlay that points at `CLAUDE.md` / `AGENTS.md`
  (Codex, Copilot, Gemini) uses the same copy.
- Keep `cypress-author` vendored and **blocked**. TAP is verify/debug against an open session,
  not an authoring path. New specs still spawn `cypress-generator`.
- Do not add `cypress-cloud-cli` in this change. Cloud triage stays on the existing Cloud MCP /
  `cy-cloud` + `cypress-debugger` route.
- Do not run the third-party `skills` CLI into consumer repos. Regeneration remains
  `node scripts/harness/sync-loader-shims.mjs`.
- Parent agents stay in-process for TAP (no spawn). Spawn `cypress-debugger` when there is no
  attachable Chromium `cypress open` session, or when the work is a Cloud failure that needs
  Test Replay first.
- TAP requires Cypress **15.21.0+**, Chromium-family browsers, and an already-running
  `cypress open` session. Headless `cypress run` is out of scope. Smoke remains GET-only.

## Consequences

| Artifact | Change |
|---|---|
| `.claude/skills/cypress-tap/` | Official skill + references vendored |
| `config/qa-control-plane.json` | Allowlist + route hints |
| `.claude/rules/agent-spawning-gate.md` | TAP vs author vs debugger routing |
| Consumer `CLAUDE.md` / `AGENTS.md` | Same skill roster for every AI adapter |
| `block-forbidden-skills.mjs` | Unchanged; consumes the allowlist |

**What does NOT change:** agent roster, spawn budget, application-source read-only, smoke GET-only,
or `cypress-author` remaining forbidden.
