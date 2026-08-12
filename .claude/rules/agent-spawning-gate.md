# Agent and Skill Router

Apply this to FHF Cypress work. When the cwd is `fhf-backend-automation`, stay in the parent and follow `docs/AGENT-GUIDE.md` — do not spawn Cypress agents.

Read `.claude/harness.config.json`:

- `engineering.context.routes` owns task routing hints.
- `engineering.harness.skills` owns allowed FHF skills.
- `engineering.harness.agents` owns the Cypress agent roster.
- `engineering.harness.forbiddenAgents` owns blocked and retired agent types.

A prompt hint is advisory; quoted keywords or harness/meta discussion do not force a route.

Order:

1. Use the QA control plane inline for sprint, Atlassian, spec-proposal, or cross-lane work.
2. Use a configured skill for read-only explanation or official Cypress behavior.
3. Answer a lookup inline when at most three focused searches suffice.
4. Use one configured specialized agent for implementation, review, debugging, or shipping.
5. Route Backend API/Oracle work to its independent pytest harness.

`cypress-author` is not the FHF authoring path. Jira, Confluence, application-contract, and
evidence writes remain approval-gated. Never spawn an agent absent from the configured roster.
