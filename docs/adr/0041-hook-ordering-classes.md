# ADR-0041 — Hook Ordering Classes

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-22 |
| **Relates to** | ADR-0038 (the deny seam — remedies make a refusal actionable; ordering decides which refusal arrives) |
| **Amends** | `engineering.harness.hooks` |

## Context

`engineering.harness.hooks` declares 26 hooks across 15 phases, and that declaration order is the
execution order generated into `settings.json`. Nothing anywhere states what the order should be, so
it is an artifact of the sequence in which hooks were added. Four consequences, listed in descending
order of how much of each was actually proven.

**Verified by probe.** In `preRead`, `context-read-guard.mjs` is declared ahead of
`protect-prod-data.mjs`. Both refuse a production artifact, but the first message wins. Probed with a
500-line file at `reports/mochaReports/`, which `PROD_ARTIFACT` matches:

```
context-read-guard.mjs       exit=2  BLOCKED: bound this Read to 120 lines or fewer...
protect-prod-data.mjs        exit=2  BLOCKED: .../reports/mochaReports/probe.json
```

The reader is told to add `limit: 120` to a file holding live production customer data that they must
not open at all. They comply, retry, and only then learn the real reason. An ergonomic nag is
standing in front of the hook whose own header records that a failure screenshot was opened during
triage with real customer data in it.

**Declaration order confirmed, consequence reasoned.** In `preWrite`,
`protect-second-brain-boundary.mjs` is fifth, behind `protect-automation-scope.mjs` and
`enforce-task-gates.mjs`. It refuses unconditionally on a path pattern; those two refuse only when a
task is active. A wiki-scaffolding write inside an automation lane would therefore be told to point
`FHF_ACTIVE_TASK` at a manifest, for a path that is forbidden whatever the manifest says. The case
was not constructed, and its reachability is narrow.

**Cost, not correctness.** `postWrite` runs `validate-cypress-rules.mjs` — 543 lines, 13 violation
paths, by far the largest hook — second of eight, ahead of `scenario-file-guard.mjs` at 36 lines that
may hold the actual problem.

**Cosmetic.** `stop` runs the advisory `session-end-reminder.mjs` before the blocking
`spec-sweep-stop-hook.mjs`.

None of these is a wrong verdict. Every hook involved returns the correct answer for the correct
reason. The defect is entirely in which correct answer arrives first, which is a category ADR-0038
does not reach: remedies make each refusal actionable, and ordering decides which refusal you get to
act on.

## Decision

1. **Every hook declares one ordering class.** Five, in precedence order:

   | Class | Means | Examples |
   |---|---|---|
   | `boundary` | Refuses on path or data alone. True regardless of task state. | `protect-harness-governance`, `protect-app-source`, `protect-prod-data`, `protect-second-brain-boundary` |
   | `scope` | Refuses because of the active task — or its absence. | `protect-automation-scope`, `enforce-task-gates`, `manual-task-guard` |
   | `roster` | Refuses an agent or skill that is not configured. | `block-generic-agents`, `block-forbidden-skills` |
   | `content` | Refuses what was written, having read it. | `validate-cypress-rules`, `scenario-content-guard`, `validate-spec-linkage` |
   | `ergonomic` | Advises, or refuses for the session's own comfort. | `context-read-guard`, `sync-reminder`, `session-end-reminder` |

   The ordering follows from what a blocked person can act on. A `boundary` refusal is true no matter
   what they do next, so hearing it first is never wasted. An `ergonomic` refusal is the only one
   they can satisfy and still be wrong.

2. **Within a phase, a hook may not be declared ahead of a lower-class hook it shares a tool matcher
   with.** The matcher condition matters: `context-read-guard` (`Read`) and `protect-prod-data`
   (`Read|Bash`) overlap on `Read` and so are comparable, while two hooks on disjoint matchers never
   compete and their relative order is free. Constraining non-overlapping hooks would invent
   orderings nobody needs.

3. **`scripts/harness/check-hook-order.mjs` enforces it**, beside the existing self-tests in
   pre-commit, exit 1 naming the pair and the inversion. It must be observed failing before this is
   marked Accepted, and the `preRead` case above is the test: with the current order the check fails;
   with `protect-prod-data` moved ahead of `context-read-guard` it passes.

   No ratchet. There are four inversions across 26 hooks, not twenty-one, so this lands at zero
   rather than as a debt ledger — unlike `check-deny-remedies.mjs`, which needed one.

4. **The four inversions are corrected in the same change.** A check that ships red teaches people to
   ignore it.

## Why this is a check and not a hook

The `hookify` route asks for a hook, and a hook is the wrong instrument here. Ordering is a static
property of a generated file, and a runtime hook cannot police the file that declares hooks —
`protect-harness-governance` already refuses writes to `settings.json` and to the control plane, which
is the enforcement that matters for tampering. What is missing is not a guard on the edit but a
statement of what correct looks like, checked mechanically. Static properties get static checks; this
is the same shape as `check-deny-remedies.mjs`, which is committed and green.

## Consequences

The order stops being an accident of insertion sequence. A new hook must state what kind of refusal
it is, which is a question its author has already answered implicitly by writing it.

The cost is one field per hook and one judgement call: a hook that refuses on two grounds — a path
boundary *and* task scope — has to pick the class matching its earliest refusal, and picking wrong
produces a correct-but-late message of exactly the kind this ADR exists to stop. That judgement is
not mechanical and the check cannot catch it.

This ADR does **not** decide:

- the `postWrite` cost ordering. Running the 543-line validator before six cheaper checks is a
  latency question, and all eight are `content` class, so the invariant here is silent on it. Whether
  `validate-cypress-rules.mjs` should be split is a separate question about that hook's shape;
- what any hook's class should be beyond the examples above. The table is illustrative; assigning all
  26 is part of implementing this, and each assignment is reviewable;
- anything about `PostToolUse` ordering guarantees in the client. This constrains what the harness
  *declares*, which is what the harness controls.

A hook can be correctly classed, correctly ordered, and still refuse for a bad reason. This checks the
sequence, not the verdicts.

## As accepted

All 26 hooks are classified in `engineering.harness.hookOrder.hooks`. The verified `preRead` case is
fixed by `hookPhaseOrder()` in `loader-templates.mjs`, which moves `preReadExceptE2e` ahead of the
other pre-tool phases and is the single order both the adapters and the check read. Three declared
lists were reordered to clear the remaining inversions, all of them the lesser cases graded above:

- `preWrite` — `protect-second-brain-boundary.mjs` (boundary) moves ahead of the two task-conditional
  scope guards;
- `postWrite` — `sync-reminder.mjs` (ergonomic) moves behind `validate-spec-linkage.mjs` (content);
- `stop` — `spec-sweep-stop-hook.mjs` (content) moves ahead of `session-end-reminder.mjs` (ergonomic).

No verdict changes: every hook in those three phases returns the same answer regardless of position,
and only `spec-sweep-stop-hook.mjs` writes state, which nothing reordered ahead of it reads.

The resulting per-tool class sequences are `boundary → scope → content → ergonomic` on Edit and
Write, `boundary → scope` on Bash, `boundary → ergonomic` on Read, and `content → ergonomic` on
Stop, for both the root and e2e projections. `check-hook-order.mjs` joins
`engineering.harness.verify.canonical` in the same change that makes it pass — a check that lands
red teaches people to ignore it, which is the failure mode this ADR is about.

The reader-facing class table is in
[`../framework/harness-engineering.md`](../framework/harness-engineering.md) under Hooks, agents,
and skills.
