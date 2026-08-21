# Agent and Skill Router

Apply this to FHF QA automation work. fhf-backend-automation remains an independent repository
with local pytest rules; the centralized harness may author and run it only through an active,
task-scoped manifest. Never install or generate the centralized harness inside that repository.

Read `.claude/harness.config.json`:

- `engineering.context.routes` owns task routing hints.
- `engineering.harness.skills` owns allowed FHF skills.
- engineering.harness.agents owns the Cypress and cross-layer agent roster.
- `engineering.harness.forbiddenAgents` owns blocked and retired agent types.

A prompt hint is advisory; quoted keywords or harness/meta discussion do not force a route.

Order:

1. Use the QA control plane inline for sprint, Atlassian, spec-proposal, or task-manifest work.
2. Use a configured skill for read-only explanation or official Cypress behavior.
3. Answer a lookup inline when at most three focused searches suffice.
4. Use one configured specialized agent for implementation, review, debugging, or shipping.
5. Route backend-only or combined Cypress plus API/Oracle generation to qa-automation-generator;
   route its failure/review phases to the corresponding cross-layer specialist.

`cypress-author` is not the FHF authoring path. Jira, Confluence, application-contract, and
evidence writes remain approval-gated. Never spawn an agent absent from the configured roster.
