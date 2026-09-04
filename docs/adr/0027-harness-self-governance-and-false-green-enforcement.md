# ADR-0027 — Harness Self-Governance and False-Green Enforcement

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-05 |

## Context

A review of external agent-harness engineering material — Anthropic's harness-design write-up for
long-running agents, the published account of agents Goodharting a test suite, and the
hook-lifecycle contracts published for Claude Code and Codex — was mapped against this harness.
Most of what it prescribes is already here: generation is separated from evaluation
(`cypress-generator`/`cypress-gate`, `qa-automation-generator`/`qa-automation-gate`), the evaluator
is calibrated with scored examples and kappa/rho thresholds rather than trusted, state crosses turns
through a structured handoff artefact, and `loops.sameFailureLimit` is 3 — matching the "3+ fix
loop" that write-up names as the signature of an agent weakening assertions until they pass.

Four things were missing. Three are gates; one is the ability to retire gates.

**Nothing protected the gates themselves.** Verified rather than assumed: feeding each of the four
`PreToolUse:Edit|Write` guards a payload targeting `config/qa-control-plane.json`,
`.claude/hooks/validate-cypress-rules.mjs` and `.claude/settings.json` returned allow from every
one. Every guard in `.claude/hooks/` constrained what an agent may do to the product; none
constrained what it may do to the guards. An agent that cannot pass a check could edit the check.
The two named failure modes are "silent threshold degradation" and agents that "discover loopholes
in their own governance", and the recommended countermeasure is to place enforcement rules where
the agent cannot modify them.

**`qualityAssurance.falseGreen` declared a policy that nothing enforced.** Four booleans —
`fallbackMarkersAccepted`, `disabledSuitesAccepted`, `stubbedMutationAsWorkflowAccepted`,
`structuralInventoryAsProductCoverageAccepted` — all `false`, and no hook checked any of them.
`cypress-rule-patterns.mjs` caught `cy.wait(number)` and nothing about whether a test asserts.
`.claude/rules/session-rules.md` already requires that "a gate must be wired into the real runtime".

**The subagent boundary was gated on entry only.** `SubagentStart` runs
`block-generic-agents.mjs`; `SubagentStop` was not wired at all, so nothing checked what a subagent
claimed on the way out. `session-rules.md` already says to validate subagent summaries against the
cited source, and a prior session recorded a real case of fabricated citations, but the rule was
advisory.

**No hook recorded the assumption it encodes.** The Anthropic material's central claim is that
"every component in a harness encodes an assumption about what the model can't do on its own, and
those assumptions are worth stress testing", and that scaffolding surviving past its assumption
becomes dead weight. This repository's own `CLAUDE.md` opens by paraphrasing that sentence. Three of
24 hooks carried a written rationale. Nothing could be retired, because nothing recorded why it was
added.

## Decision

1. **The deterministic gates are default-deny for agent writes.**
   `protect-harness-governance.mjs` runs on `PreToolUse:Edit|Write` and `PreToolUse:Bash`, ahead of
   the other write guards, and denies modification of `config/qa-control-plane.json`,
   `.claude/settings.json`, `.claude/harness.config.json` and `.claude/hooks/**`. The list lives at
   `engineering.harness.governance.protectedPaths` — inside a protected file, so narrowing the guard
   is itself a guarded edit. Opt-in is `FHF_ALLOW_HARNESS_EDIT=1`, the same owner-only environment
   mechanism as `protect-prod-data.mjs`: shell state does not persist between agent calls, so an
   agent cannot grant it to itself for an Edit or Write.

   Scope is the gates, not the prompt layer. `.claude/rules/**` and `.claude/agents/**` stay
   writable: they are text the model reads, they change as routine authoring, and their routing and
   roster changes are already ADR-gated by review. Protecting them would block ordinary work for no
   enforcement gain. Reading a protected file is always allowed — reporting a gate defect is the
   intended alternative to editing around it.

2. **The four `falseGreen` booleans are enforced.** `checkFalseGreen()` in
   `cypress-rule-patterns.mjs` rejects a spec whose `it()` blocks carry no assertion or fall below
   `qualityAssurance.falseGreenEnforcement.minimumAssertionsPerTest`, and rejects `.skip`, `xit`,
   `.only`, empty `catch` blocks, `cy.on('fail')` and `this.skip()`. It is called from `analyze()`
   in `validate-cypress-rules.mjs`, the post-write validator, and deliberately not from
   `pre-validate-cypress-rules.mjs`: assertion density is a whole-file property, and an Edit payload
   carries one fragment, so counting there would flag every single-line edit to a good spec.

3. **`SubagentStop` verifies that cited locations resolve.** `verify-subagent-citations.mjs` extracts
   `path:line` references from a subagent's completion text and blocks when the file does not exist
   or the line is past its end. A citation is only counted when the path carries a recognised source
   extension, so a timestamp, a ticket suffix or a host:port is not mistaken for one.

   This verifies existence, not correctness — a resolving citation can still be wrong. Spawn-budget
   and turn-count enforcement stay deferred exactly as ADR-0025 item 5 decided, and for its stated
   reason: those budgets need trace evidence before an enforcement threshold can be set, and
   building one now would be "designing an enforcement mechanism against one datapoint". Citation
   resolution needs no such evidence — an unresolvable path is wrong on its face, with no threshold
   to calibrate. Only that narrow case is un-deferred.

4. **A hook must record the assumption it encodes.** `check-docs-links.mjs` now requires every file
   in `.claude/hooks/` to carry a dated rationale naming the model limitation it compensates for.
   The 21 hooks that predate this are recorded in `.claude/hooks/rationale-baseline.json` and
   exempt. It is a ratchet: a hook absent from the baseline must be documented, and a baselined hook
   that gains a rationale must be removed from the list. The 21 were not backfilled — inventing a
   rationale for a hook whose real reason is unknown would put fiction where a future session looks
   for fact, which is worse than a visible gap.

## Consequences

`engineering.harness.verify.canonical` passes. 19 hook self-tests cover decision 1's file, shell,
override and consumer-projection paths and decision 3's resolve, past-end-of-file, false-positive
and unknown-payload paths; 5 cover decision 2.

Decision 2 immediately failed two existing test fixtures that asserted nothing while being treated
as clean specs. The fixtures were corrected, not the gate. That is the class of thing it exists to
find.

Harness maintenance now needs `FHF_ALLOW_HARNESS_EDIT=1` in the session environment. This is a real
cost and the guard is uniform across lanes, which is blunter than ideal: an agent writing specs in a
consumer lane has no business touching a gate, while the harness maintainer edits gates constantly.
Narrowing to a lane-scoped rule needs trace evidence about where blocked edits actually come from,
so it is not designed now — `protectedPaths` is the adjustment point until then.

`SubagentStop` is wired for Claude Code only. The Cursor adapter publishes no subagent-completion
event, so `test-adapter-contract.mjs` passes without one; that surface keeps the advisory rule.

What does not change: the agent roster, the routing map, every existing hook's behavior, the
generation/evaluation split, and ADR-0025's deferral of budget enforcement.
