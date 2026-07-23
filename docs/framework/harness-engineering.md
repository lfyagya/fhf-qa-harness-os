# Harness Engineering — fhf-harness-os

> **Last verified:** 2026-07-23, Cursor root loaders and current `preToolUse` /
> `subagentStart` enforcement verified against the generated configuration; 2026-07-21,
> confirmed the `Workflow` tool bypasses `block-generic-agents.mjs`
> (§1 PreToolUse matcher is `Task` only, `Workflow` spawns agents through a separate mechanism) —
> documented as a self-applied gap in `.claude/rules/agent-spawning-gate.md`, not hook-closed;
> 2026-07-20, per-surface capability map added (§9) after auditing `.claude/settings.json` vs.
> `CURSOR_HOOKS` in `loader-templates.mjs` — found and fixed Cursor's stop-phase gate being
> silently absent; roster consolidated to 4 agents 2026-07-10
> (`docs/adr/0003-agent-roster-consolidation.md`) — against live `.claude/settings.json`,
> `.claude/hooks/*`, `.claude/agents/*`, `scripts/`
> **Owner:** QA Automation (Yagya)
> **Audience:** Framework architects, agent builders
> **This doc is the *control plane* — what is actually wired, and how to configure it.**

A harness is the scaffolding that compensates for what the model can't do reliably on its own.
This framework's harness has three layers: **deterministic hooks** (mechanical gates that can't be
talked out of), **role-separated agents** (generator vs evaluator), and **context/model
configuration**.

**Engine vs payload:** everything in this doc — `.claude/`, `scripts/harness/` — lives in this repo (`fhf-harness-os`). The QA-specific data these tools produce or act on (`docs/evidence/coverage-computed.md`, `cypress/handoff/`, `cypress/exploration/`, the actual Cypress specs) lives in the consumer repos (`FHF` and its two sub-repos) — see `CLAUDE.md` for the full split.

---

## 1. The control plane — hook topology

Hooks wired in `.claude/settings.json`, in execution order per lifecycle event:

### UserPromptSubmit (runs before Claude sees the prompt)

| Hook | Does |
|---|---|
| `prompt-router.mjs` | Single router: topic-drift check, duplication pre-check, and a task→skill/agent routing hint. Exits 0 with stdout — **stdout is added to Claude's context** (exit-1 stderr would only reach the terminal, which is why the three guards it replaced never worked). |

### PreToolUse (runs before a tool executes; exit 2 = block)

| Matcher | Hook | Enforces |
|---|---|---|
| `Edit\|Write` | `protect-app-source.mjs` | Blocks any write into the read-only frontend source (`fhf-dashboards`) |
| `Edit\|Write` | `protect-second-brain-boundary.mjs` | Blocks accidental `wiki/` or `.raw/` scaffolding outside the sibling `claude-obsidian` vault |
| `Edit\|Write` | `pre-validate-cypress-rules.mjs` | Pre-checks the edit against framework rules before it lands |
| `Bash` | `manual-task-guard.mjs` | Blocks manual/destructive shell steps that should go through a command |
| `Task` | `block-generic-agents.mjs` | Hard-blocks `Explore` and `general-purpose` subagent spawns (exit 2) |

> **Gap, confirmed 2026-07-21:** this matcher is `Task` only. The `Workflow` tool's internal
> `agent()` calls don't go through `Task`, so they bypass this hook entirely — a workflow script
> left on default `agentType` would reach an unapproved generic subagent with zero mechanical
> block, the same failure mode this hook exists to prevent. Not hook-closed; self-applied instead
> — see `.claude/rules/agent-spawning-gate.md`'s Workflow-tool section: every `agent()` call in a
> workflow script must pass an explicit `agentType` from the 4-agent roster.

### PostToolUse (runs after Edit/Write; exit 2 = violation fed back to Claude to fix)

| Order | Hook | Enforces |
|---|---|---|
| 1 | `validate-cypress-rules.mjs` | The core ruleset: no `cy.wait(number)`, no hardcoded selectors/routes, auth present, `testIsolation: true`, no mutations in smoke, `Object.freeze()` on configs |
| 2 | `scenario-file-guard.mjs` | Scenario files live in the right place / shape |
| 3 | `scenario-content-guard.mjs` | Scenario objects carry required fields (jiraId, route, assertions, apiWaits, auth) |
| 4 | `artifact-duplication-guard.mjs` | Blocks duplicate configs/commands (one owner per name) |
| 5 | `coverage-strategy-guard.mjs` | Keeps changes aligned to the coverage strategy/lanes |
| 6 | `sync-reminder.mjs` | Reminds to keep AGENTS.md / cross-system rules in sync (exit 0, informational) |

