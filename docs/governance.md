# Governance — When an ADR Is Required

Every change has one owner, and structural harness changes leave a short decision record.

## An ADR is required for

- Any change to **hook topology** — adding, removing, or reordering a hook in `.claude/hooks/` or `.claude/settings.json`
- Any change to the **agent roster** — adding, removing, or changing the tool grant / model pin of an agent in `.claude/agents/`
- Any change to the **skill-routing map** (`.claude/rules/agent-spawning-gate.md`) — adding a skill/agent trigger, changing routing priority, or removing a route

Not required for: adding a new skill file that doesn't change routing, fixing a bug in an existing hook's logic (the hook's *purpose* didn't change), or any change scoped entirely to a consumer repo's payload (Cypress specs, docs content).

## Process

1. Before making the change, write the ADR in `docs/adr/NNNN-short-title.md` using the template below.
2. Make the change.
3. Verify with `node scripts/harness/test-hooks.mjs` and `node scripts/harness/check-loader-drift.mjs` if the change touches hooks or generated consumer content.

No separate approval step — this is a solo-owned harness, not a team process. The ADR exists so a future session (yours or an agent's) can find out *why* a structural decision was made, not to add a review gate. This exception expires when another contributor receives write access, the harness becomes a shared CI/deployment dependency, or a product/security owner assumes responsibility for its policy. At that point, structural changes require review by a second maintainer or the designated owner before merge.

First real ADR, worth reading as a worked example: [`docs/adr/0001-harness-relocation.md`](adr/0001-harness-relocation.md) — records why the harness itself was pulled out into this repo.

## Template

```markdown
# ADR-NNNN — <Short Title>

| Field | Value |
|---|---|
| **Status** | Proposed | Accepted |
| **Date** | YYYY-MM-DD |

## Context

What prompted this change. What was wrong or missing with the prior state.

## Decision

What was changed.

## Consequences

What artifacts had to change as a result. What does NOT change (scope boundary).
```
