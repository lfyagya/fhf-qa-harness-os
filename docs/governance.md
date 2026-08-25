# Governance — When an ADR Is Required

Every change has one owner, and structural harness changes leave a short decision record.

## An ADR is required for

Each trigger cites the records that established it, so the list can be checked against practice
rather than trusted.

- Any change to **hook topology** — adding, removing, or reordering a hook in `.claude/hooks/` or `.claude/settings.json`. Includes adding a guard: ADR-0007, ADR-0009
- Any change to the **agent roster** — adding, removing, or changing the tool grant / model pin of an agent in `.claude/agents/`: ADR-0002, ADR-0003
- Any change to the **skill-routing map** (`.claude/rules/agent-spawning-gate.md`) — adding a skill/agent trigger, changing routing priority, or removing a route, including neutralising a skill as an authoring path: ADR-0004
- Any change to **repository topology or placement** — relocating, externalising, or retiring a repository, control plane, or documentation payload, and deciding where a class of artefact lives: ADR-0001, ADR-0010, ADR-0012, ADR-0018, ADR-0020
- Any change to **control-plane structure or authority** — adding or removing a top-level section of `config/qa-control-plane.json`, or changing which source outranks another: ADR-0005, ADR-0011, ADR-0013, ADR-0015
- Any change to **boundaries, gates, or lane contracts** — what may be written, run, or approved, including execution topology, approval binding, task-protocol stages, and the architecture a lane’s tests must follow: ADR-0006, ADR-0008, ADR-0014, ADR-0016, ADR-0017
- Any change to an **external publication surface** — adding a Confluence, TestRail, or evidence-export target, or changing what may be written outward: ADR-0019

Not required for: adding a new skill file that does not change routing; fixing a bug in an existing
hook (its *purpose* did not change); declaring a repository record or a topology edge inside an
existing schema, with evidence — the schema was the decision and the record is data; or any change
scoped entirely to a consumer repository’s payload, such as Cypress specs or documentation content.

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