### Stop (runs when the turn tries to end; the verification gate)

| Order | Hook | Enforces |
|---|---|---|
| 1 | `session-end-reminder.mjs` | Git-state advisory |
| 2 | `spec-sweep-stop-hook.mjs` | **The gate.** Sweeps changed `.cy.js` files **in both sub-repos** (each has its own git root); `exit 2` if violations → Claude fixes → Stop fires again. **Retries up to 8 times before override.** Writes a handoff artifact only when specs were actually checked. |

> **Exit-code semantics (why this topology works):** UserPromptSubmit exit 0 stdout → added to context; Pre/PostToolUse/Stop exit 2 stderr → fed to Claude; exit 1 stderr → user's terminal only, invisible to Claude. Advisories must use exit-0 stdout; enforcement must use exit 2.

---

## 2. Agent topology — generator / evaluator / gate

The harness never lets a generator grade its own work. 4 agents cover every phase (collapsed
2026-07-10 from 13 agents + 14 commands — `docs/adr/0003-agent-roster-consolidation.md`):

| Role | Agent | Tools | Judgment |
|---|---|---|---|
| Generator | `cypress-generator` | Read, Write, Edit, Grep, Glob, Bash | confident — GATHER→AUTHOR→BUILD |
| Evaluator + Gate | `cypress-gate` | Task, Read, Grep, Glob, Bash | skeptical, final authority; drives its own retry loop with `cypress-generator` via `Task` — no separate orchestrator needed |
| Debugger | `cypress-debugger` | Read, Grep, Bash, Edit | root-cause → fix → regression test, same pass |
| Shipper | `cypress-shipper` | Bash, Read, Grep, Glob | PR is the default job; coverage/backlog/risk reports on request |

Full routing order (skills first, then ≤3-query lookup, then these 4): `.claude/rules/agent-spawning-gate.md`.

---

## 3. Verification loops (three tiers, by cost)

