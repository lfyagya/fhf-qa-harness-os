# ADR-0025 — Agent Loop Instrumentation and Memory

| Field | Value |
|---|---|
| **Status** | Accepted; items 1–4 implemented, item 5 deferred |
| **Date** | 2026-09-05 |

## Context

The harness is meant to orchestrate its agents as a loop: carry context in, observe, reason, act,
then loop with what the previous pass learned. Every mechanical part of that loop is already built
and none of it is a stub.

- **Context** — `.claude/hooks/session-context.mjs` (SessionStart) and `.claude/hooks/prompt-router.mjs`
  (UserPromptSubmit) read `readFreshHandoff` from `.claude/hooks/lib/memory-state.mjs` and extract
  facts with the seven `engineering.memory.factExtractors` (ticket ids, module/spec, selectors,
  endpoints, Oracle objects, TestRail ids, evidence paths).
- **Observe** — nine PreToolUse guards, seven PostToolUse guards, and `failure-loop-guard.mjs` on
  PostToolUseFailure.
- **Loop** — `scripts/harness/record-loop-event.mjs` writes `loop-state.json`
  (`fhf-harness/loop-state/v1`: `verdicts`, `failures`, `repairCycles`, `lastProgressAt`, `budgets`,
  `status`) and `loop-trace.jsonl` (`fhf-harness/trace/v1`), with redaction driven by
  `engineering.context.runtime.redactPatterns`. Budgets come from `engineering.loops`.
- **Memory** — `.claude/hooks/memory-checkpoint.mjs` merges a bounded checkpoint into
  `cypress/handoff/session-latest.json` without copying conversation text.
- **Evaluate** — `scripts/harness/eval-harness.mjs` derives route accuracy, judge calibration, and
  repair convergence from those traces, and is listed in `engineering.harness.verify.canonical`.

In the entire history of the harness, **one run has been recorded**. It is
`front-end-automation-smoke/cypress/handoff/loop-trace.jsonl`: five events under runId
`gate-smoke-repair-20260814-01`, dated 2026-08-14 — `loop_started` → `gate_verdict` BLOCK
(judgeScore 0.75, "3/4 mandatory checks passed") → `repair_started` → `repair_completed`
(`progress: true`, five artifacts) → `gate_verdict` BLOCK (0.75), terminating at
`status: escalated`. The paired `loop-state.json` records `repairCycles: 1`,
`verdicts: [BLOCK, BLOCK]`, `status: escalated`.

That run is not a defect. It is the loop working: a repair cycle made real changes, still did not
pass, and escalated instead of burning its remaining budget. The defect is that nothing has recorded
an event since, which has four separate causes.

1. **Six of the seven roster agents emit nothing.** `record-loop-event` appears in
   `.claude/agents/cypress-gate.md:184-218` and in no other agent file. `cypress-generator`,
   `cypress-debugger`, `cypress-shipper`, `qa-automation-generator`, `qa-automation-gate`, and
   `qa-automation-debugger` leave no trace, so a generator or debugger pass produces no observation
   the loop can use. One instrumented participant out of seven is indistinguishable from none.
2. **No agent reads `loop-state.json` before acting.** `readFreshHandoff` is consumed by
   `prompt-router.mjs`, `session-context.mjs`, and `spec-sweep-stop-hook.mjs`; the loop state itself
   is written and never read back. State that is written but not consulted is a log, not a loop —
   this is the arc that makes the difference between the two.
3. **Memory checkpoints only at the end.** `memory-checkpoint.mjs` runs on PreCompact and SessionEnd.
   Within a session, step N+1 can see step N only through the conversation, which is exactly what
   compaction removes — so the checkpoint fires after the within-session channel is already gone.
4. **The budgets are self-reported.** `engineering.loops.sameFailureLimit`, `gateRepairLimit`, and
   `specSweepLimit` are enforced by an agent counting its own cycles. `failure-loop-guard.mjs`
   observes tool failures on PostToolUseFailure, not gate verdicts, so nothing deterministic stops an
   agent that miscounts.

There is a fifth, narrower problem in the evaluator. `eval-harness.mjs:119` computes pass^2
reliability only at `repairOutcomes.length >= 2`, and `:121-122` treats zero recorded outcomes as
INFO rather than failure — both correct about small samples. But `:124` applies the
`minimumRepairConvergence` threshold of 0.8 at n ≥ 1. With the single escalated run above, the
canonical gate therefore fails on `repair convergence 0 is below 0.8`, where 0/1 carries a 95%
Wilson interval of 0.000–0.793 and supports no conclusion at all. The gate is currently unpassable
for a reason unrelated to harness quality, which is also a standing incentive to stop recording
traces.

