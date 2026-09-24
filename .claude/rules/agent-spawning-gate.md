# Agent and Skill Router

Apply this to FHF QA automation work. fhf-backend-automation is a full harness sync consumer —
its `.claude/{hooks,agents,rules,skills}/` are generated from this harness, same as E2E and Smoke.
Pytest authoring and execution inside it stay task-scoped: writes and runs belong to a task:
a quick task confirmed once by the owner (ADR-0044), or a named full task whose manifest selects
the paths (ADR-0043) — see
`.claude/rules/backend-automation.md`.

Read `.claude/harness.config.json`:

- `engineering.context.routes` owns task routing hints and each route's `invoke`.
- `engineering.harness.skills` owns allowed FHF skills.
- `engineering.harness.skillLanes` owns which lanes may invoke a routed skill.
- `engineering.harness.spawnBudget` and `engineering.harness.modelTiers` own spawn and model policy.
- `engineering.harness.skillInvocation` is parent policy (`route-or-explicit`): follow the matched route `invoke`; do not load an unmapped marketplace plugin. The skill hook enforces the allow-list and `skillLanes` only.
- engineering.harness.agents owns the Cypress and cross-layer agent roster.
- `engineering.harness.forbiddenAgents` owns blocked and retired agent types.

`general-purpose` and `explore` (Cursor aliases `generalPurpose` and `Explore`) may start. They stay inside the one active task from ADR-0043/0044: the hook states that scope and exits 0. Retired names in `forbiddenAgents` stay blocked. One specialist writer still applies (`cypress-generator` or `qa-automation-generator`). `cypress-gate` is on-demand (ADR-0052): spawn it when the change includes Cypress specs or Cypress config, or when the prompt names Cypress together with pre-merge. A generic “ready to merge” on engine, harness, or docs work stays in the parent — do not spawn it for a N/A verdict.

A prompt hint is advisory; quoted keywords or harness/meta discussion do not force a route.

Order:

1. Use the QA control plane inline for sprint, Atlassian, spec-proposal, or task-manifest work.
2. Use a configured skill for read-only explanation or official Cypress behavior.
3. Answer a lookup inline when at most three focused searches suffice.
4. Use one configured specialized agent for implementation, review, debugging, or shipping.
5. Route backend-only or combined Cypress plus API/Oracle generation to qa-automation-generator;
   route its failure/review phases to the corresponding cross-layer specialist.

`cypress-author` is allowlisted as Cypress-native **convention** input. On FHF work it must not Write or Edit specs; the parent still spawns `cypress-generator` for file writes and `cypress-gate` for review. Jira, Confluence, application-contract, and
evidence writes remain approval-gated. Never spawn an agent absent from the configured roster.

`cypress-tap` is the Cypress AI Toolkit live-session driver. Stay in the parent and read `.claude/skills/cypress-tap/SKILL.md`; do not spawn a specialist for it. It requires Cypress 15.21+, a Chromium-family browser, and an already-running `cypress open` session. Prefer `--json`. Headless `cypress run` is out of scope. Smoke remains GET-only. New specs still spawn `cypress-generator`; `cypress-author` must not write those specs.
