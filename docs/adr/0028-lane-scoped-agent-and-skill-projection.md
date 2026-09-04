# ADR-0028 — Lane-Scoped Agent and Skill Projection

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-05 |

## Context

`sync-loader-shims.mjs` copied `CLAUDE_SUBFOLDERS = ["hooks", "agents", "rules", "skills"]` wholesale
to every consumer. That was never decided; it fell out of ADR-0020 making `fhf-backend-automation` a
full sync consumer "on equal footing with the lanes", where equal footing was implemented as
identical.

The result is inert scaffolding in every consumer, in both directions:

- `fhf-backend-automation` — a pytest repository with no Cypress anywhere outside `.claude/` —
  received 26 Cypress files: the `cypress-generator`, `cypress-gate`, `cypress-debugger` and
  `cypress-shipper` agents, and the `cypress-author` and `cypress-tap` skills. None can act there.
  The Cypress half of a cross-layer task is written in the E2E repository, which has its own
  projection.
- The E2E and Smoke lanes received the pytest generators — `generate-api-client`,
  `generate-conftest`, `generate-data-builder`, `generate-test-file`, `setup-test-module`, `plan` —
  which have no pytest to generate into.

This is not cosmetic. `.claude/settings.json` already carries `skillListingMaxDescChars` and
`skillListingBudgetFraction`, so the skill listing is a budgeted resource, and every inert skill
spends it in every session of that lane. The harness-design guidance this roster was reviewed
against (ADR-0027) is explicit that pre-loading rarely-used instructions depletes attention budget,
and that scaffolding surviving past its purpose becomes dead weight. A `cypress-tap` skill offering
to drive a live Cypress session in a repository with no Cypress is worse than absent: it advertises
an action the model cannot perform.

## Decision

`engineering.harness.laneScope` declares, per lane, which agents and skills a consumer receives.

- `root` and `baseline` are `"all"` — the FHF workspace is an aggregation point and the baseline is
  the clone-ready superset. Neither is filtered.
- `e2e` and `smoke` receive the four Cypress agents, the three cross-layer `qa-automation-*` agents,
  the Cypress skills, their own lane generator, and `backend-test-author` (the `qa-automation-*`
  agents preload it).
- `backend` receives the three `qa-automation-*` agents, `backend-test-author`, the pytest
  generators, and — deliberately — `cypress-docs` and `cypress-explain`.

The two Cypress explainers stay in backend because they are read-only. A backend engineer triaging a
cross-layer failure needs to read and understand the Cypress side; that is exactly what those skills
do, and neither can write a spec. The authoring and driving skills, which can only act against a
Cypress checkout, do not.

Enforcement is in three places that must agree:

1. `copySubfolderSync()` in `sync-loader-shims.mjs` projects only the scoped entries, and prunes
   anything a lane previously received and no longer should.
2. `harnessConfigTextForLane()` filters `engineering.harness.agents`, `.skills` and
   `agentRuntime.preloadedSkills` in the projected `harness.config.json`. This must match the files
   on disk: `block-generic-agents.mjs` and `block-forbidden-skills.mjs` read those lists, so a
   roster naming an agent the lane never received would allow a spawn that then fails on a missing
   file.
3. `dirsMatch()` in `check-loader-drift.mjs` compares against the same scoped set. Without it every
   lane reports the other lanes' entries as missing.

## Consequences

`engineering.harness.verify.canonical` passes 18/18.

Backend goes from 7 agents and 14 skills to 3 and 9. E2E and Smoke drop the pytest generators. The
FHF root and the baseline are unchanged.

Adding a skill or agent now requires deciding which lanes receive it. A new entry absent from every
lane's list reaches only the root and the baseline, which is a quiet way to ship something nowhere —
the lane lists are the place to look when a skill does not appear in a consumer.

The split is by lane, not by capability: a skill is either in a lane's list or not. If a skill ever
needs to be present but restricted, that is a routing decision for
`.claude/rules/agent-spawning-gate.md`, not a projection one.

What does not change: hooks and rules still project in full to every consumer — a guard is only
useful if it is present everywhere it might fire — the agent definitions themselves, the routing
map, and ADR-0020's decision that backend is a full sync consumer. Equal footing now means the same
generation pipeline, not the same payload.