| Tier | Mechanism | When | Cost |
|---|---|---|---|
| Intra-session | `spec-sweep-stop-hook.mjs` (8-retry Stop gate, both sub-repos) | every turn end | free, automatic |
| Batch (interactive) | `cypress-gate`'s own self-repair loop — re-invokes `cypress-generator` via `Task` with concrete findings, max 3 cycles, then escalation | per module batch | metered |
| Pre-merge | `cypress-gate` (8-phase) | once, before PR | moderate |
| Headless / CI | `AG Frontend Automation/front-end-automation/scripts/auto-review-loop.mjs` (Agent SDK, driven by that repo's `auto-coverage-loop.yml` workflow) | bulk / overnight | metered API |

Both batch loops match the CLAUDE.md "same failure 3× → escalate to human" rule. Additional scheduled cloud routines are deliberately not wired yet — revisit once the base harness has been trusted for a while.

---

## 4. Model & effort configuration

Models are pinned **per agent** in `.claude/agents/*.md` frontmatter (`model: haiku|sonnet|opus`) — routing happens automatically when an agent is spawned. There is no session-level model pin and no manual switch-and-resend discipline.

**`settings.json` baseline:**
```jsonc
{
  "effortLevel": "high",
  "autoCompactEnabled": true,
  "autoCompactWindow": 70000
}
```

---

## 5. Context engineering

- **Docs tiers** (`FHF/docs/README.md` manifest): only `CLAUDE.md` + `.claude/rules/` auto-load. `FHF/docs/framework/` + `FHF/docs/modules/` are runtime (kept accurate) — `FHF/docs/framework/application-intelligence/` is the complete UI+API+DB application context (merged 2026-07-08 from the former `docs/backend-project-context/`, one location now); `FHF/docs/planning/` etc. are grep-on-demand reference; `FHF/docs/_archive/` is never read. Integrity is checked locally by this repo's `scripts/harness/check-docs-links.mjs`; no remote harness CI is configured.
- **Evidence ledger**: `FHF/docs/evidence/coverage-computed.md` (payload, consumer repo) is generated by this repo's `scripts/harness/generate-coverage.mjs` (scans both FHF sub-repos' cypress trees, 5-layer state + it() counts per module). Never hand-edit; regenerate after adding specs/configs. Authoritative over any hand-maintained coverage table. Local tool — not in CI (regeneration in CI would just churn diffs).
- **autoCompact** is on at **70 000 tokens** — don't wrap up early.
- **Handoff artifacts:** `spec-sweep-stop-hook.mjs` overwrites `cypress/handoff/session-latest.json` (in whichever consumer repo's specs changed) when changed specs were swept clean. Resume with `@cypress/handoff/session-latest.json`. The folder is gitignored.
- **Scratchpads** for >10-tool-call runs: `cypress/exploration/<module>.md` (in the consumer repo) with an immutable **CASE FACTS** block (never summarize it). Re-read after a compact.
- **Reset vs compact:** compaction shortens the same context; a reset starts fresh from a handoff file. Prefer resets between modules and after 3 failed debug attempts.

---

## 6. Structured errors & escalation

Per `.claude/rules/session-rules.md`: every tool failure returns structured fields (`isError`, `errorCategory`, `isRetryable`, `context`). An access failure is never collapsed into an empty result. Valid escalation triggers: policy/threshold/3-strikes — never tone or self-reported confidence.

---

## 7. Harness simplification cadence

Every component compensates for a current model gap. **Removing it is the discipline.**

| Component | Compensates for | Retire when |
|---|---|---|
| `validate-cypress-rules.mjs` | model writes hardcoded selectors | model uses config imports by default |
| `prompt-router.mjs` routing hints | model routes from prose tables unreliably | model picks the right skill/agent unprompted |
| `spec-sweep-stop-hook.mjs` (8-retry) | model ends with unfixed violations | self-verification is reliable |
| `block-generic-agents.mjs` | model reaches for generic agents | model picks specialized agents unprompted |
| `session-end-reminder.mjs` | no native turn-count awareness | model self-manages session length |

---

## 8. Best-config checklist for FHF

- [ ] Keep all 14 hooks wired (verified topology in §1) — they're defense-in-depth, not redundant.
- [ ] Hook regressions are caught by `scripts/harness/test-hooks.mjs`; run it with the drift check before delivery and extend it when adding a hook.
- [ ] Route any 2+ module batch through `cypress-gate`'s self-repair loop; never hand-review your own specs.
- [ ] On every model upgrade, run the §7 retire-one-component pass.

---

## 9. Per-surface capability map — what actually enforces itself, by tool

§1's hook topology is **Claude Code CLI infrastructure** — `PreToolUse`/`PostToolUse`/`Stop` are
Claude Code lifecycle events. Every other surface this team actually uses (confirmed 2026-07-20,
not speculative) reads the same instruction files but gets a different — usually smaller, in two
cases zero — slice of mechanical enforcement. Know which one you're in before assuming a
guardrail exists.

| Surface | What runs | What's missing vs. full CLI | Practical fallback |
|---|---|---|---|
| **Claude Code CLI** | All 14 hooks (§1), 4-agent Task-tool routing, MCP, skills, background tasks | — (this is the baseline) | — |
| **Cursor** | Root and lane `.cursor/hooks.json` files wire the same 14 scripts: prompt routing; three `preToolUse` write guards; shell guarding; `subagentStart` roster blocking; six post-write validators; and both stop hooks | Cursor event names and payloads differ from Claude Code, so shared hooks normalize `tool_input` / `input` and ApplyPatch payloads | Verify generated config plus one real event from each Cursor lifecycle family after topology changes |
| **GitHub Copilot** | `.github/copilot-instructions.md` only — text injected into context | No hook execution model at all; Copilot doesn't run project-defined shell hooks on tool use | Zero mechanical enforcement — the non-negotiables in that file are the entire guardrail; self-apply `CLAUDE.md` + `.claude/rules/*.md` by reading them |
| **ChatGPT / Codex CLI** | `AGENTS.md` only — text | Same as Copilot — no hook mechanism | Same fallback — read `AGENTS.md` + linked rule files before acting, nothing will catch a violation mechanically |
| **Claude Desktop** | MCP connectors (if configured), Projects (persistent custom instructions/knowledge), Artifacts | No `.claude/hooks/*` execution, no Task-tool subagent spawning, no auto-discovery of `CLAUDE.md`/`AGENTS.md` from a working directory the way CLI does | Attach `CLAUDE.md`/`AGENTS.md` as Project knowledge/custom instructions explicitly — Desktop won't find them on its own. Treat the 4-agent roster as reading material to self-apply (act *as* `cypress-generator` by following its file), not something Desktop can literally spawn |
| **Claude in Chrome** | Browser automation tools (`mcp__claude-in-chrome__*`) inside whichever Claude runtime it's attached to | Inherits the host runtime's enforcement (full if inside Claude Code CLI, none if standalone) — the extension itself adds no hook layer | Already scoped correctly elsewhere in this harness: `.claude/rules/source-map.md` — browser only for evidence gaps grep can't resolve, never as first resort |

**Takeaway:** Claude Code and Cursor have mechanical enforcement, but through different lifecycle
events and payload shapes. Copilot, Codex, Gemini, and standalone Claude surfaces remain
instruction-only. When a hook changes, update both generated configurations, payload regression
tests, and this table rather than assuming one surface's wiring applies to another.
