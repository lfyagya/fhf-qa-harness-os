# ADR-0042 — Tool Vocabulary Belongs in the Control Plane

| Field | Value |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-09-22 |
| **Relates to** | ADR-0041 (ordering classes — this is the seam that ordering check runs on) |
| **Amends** | `engineering.harness.adapters`, `scripts/harness/loader-templates.mjs` |

## Context

The stated architecture is tool-neutral: `config/qa-control-plane.json` is the one policy, and every
tool-native file is a generated projection with no authority of its own. `harness-engineering.md`
says so, `CLAUDE.md` says so, and the runtime contract injected at session start says so.

Auditing the tree on 2026-09-22, three things contradict it. All three are in
`loader-templates.mjs`, and ADR-0041's new check made the first one load-bearing.

**1. Tool vocabulary is hardcoded in engine code.** The phase-to-tool mapping exists twice as
literals, once per vendor:

```js
const PHASE_MATCHERS = { preWrite: "Edit|Write", preShell: "Bash", preSubagent: "Task|Agent", … };
const cursorWriteMatcher = "Write|StrReplace|Edit|ApplyPatch|write|str_replace|apply_patch";
const cursorMatcher = { preWrite: cursorWriteMatcher, preShell: "Shell|Bash|shell|bash", … };
```

`engineering.harness.adapters` — the declared seam for exactly this — holds capability flags
(`promptRouting`, `hookCapability`, `compatibleHookDeduplication`) and Claude's permission strings,
but no tool names. So the answer to "which tool call does `preWrite` mean on tool X" is code, not
policy. Adding a sixth tool is a code change in a file whose header says it is the single source of
truth for generated content — which it is, for *content*, while quietly also owning *vocabulary*.

**2. The ordering invariant is proven against one vendor.** `hookChains()` — the function
`check-hook-order.mjs` grades — reads `PHASE_MATCHERS` only. Cursor's projection is built from a
different map, drops `preSubagent` from `preToolUse` entirely, and uses wider matchers
(`Read|Bash|read|bash`). Today the two produce the same per-tool class sequences, verified by hand.
That is a coincidence of parallel structure, not a property anything checks. Widen one Cursor
matcher — say `preSkill` to also match a shell alias — and Cursor's real execution order inverts
while the check stays green. A static check that validates the invariant on one of the two adapters
that actually enforce it is weaker than it reads.

**3. A lane carve-out is expressed as a branch in the ordering function.** `hookPhaseOrder()` opens
with `lane === "e2e" ? [] : ["preReadExceptE2e"]`. That E2E may read production artifacts is policy —
it lives next to `denyWriteByLane` in spirit — but it is written as control flow inside the function
whose single job is declaring order. The same fact is also why the phase is named
`preReadExceptE2e`: a lane name inside a phase key.

None of this is broken today. All of it is the shape that breaks the next time a tool is added, and
the next tool is the specific thing this repository exists to be ready for.

## Decision

Move tool vocabulary out of code and into `engineering.harness.adapters`, and make the ordering
check grade every adapter that enforces, not the first one.

Concretely: each adapter declares its own `toolMatchers` map keyed by the same phase names the
control plane already uses, plus which phases it can express at all. `loader-templates.mjs` keeps
owning *content* and stops owning *vocabulary*. `hookChains(lane, adapter)` takes the adapter, and
`check-hook-order.mjs` iterates every adapter whose `hookCapability` is enforcing.

The lane carve-out becomes data — `phases.preReadExceptE2e.excludeLanes: ["e2e"]` or equivalent —
read by `hookPhaseOrder()` rather than branched on inside it.

## Options Considered

### Option A — Adapter-declared tool matchers in the control plane (proposed)

| Dimension | Assessment |
|---|---|
| Complexity | Low. One config block per adapter, two functions take a parameter. |
| Cost | Half a day, plus regenerating and re-verifying every projection. |
| Scalability | A new tool is a config block and a capability declaration. No new code path. |
| Team familiarity | Same shape as every other control-plane migration here. |

