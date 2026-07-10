# ADR-0003 — Agent Roster Consolidation: 13 Agents + 14 Commands → 4 Agents + 0 Commands

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-07-10 |

## Context

The roster had grown to 13 agents and 14 slash-commands, each individually justified by a
distinct trigger or use case (confirmed by a full-content audit earlier the same day — see
`docs/adr/0002-roster-deduplication.md` for the prior, smaller cut). But "each one is
individually justified" is not the same test as "this is the smallest set that does the job."
The owner (a solo QA engineer) reported the roster itself had become the problem: too many
names to remember, too many hand-off points to route between, no longer legible as "what does
this harness actually do." A routing table with 13 agent rows and 14 command rows is scaffolding
for a large team's division of labor, not for one person directing one model.

Two failure modes were live in the 13/14 roster:
- Genuine redundancy the earlier audit missed structurally: several agents/commands were
  separate *files* for what was really one *phase* of work with several internal steps (e.g.
  `qa-ticket-router` classifying a ticket, `jira-to-cypress` turning it into scenarios,
  `scenario-approval-gate` presenting them for sign-off, and `cypress-explorer` gathering
  selector evidence are four files for one linear job: "turn a request into a spec draft.")
- Domain knowledge worth keeping (S1–S8 failure taxonomy, the schema/state-contract assertion
  templates, the UI-coverage bucket classification, the risk-score formula) was real and not to
  be deleted — but it doesn't need its own agent identity to survive; it can live as a section
  inside the agent that actually uses it.

## Decision

Collapse to **4 agents**, one per irreducible phase of the harness's actual job (generate a
test → gate it → diagnose failures → ship and account for the work), and **0 commands** — all
command content folded into the agent that owns that phase, or into `.claude/rules/` when the
content was a cross-cutting reference table rather than a workflow.

| New agent | Phase | Absorbs (old agents) | Absorbs (old commands) |
|---|---|---|---|
| `cypress-generator` | GATHER → AUTHOR → BUILD | `cypress-e2e-automation`, `cypress-test-automation`, `cypress-explorer`, `qa-ticket-router`, `test-design-reviewer` (design-review-as-a-step) | `jira-to-cypress`, `scenario-approval-gate`, `po-coverage-review`, `detect-duplication`, `cy-prompt-workflow`, `cypress-studio-scoring`, `cypress-command-first-migration`, `api-contract-baseline`, `state-contract-validator` |
| `cypress-gate` | REVIEW (evaluator; drives the fix loop) | `pre-merge-qa-gate`, `spec-generation-loop` (loop orchestration folds into the evaluator that already knows what's wrong) | `verification-loop` |
| `cypress-debugger` | EXECUTE → DIAGNOSE → FIX | `cypress-bug-hunter`, `cypress-cloud-investigator`, `cypress-performance-auditor`, `cypress-runner` | `ai-regression-testing` |
| `cypress-shipper` | SHIP + ACCOUNT | `pr-creator`, `cypress-ui-coverage-analyst` | `automation-roadmap-planner`, `qa-risk-matrix`, `api-documentation-generator` |

Role separation between generator and gate is preserved exactly (harness engineering's core
constraint: a generator must never grade its own output) — `cypress-gate` never edits files,
`cypress-generator` never issues a PASS/BLOCK verdict on its own work. The gate drives the
retry loop by re-invoking the generator via `Task` with concrete findings, which is why the
separate `spec-generation-loop` orchestrator agent is no longer needed: the evaluator already
has everything required to drive its own feedback loop.

## Consequences

- `.claude/agents/` now holds exactly 4 files; the other 13 are deleted, not archived — their
  content lives in the 4 survivors or in `.claude/rules/`, verified before deletion, not just
  assumed.
- `.claude/commands/` is deleted entirely (0 files). Any workflow that command encoded is now a
  named step inside the owning agent's instructions.
- `.claude/rules/agent-spawning-gate.md` rewritten: the routing table collapses from
  13+14 rows to 4, since there is no longer a skill tier to check before the agent tier.
- `.claude/hooks/prompt-router.mjs` and `.claude/hooks/block-generic-agents.mjs` updated: routing
  hints reference only the 4 new names; the forbidden list explicitly calls out the 13 retired
  names so a stale mental model (or a stale doc elsewhere) doesn't try to spawn one.
- `scripts/harness/loader-templates.mjs`, `sync-loader-shims.mjs`, `check-loader-drift.mjs`
  updated to drop `commands` from the generated `.claude/` subfolder list — consumer repos no
  longer get a `commands/` directory synced at all.
- Does NOT change: the 5 rules files (routing map aside, they're orthogonal to agent count), the
  13 hooks (mechanical gates keyed to file content, not to which agent wrote it), the 3 Cypress
  skills (not ours to touch — see `CLAUDE.md`).
- Does NOT change scope of what the harness can do — every distinct capability the 27 old
  files had is still reachable through the 4 new agents; what changed is how many names the
  owner has to route between to reach it.
