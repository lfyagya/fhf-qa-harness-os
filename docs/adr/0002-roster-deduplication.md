# ADR-0002 — Roster Deduplication

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-07-10 |

## Context

An audit of the full roster (14 agents, 5 rules, 3 skills, 18 commands) found that Cypress itself ships three official skills — `cypress-author`, `cypress-explain`, `cypress-docs` (confirmed against `docs.cypress.io/app/tooling/ai-skills`) — which are exactly the three skills already present in `.claude/skills/`. Those are correctly untouched by this ADR; they're Cypress's own tooling, not something this repo built or duplicated.

Separately, reading every custom agent/command in full (not just its one-line description) found five cases where the same job was implemented twice under different names, each time as an independent copy of the same checklist rather than a shared reference:

1. `cypress-reviewer` (agent) and `cypress-architecture-review` (skill) both ran the same architecture/anti-pattern/security checklist as `pre-merge-qa-gate` (agent) and `/verification-loop` (skill) — four artifacts checking hard waits, hardcoded selectors, auth gates, PII/credentials, smoke write-ops, and bug-fix regression tests, all returning the same PASS/PASS_WITH_ACTIONS/BLOCK scale.
2. `cypress-debug-playbook` (skill) duplicated `cypress-bug-hunter` (agent) — same failure-classification taxonomy, same classify→trace→fix flow.
3. `cypress-performance-audit` (skill) duplicated `cypress-performance-auditor` (agent) — same detection patterns, same output tiers.
4. `cy-prompt-authoring` (skill) was a strict subset of `cy-prompt-workflow` (skill) — the same discovery-draft steps, with `cy-prompt-workflow` additionally automating what `cy-prompt-authoring` told the user to run manually afterward.
5. `cypress-studio-scoring` and `cy-prompt-workflow` both carried an identical copy of a 5-dimension scoring rubric.

## Decision

- Deleted `cypress-reviewer.md` (agent) and `cypress-architecture-review.md` (skill). Folded their two genuinely unique checks — the branch-baseline policy (E2E vs `dev`, smoke vs `staging`) and the session-state-pollution check — into `pre-merge-qa-gate.md`. Its Phase 2 also gained the shared-constant-duplication check from the deleted architecture-review skill.
- Deleted `cypress-debug-playbook.md`. Folded its regression-test trigger step into `cypress-bug-hunter.md`.
- Deleted `cypress-performance-audit.md` — `cypress-performance-auditor` already covered every pattern it checked, plus scope across both repos.
- Deleted `cy-prompt-authoring.md` — routed its trigger condition to `cy-prompt-workflow`.
- Extracted the shared 5-dimension scoring rubric out of `cypress-studio-scoring.md` and `cy-prompt-workflow.md` into `docs/framework/cypress-scoring-rubric.md`; both files now reference it instead of each carrying its own copy.
- Updated `.claude/rules/agent-spawning-gate.md`'s routing tables to remove the dead rows and merge trigger conditions into the surviving artifact.

## Consequences

| Artifact | Change |
|---|---|
| `.claude/agents/cypress-reviewer.md` | Deleted |
| `.claude/commands/cypress-architecture-review.md` | Deleted |
| `.claude/commands/cypress-debug-playbook.md` | Deleted |
| `.claude/commands/cypress-performance-audit.md` | Deleted |
| `.claude/commands/cy-prompt-authoring.md` | Deleted |
| `.claude/agents/pre-merge-qa-gate.md` | Gained Branch-Aware Review Policy, session-pollution check, shared-constant-duplication check |
| `.claude/agents/cypress-bug-hunter.md` | Gained regression-test trigger step |
| `docs/framework/cypress-scoring-rubric.md` | New — single source for the 5-dimension scoring rubric |
| `.claude/commands/cypress-studio-scoring.md`, `.claude/commands/cy-prompt-workflow.md` | Trimmed to reference the shared rubric instead of duplicating it |
| `.claude/rules/agent-spawning-gate.md` | Routing tables updated — dead skill/agent rows removed, trigger conditions merged |

**What does NOT change:**
- Cypress's own official skills (`cypress-author`, `cypress-explain`, `cypress-docs`) — untouched, they're not this repo's to modify
- The `qa-ticket-router` → `jira-to-cypress` → `scenario-approval-gate` → `po-coverage-review` pipeline — flagged during the audit as worth a second look (4 stages for a solo engineer) but not confirmed as duplicate, so left alone pending actual usage evidence
- `test-design-reviewer` vs `po-coverage-review` — confirmed during the audit to read from different systems of record (TestRail matrix vs Jira-AC-tagged scenarios); not a duplicate, not touched
