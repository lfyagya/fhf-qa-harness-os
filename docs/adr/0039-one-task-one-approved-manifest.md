# ADR-0039 — Every Task Carries One Approved Manifest, Approved Manifest First

| Field | Value |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-09-21 |
| **Extends** | ADR-0036 (human gate stamps) |
| **Amends** | `engineering.taskProtocol.approval.gates`, `engineering.harness.boundaries.automationSource` |

## Context

The intended rule is one task, one manifest — frontend-only, backend-only or both — with ordered
human gates ahead of implementation. Two of those three properties do not hold today. Verified by
feeding each `PreToolUse` guard a real `Edit` payload with no `FHF_ACTIVE_TASK` set:

```
write target                 enforce-task-gates  protect-automation-scope  manual-task-guard
E2E Cypress spec             ALLOW               ALLOW                     ALLOW
Smoke Cypress spec           ALLOW               ALLOW                     ALLOW
backend pytest file          ALLOW               BLOCK(2)                  ALLOW
```

Only backend requires a manifest. An agent may write Cypress specs in either lane with no manifest,
no approval and no gate.

The cause is not a missing mechanism but a one-entry map.
`boundaries.automationSource.repositories` contains exactly `fhf-backend-automation`. The two
Cypress lanes are absent, so the `task-scoped-write-and-run` mode never applies to them.
`enforce-task-gates.mjs` is conditional by construction — its own header reads *"when a task is
active, block the next step until its current gate is stamped"* — so with no active task it allows
and there is nothing anywhere that requires a task to have a manifest at all.

Gate ordering is enforced, but not in the specified order. The declared sequence is:

```
spec -> scenarios -> plan -> test-cases -> evidence -> release
```

`firstPendingGate` walks that sequence and blocks the write on the first gate that is not `current`,
so with nothing stamped at stage `planned` the write blocks on `spec`. That much works. Three things
diverge from the intent:

- **Manifest approval is third, not first.** There is no manifest gate. The manifest's own
  substance — `ticketFamily`, `grounding`, `selection` — is bound to the **`plan`** gate, which sits
  after `scenarios`. Scenarios are therefore approved before the grounding they cite.
- **Out-of-order stamping is accepted.** `stampGate` validates `approvedBy` and `approvedAt` and
  nothing else. Stamping `plan` while `spec` and `scenarios` are unstamped succeeded:

  ```
  stamps landed  : plan
  plan gate state: current
  write blocks on: spec
  ```

  The write block held, so this is a record-keeping defect rather than a bypass — but the manifest
  can assert approvals that were never given in sequence.
- **`intake` and `grounded` require no gates.** Every gate's `requiredFrom` begins at `planned`. For
  backend this is independently covered by `writeStages`, which excludes both. For any path outside
  the `automationSource` map it is uncovered, which collapses into the first finding.

What is already sound is the approval *content* model: `humanOnly: true`, `agentMayApprove: false`,
`autoApproval: false`, digests over canonical JSON, `singleUse: true`, and nine `invalidateWhen`
triggers including `scenario-citation-changes` and `intent-vs-built-classification-changes`. An agent
cannot self-approve, and an approval does not survive the thing it approved changing. The gap is
coverage, not strength; hardening the model further buys nothing while having one stays optional.

## Decision

