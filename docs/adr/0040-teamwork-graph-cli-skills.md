# ADR-0040 — Teamwork Graph CLI Skills Are First-Class and Configure-Then-Use

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-22 |
| **Extends** | ADR-0022 (allow-listing a skill is an ADR decision), ADR-0034 (a shipped skill must be usable) |
| **Amends** | `engineering.harness.skills`, `engineering.harness.laneScope`, `engineering.context.routes` (`work-item-intake`), `connectors.teamworkGraphCli` |

## Context

The workspace already has Atlassian MCP graph tools and `jira-ticket-read`. Teamwork Graph CLI
(`twg`) is the same overlay, not a second ticket system. Without a roster decision the official
skills would sit outside `engineering.harness.skills`, so `block-forbidden-skills` would refuse
them the moment someone invoked them (ADR-0034). Treating them as a parallel ticket oracle would
also split intake: one path through Jira, another through `twg`.

Live graph on this site is weaker than Jira. Bitbucket examples in the official CLI docs do not
apply; this org's automation pull requests are GitHub. Listing the skills in the generated
projection is not the same as the binary being installed, authenticated, or doctor-green on a
machine.

## Decision

1. **Allow-list `twg`, `twg-jira`, and `twg-confluence`.** They ship under `.claude/skills/` and
   appear on `engineering.harness.skills` and the e2e, smoke, and backend lane skill lists. They
   are not a separate toolkit.

2. **Configure, then use.** `connectors.teamworkGraphCli` is optional (`required: false`,
   `configureThenUse: true`, `ticketOracle: false`). Each machine follows the official `agentsMd`,
   then `twg setup` and `twg doctor`. `capability-doctor teamwork-graph-cli` records ready,
   not-installed, authentication-required, authorization-required, skills-missing, or unavailable.
   Listing the skills does not make the capability ready.

3. **Jira remains the ticket oracle.** `queryOrder` is `jira-ticket-read`, then
   `atlassian-mcp-graph`, then `twg-cli`. Fallback is `jira-ticket-read`. The `work-item-intake`
   route stays `invoke.kind: parent`. It loads the TWG skills only after `capability-doctor
   teamwork-graph-cli` is ready. Cypress Cloud stays the CI freeze.

4. **Bitbucket setup is skippable.** This org publishes automation on GitHub.

## Consequences

| Artifact | Change |
|---|---|
| `.claude/skills/twg*` | Harness-owned SKILL.md files: configure-then-use, not a second oracle |
| `config/qa-control-plane.json` | Connector, capability, skill roster, laneScope, work-item-intake hint |
| `ONBOARDING.md` / workspace contract | Optional `teamworkGraphCli: false` |
| `block-forbidden-skills.mjs` | Unchanged; consumes the allow-list |

**What does NOT change:** agent roster, spawn budget, one-task-one-manifest (ADR-0039), Jira as
ticket oracle, Cypress Cloud as CI evidence, application-source read-only, smoke GET-only.