## Decision

Close the three open arcs of the existing loop, and make the evaluator honest about sample size. Add
no new machinery.

1. **Every roster agent emits phase events under one shared `runId`.** The contract in
   `cypress-gate.md:184-218` is the template and is not re-specified: same `runId` discipline (taken
   from `FHF_HARNESS_OVERLAY.session.runId` when present, carried across cycles, never reused for a
   different job), same redaction rules, same `status` vocabulary. Each agent records a
   `<phase>_started` on entry and a `<phase>_completed` on exit, carrying `artifacts` and a boolean
   `progress`. Phases follow the roster: generation, debug, ship, and the cross-layer equivalents.

2. **Read-before-act becomes step one of every agent.** Before planning, an agent reads
   `loop-state.json` for the active `runId` and treats prior `verdicts`, `failures`, and
   `lastProgressAt` as inputs. An agent that finds a previous cycle must state what changed since,
   and must not repeat an action the state records as already attempted without effect — the
   identical-diff halt already specified for the gate generalises to every phase.

3. **The memory checkpoint moves to phase boundaries.** `mergeHandoff` is called on every
   `<phase>_completed`, with PreCompact and SessionEnd retained as a backstop rather than the only
   trigger. `engineering.memory.preserveExactly` and the fact extractors are unchanged; only the
   moment of capture changes, so facts survive compaction inside a long job.

4. **Convergence is gated on a minimum sample, not on n ≥ 1.** `engineering.context.evaluation.thresholds`
   gains a minimum-sample field. Below it, repair convergence reports as UNKNOWN and does not fail
   the canonical gate; at or above it, the existing 0.8 threshold applies unchanged. This follows
   ADR-0024's stance that an unknown must be stated rather than omitted or scored as a gap, and it
   aligns the threshold check with the pass^2 guard immediately above it.

5. **Enforcement stays self-reported in this decision.** Making the budgets deterministic requires a
   hook on subagent completion, which is a hook-topology change and a separate ADR. It is
   deliberately deferred until items 1–4 have produced enough real traces to show whether agents
   actually miscount — deciding it now would be designing an enforcement mechanism against one
   datapoint, which is the same error item 4 corrects in the evaluator.

## Consequences

Changes required:

- `.claude/agents/cypress-generator.md`, `cypress-debugger.md`, `cypress-shipper.md`,
  `qa-automation-generator.md`, `qa-automation-gate.md`, `qa-automation-debugger.md` — emit contract
  and read-before-act step. `cypress-gate.md` gains only the read-before-act step; its emit contract
  already exists and is the reference.
- `.claude/hooks/memory-checkpoint.mjs` and `.claude/hooks/lib/memory-state.mjs` — checkpoint at
  phase boundaries in addition to PreCompact/SessionEnd.
- `config/qa-control-plane.json` — minimum-sample field under
  `engineering.context.evaluation.thresholds`.
- `scripts/harness/eval-harness.mjs` — apply the minimum sample to the convergence check.
- `docs/framework/harness-engineering.md` — record the loop contract as topology, alongside the hook
  and agent tables.

Explicitly not changed:

- **Hook topology and the agent roster.** No hook is added, removed, or reordered; the roster stays
  at seven agents with the same tool grants and model pins. Item 5 is the deferred decision that
  would change topology.
- **The trace and state schemas.** `fhf-harness/loop-state/v1` and `fhf-harness/trace/v1` already
  carry every field these events need; new event `type` values are data within the existing schema,
  not a schema change.
- **Memory authority.** `engineering.memory.authority` stays working-tree config and generated
  evidence, `obsidian.writeBack` stays false, and runtime loop state still never becomes policy —
  ADR-0011's layering is untouched.
- **Redaction and evidence boundaries.** The recorder's redaction, the production-data guard, and the
  approval gates on Jira, Confluence, contract, and evidence writes all apply unchanged to events.
- **Lane boundaries.** Smoke stays GET-only, backend writes and pytest runs stay bound to a validated
  `FHF_ACTIVE_TASK`, and application source stays read-only.