1. **Every automation lane is declared in `automationSource.repositories`.** The E2E and Smoke lanes
   join backend, so `task-scoped-write-and-run` covers all automation source. Using the runner ids
   and lane paths that already exist:

   | Lane | `pathPattern` root | `requiredRunner` | `allowedWriteRoots` |
   |---|---|---|---|
   | `front-end-automation-e2e` | `front-end-automation-e2e` | `frontend-e2e` | `CypressFHF/fhf-dashboards/cypress` |
   | `front-end-automation-smoke` | `front-end-automation-smoke` | `production-smoke` | `CypressFHF/fhf-dashboards/cypress` |

   Both carry `writeStages: ["planned", "approved", "implementing"]`, matching backend. This is what
   makes one task, one manifest structural rather than conventional: a write to any automation path
   requires an active manifest whose current gate is stamped.

   It also closes the `intake`/`grounded` hole without a separate rule, because neither stage appears
   in `writeStages`. No new mechanism is introduced — the third finding is a consequence of the
   first, and is repaired by repairing it.

   Application source remains `read-only` under its own boundary and is untouched. Smoke's GET-only
   content rule is enforced separately by the Cypress rule validators and is unaffected: this governs
   who may write a spec file, not what the spec may do.

2. **A `manifest` gate is declared first, and `plan` narrows.** The sequence becomes:

   ```
   manifest -> scenarios -> plan -> test-cases -> evidence -> release
   ```

   `manifest` binds the grounding fields `plan` currently carries — `ticketFamily`,
   `grounding.jira.issueDigest`, `grounding.acceptanceCriteriaDigest`, `grounding.catalogVersion`,
   `grounding.repositories`, `grounding.intentVsBuilt`, `selection` — with
   `requiredFrom: ["grounded", "planned", "approved", "implementing", "verified", "complete"]`.
   Requiring it from `grounded` is the point: grounding cannot be claimed complete and left
   unapproved.

   `plan` keeps only `plan.changeUnits`, `plan.impact`, `plan.executionBudget`. `spec` is absorbed —
   its two bound fields both move to `manifest`, and a separate gate over a subset of the same
   grounding produced two stamps for one decision.

   `plan` and `test-cases` stay separate gates rather than merging into one step. That is stricter
   than asked for and costs nothing, since ordering already blocks on the earlier of the two.

3. **`stampGate` refuses out-of-order approval.** Stamping a gate whose earlier required gates are
   not `current` throws, in the same shape as its existing `approvedBy`/`approvedAt` validation. The
   write path already enforces the order; this makes the record agree with it.

4. **`legacySingleDigestSatisfies: "plan"` is retained.** It satisfies the renamed-and-narrowed
   `plan` gate only, never `manifest`. A pre-existing single-digest approval must not be read as
   approval of grounding it never covered.

## Consequences

One task, one manifest becomes true rather than aspirational, and it is enforced by the same
mechanism in every lane rather than by remembering which lane is which.

The cost is real and falls hardest on small frontend work. Today a one-line selector fix in a
Cypress spec needs nothing; afterwards it needs a manifest and four human stamps before the edit is
permitted. For a lane that previously had no gate at all this is the entire tax of the decision, and
it is the tax that was asked for — a rule that exempts small changes is not "one task, one manifest".
Whether a lighter path should exist for changes that touch no assertion is a real question and is
**not** decided here; it needs evidence about how often that case occurs, and adding an exemption
now would reintroduce the optionality this ADR removes.

Absorbing `spec` into `manifest` invalidates existing `spec` stamps. Any in-flight task re-approves
at `manifest`. With `singleUse: true` and nine invalidation triggers already in force, stamps are
short-lived by design, so this is a one-time cost rather than a migration.

This ADR does **not** decide:

- the `deniedWritePatterns` and `allowedRunPrefixes` for the two Cypress lanes. Backend's list was
  derived from its real secrets and runners, and the Cypress equivalents need the same treatment
  against `cypress.env.json` and the lane `.npmrc` rather than being guessed here;
- whether `manual-task-guard` should also require a manifest. It allowed every probe above; whether
  that is correct depends on what it is for, which is a separate reading;
- any change to the approval digest algorithm, the stage machine, or `invalidateWhen`.

A gate that has not been observed failing has not been shown to work (ADR-0034). Each of the three
enforced changes needs that treatment before this is marked Accepted: a frontend write refused with
no manifest, a `manifest` stamp demanded before `scenarios`, and `stampGate` throwing on an
out-of-order stamp.
