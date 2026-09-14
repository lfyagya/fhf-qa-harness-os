# ADR-0030 — Spawn Budget, Model Tiers, and Route-Mapped Invoke

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-15 |

## Context

Generated instructions (`AGENTS.md`, `qa-harness.md`) cited `engineering.harness.spawnBudget`
and `engineering.harness.modelTiers` as authoritative. Those keys did not exist on
`config/qa-control-plane.json`. Skill and plugin catalogs at user scope also appeared in the
session picker even when `block-forbidden-skills.mjs` would refuse them. The intended model
was already route-selected invocation (ADR-0022 for `cypress-tap`): call a skill or specialist
only when the matched route says so — not by loading a marketplace catalog every session.

ADR-0026 is engine/payload worktree separation. ADR-0029 is the open lane-scoped rule
projection proposal. This decision is 0030.

## Decision

- Add `engineering.harness.spawnBudget` and `engineering.harness.modelTiers` as reviewed
  static policy for the parent. Default tier is `standard`. Frontier is allowed only on
  `cloud-failure`, `test-failure`, and `test-flake`, and only after an explicit user request
  or a recorded insufficient standard diagnosis. These are not hook gates in this ADR.
- Add `engineering.harness.skillInvocation` with mode `route-or-explicit`. That mode is
  parent policy: follow the matched route's `invoke`, and do not load an unmapped marketplace
  plugin. The skill hook does not re-score the prompt.
- Give every `engineering.context.routes[]` entry an `invoke` object:
  `{ kind: agent|skill|parent, name?, prefer? }`. The router emits that mapping.
  Hints remain advisory prose; `invoke` is the machine map the parent should follow.
- Vendor five constrained skills (`hookify`, `ponytail-review`, `skill-creator`,
  `claude-md-improver`, `ralph-loop`), allow-list them, attach a route `invoke`, and restrict
  them with `skillLanes` to `root`. The skill hook enforces the allow-list and `skillLanes`.
  Priorities stay below generate / gate / debug / ship.
- Generate the FHF-root `AGENTS.md` from these fields so the roster cannot describe
  keys the control plane does not have.

## Consequences

| Artifact | Change |
|---|---|
| `config/qa-control-plane.json` | `spawnBudget`, `modelTiers`, `skillInvocation`, `skillLanes`, five skills, per-route `invoke` |
| `.claude/hooks/prompt-router.mjs` | Emit `[router] invoke: …` from the matched route |
| `.claude/hooks/block-forbidden-skills.mjs` | Allow-list, then `skillLanes` when set |
| `scripts/harness/loader-templates.mjs` | `parentAgents()` sourced from the new fields |
| `scripts/harness/sync-loader-shims.mjs` | Write FHF-root `AGENTS.md` |
| `scripts/harness/check-docs-links.mjs` | Require the new fields; `invoke.name` must be on the roster |
| `.claude/rules/agent-spawning-gate.md` | Cite the new keys and what actually gates |

**What the hook blocks:** a skill absent from `engineering.harness.skills`, or a `skillLanes`
skill invoked from a lane that is not listed. An allow-listed skill with no `skillLanes` can
still be invoked on an unrelated route; the parent is expected to follow `invoke`.

**What does NOT change:** Cypress and cross-layer agent roster, hook membership, forbidden agents,
loop ceilings, application-source read-only, overlay mutability (still cannot add skills or
raise spawn). No marketplace plugin is routed by install alone. Adding one later still requires
vendoring, an allow-list name, a route `invoke`, and an ADR.
