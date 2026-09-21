# ADR-0038 — Self-Repair Classes and the Deny Seam

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-21 |
| **Extends** | ADR-0027 (governance edits require an opt-in), ADR-0032 (single workspace config and lane markers) |
| **Pattern** | ADR-0034 (a shipped thing must be usable — the reverse-direction check) |

## Context

A blocked teammate has no mechanical way to get unblocked. Measured by running the hooks rather
than reading them:

```
top-level hooks: 26 | can block: 21 | name a runnable remedy: 4
```

The four are `prompt-router`, `validate-cypress-rules`, `protect-harness-governance` and
`protect-prod-data`. The remaining seventeen state what is refused and stop there.

The asymmetry is structural, not a matter of authors forgetting. The allow path has a shared seam;
the deny path does not:

```
     36 process.exit(2)
     28 emitAllow(
     10 emitEmpty(
      5 emitContext(
      1 emitStopFollowup(
```

`lib/hook-runtime.mjs` exports `emitAllow`, `emitEmpty`, `emitContext` and `emitStopFollowup`. There
is no `emitDeny`. Every refusal is hand-rolled around a bare `process.exit(2)`, so there has never
been a single place where a remedy could be required — which is exactly why four of twenty-one
carry one.

Repair policy in `qa-control-plane.json` covers only agent retry loops — `sameFailureLimit`,
`gateRepairLimit`, `specSweepLimit`. Nothing addresses the environment a teammate actually trips on.
The current stance on environmental repair is explicit rather than accidental;
`workspace-setup.mjs` prints:

```
Repair or remove that local file, then rerun node .harness/setup.mjs. No automatic repair was applied.
```

Three live instances, all found while auditing the control plane on 2026-09-21:

- The lane allow-list `root, e2e, or smoke` is hard-coded in three places across two files —
  `verify-projection.mjs:103`, `workspace-setup.mjs:21` and `workspace-setup.mjs:27`. Backend became
  a full sync consumer in `dcb5b86` and none were updated. The same stale constant survives in three
  places because nothing asserts they agree.
- A declared capability that blocks on authentication or authorization never shows its declared
  fallback. `decision()` sets `requiredInput: outcome`, no outcome object carries `fallback`, and
  the text lives at `capability.accessRequest.fallback` — reachable only from the undeclared-capability
  branch. Six of eight capabilities declare fallback text that cannot reach the owner.
- `capability-doctor.mjs` rejects an unknown `--outcome` without listing the valid ones, and
  `--help` prints only the usage line. The vocabulary exists in config and is not discoverable from
  the tool that requires it.

None of these are policy disagreements. In each case the correct value is already known to the
repository and simply is not applied or not surfaced.

## Decision

1. **Repair is split into two classes, and only one is ever automatic.**

   **Class A — deterministic reconstruction.** The correct content is derivable from a committed
   authority: the projection from the engine, `.npmrc` from the adjacent `.npmrc.example`,
   `lane.json` from sync, workspace paths from `setup.mjs`. These are a gate's *inputs*, not its
   verdicts, so reconstructing them cannot turn a red gate green.

   **Class B — verdicts and evidence.** Capability probe results, gate `PASS`/`BLOCK`, task
   manifests, prod-data consent. Never repaired automatically, by anything, under any flag. These
   are the reason the harness exists.

   For the generated projection, which is Class A by derivation but is itself the gate, automatic
   repair means **re-running sync from the engine and nothing else**. Editing
   `harness.config.json`, generated settings, or hook sources in place remains denied under
   ADR-0027. This ADR does not widen that opt-in; it forbids automatic repair from being the route
   around it.

2. **`lib/hook-runtime.mjs` gains `emitDeny({ reason, remedy })`.** The deny path gets the seam the
   allow path already has. `remedy` is required and must be one of three concrete things: a runnable
   command, an environment opt-in the owner can set, or the id of a declared owner-action capability
   whose prompt the owner answers. Prose advice is not a remedy.

3. **Every blocking top-level hook routes through it.** A bare `process.exit(2)` in
   `.claude/hooks/*.mjs` becomes a defect rather than a style choice.

4. **A check asserts it, in the reverse direction.** Following ADR-0034: for every top-level hook,
   no direct `process.exit(2)`, and every `emitDeny` call site supplies a non-empty `remedy`. The
   check must be observed failing — remove one `remedy`, confirm the check exits non-zero naming the
   hook, restore it, confirm it passes. A gate that has not been seen failing has not been shown to
   work.

## Consequences

A refusal becomes actionable. The seventeen hooks that today say only what is forbidden will name
the command, the opt-in, or the owner question that clears it, and that property is enforced at check
time rather than discovered by whoever is blocked.

The cost is one required argument per refusal. Adding a hook now means deciding how someone recovers
from it, which is work that was previously deferred onto the blocked teammate.

Class B stays manual, and that is the product rather than a gap. A capability probe, an active task
manifest and prod-data consent are decisions with an owner; making them self-clearing would remove
the only thing they contribute. What improves for Class B is discoverability — `capability-doctor`
listing its valid outcomes is a Class A fix to a Class B workflow.

This ADR decides the classification and the seam. It does **not** decide:

- the aggregate `doctor` entrypoint, or whether repair is applied at `SessionStart` — both depend on
  this seam and are separate proposals;
- what any individual hook's remedy should say, which is a review question per hook;
- the three live defects above. They are evidence that the seam is missing, and each is repaired on
  its own, not by this ADR.

A remedy can be present, enforced, and wrong. The check verifies that a recovery path was named, not
that it works.