**Pros:** restores the stated invariant; makes the ADR-0041 check as strong as it claims; a sixth
tool stops being a code change; the Cursor/Claude divergence becomes visible in review because both
maps sit side by side in one file.

**Cons:** the config grows a block that is genuinely vendor-specific — tool names are not neutral
facts. It centralizes vendor detail rather than eliminating it, which is honest but is not the same
as removing it.

### Option B — Leave vocabulary in code, add a Cursor case to the order check

| Dimension | Assessment |
|---|---|
| Complexity | Very low. Iterate two maps in the check. |
| Cost | An hour. |
| Scalability | Unchanged — the sixth tool is still a code change, now in two places. |
| Team familiarity | No new concept. |

**Pros:** closes the real hole (finding 2) for almost nothing, today. **Cons:** leaves findings 1 and
3; the "projections have no authority" claim stays false in a way that is now documented and
therefore load-bearing on trust.

### Option C — Derive matchers from a neutral capability model

Define an abstract tool algebra (`write`, `shell`, `spawn`, `load`, `read`) and have each adapter
declare a mapping from its own tool names into it.

| Dimension | Assessment |
|---|---|
| Complexity | High. A second vocabulary to keep correct. |
| Cost | Days, and every future vendor quirk has to be modelled. |
| Scalability | Best in theory. |
| Team familiarity | New abstraction with one owner. |

**Pros:** genuinely tool-neutral; the phase names stop leaking vendor concepts. **Cons:** this is an
interface with one real implementation and a half — Claude and Cursor. Two adapters do not justify
an algebra, and the phase keys already *are* the abstraction. Reach for this when a third enforcing
tool arrives and the mapping stops being one-to-one.

## Trade-off Analysis

The question behind this ADR — "same configuration and utilization across tools" — splits in two,
and the two halves have different honest answers.

**Same configuration: yes, and it is not there yet.** One policy, N projections is already the
design and is right. Options A and B differ only in how much of the remaining leak they close. A
closes it.

**Same utilization: no, and claiming otherwise would be a false green.** Claude Code and Cursor have
a hook surface, so policy becomes refusal. Codex, Copilot, and Gemini have instruction files, so the
same policy becomes prose a model may ignore. That asymmetry is a property of the tools, not a gap in
this harness, and `harness-engineering.md` already records it honestly per adapter. Flattening it —
projecting a hook shape into a tool that has no hooks, or reporting an instruction overlay as
enforcement — would be the fallback-marker-as-coverage failure this harness rejects everywhere else.

The correct ceiling is: **policy is uniform, projection is capability-graded, and the grade is
declared.** Option A is that sentence made executable. It is worth doing now rather than at the next
tool, because ADR-0041 just made a static check depend on the weakest part of the seam.

## Consequences

**Easier:** adding a tool; reviewing vendor divergence (one file, side by side); trusting
`check-hook-order.mjs`, which currently proves less than a reader assumes.

**Harder:** the control plane grows vendor-specific strings, and someone must resist the pull toward
Option C's algebra while there are only two enforcing adapters.

**To revisit:** when a third enforcing tool lands, re-ask whether the phase keys still map one-to-one.
If they do not, Option C stops being speculative.

## Action Items

1. [ ] Add `toolMatchers` and enforceable-phase declarations per adapter under
       `engineering.harness.adapters` (owner opt-in; control plane is gate-sealed).
2. [ ] `hookChains(lane, adapter)`; `check-hook-order.mjs` iterates every enforcing adapter.
3. [ ] Move the E2E carve-out out of `hookPhaseOrder()` into declared data.
4. [ ] Regenerate projections, run `verify-canonical.mjs`, confirm byte-identical output for
       Claude and Cursor — this refactor must change no generated file.
5. [ ] Record in `harness-engineering.md` that vocabulary is adapter-declared, alongside the existing
       capability table.

Step 4 is the test that matters: if the output changes, the migration was not a refactor.
