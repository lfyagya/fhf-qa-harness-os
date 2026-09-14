---
name: ralph-loop
description: "Bound a retry loop to engineering.loops. Use only when the user says ralph loop or ralph-loop. Stay in parent. Do not start an unbounded retry loop."
---

# Ralph loop (FHF-routed)

Stay in the parent. This skill is callable only from the `ralph-loop` route.

## Job

Turn the request into a bounded loop that already exists: `sameFailureLimit`,
`gateRepairLimit`, and `specSweepLimit` on `engineering.loops`. Name the phase
(generation, debug, ship, gate, sweep) and the terminal state
(`completed`, `blocked`, or `escalated`).

## Do not

- Start an unbounded retry that re-feeds the same prompt past those ceilings.
- Invent a fourth terminal state.
- Override `spawnBudget` or raise a loop limit from the overlay.

If the configured limit is hit, escalate to the owner with logs. That is the harness working.
