# Agent and Skill Router

Apply this to FHF QA automation work. fhf-backend-automation is a full harness sync consumer —
its `.claude/{hooks,agents,rules,skills}/` are generated from this harness, same as E2E and Smoke.
Pytest authoring and execution inside it stay task-scoped: writes and runs require an active,
validated `FHF_ACTIVE_TASK` manifest and remain within its selected paths — see
`.claude/rules/backend-automation.md`.

Read `.claude/harness.config.json`:

- `engineering.context.routes` owns task routing hints and each route's `invoke`.
- `engineering.harness.skills` owns allowed FHF skills.
- `engineering.harness.skillLanes` owns which lanes may invoke a routed skill.
- `engineering.harness.spawnBudget` and `engineering.harness.modelTiers` own spawn and model policy.
- `engineering.harness.skillInvocation` is parent policy (`route-or-explicit`): follow the matched route `invoke`; do not load an unmapped marketplace plugin. The skill hook enforces the allow-list and `skillLanes` only.
- engineering.harness.agents owns the Cypress and cross-layer agent roster.
- `engineering.harness.genericAgents` may start under the one sprint task. `general-purpose` and `explore` (Cursor aliases `generalPurpose` and `Explore`) are that set. The hook states the task file and selected paths and lets them start. Their writes and pytest stay inside that task. They do not replace `cypress-generator` or `qa-automation-generator`.
- `engineering.harness.forbiddenAgents` owns retired agent types. Those names stay blocked.

A prompt hint is advisory; quoted keywords or harness/meta discussion do not force a route.

Order:

1. Use the QA control plane inline for sprint, Atlassian, spec-proposal, or task-manifest work.
2. Use a configured skill for read-only explanation or official Cypress behavior.
3. Answer a lookup inline when at most three focused searches suffice.
4. Use one configured specialized agent for implementation, review, debugging, or shipping.
   `general-purpose` and `explore` may assist inside that same sprint task. They do not replace the specialist and they do not open a second task.
5. Route backend-only or combined Cypress plus API/Oracle generation to qa-automation-generator;
   route its failure/review phases to the corresponding cross-layer specialist.

`cypress-author` is allowlisted as Cypress-native **convention** input. On FHF work it must not Write or Edit specs; the parent still spawns `cypress-generator` for file writes and `cypress-gate` for review. Jira, Confluence, application-contract, and
evidence writes remain approval-gated. Never spawn a retired agent. A task-scoped subagent works inside the one sprint task.

`cypress-tap` is the Cypress AI Toolkit live-session driver. Stay in the parent and read `.claude/skills/cypress-tap/SKILL.md`; do not spawn a specialist for it. It requires Cypress 15.21+, a Chromium-family browser, and an already-running `cypress open` session. Prefer `--json`. Headless `cypress run` is out of scope. Smoke remains GET-only. New specs still spawn `cypress-generator`; `cypress-author` must not write those specs.
