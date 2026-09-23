---
name: twg
description: Teamwork Graph CLI overlay on the same Atlassian path as Jira MCP. Use after capability-doctor teamwork-graph-cli is ready. Not a second ticket oracle.
---

# Teamwork Graph CLI

This is a harness skill, not a side install. It is the same Atlassian overlay as MCP teamworkGraph.

## Configure, then use

Do not assume twg is ready because this skill is allow-listed.

1. Discover: resolve `twg`, or `%LOCALAPPDATA%\\Programs\\twg\\bin\\twg.exe`, or `$HOME/.local/bin/twg`.
2. Install only if neither launcher exists. Follow `connectors.teamworkGraphCli.agentsMd`.
3. Authenticate with `twg setup` in a controlling terminal. Never paste a token into chat.
4. Probe: `twg doctor`, then `node .harness/capability-doctor.mjs --capability teamwork-graph-cli --subject <SERV-ID> --outcome <observed-outcome>`.
5. Use only after that capability is ready. Flip `optional.teamworkGraphCli` only after doctor is green.

Skip Bitbucket setup unless this task needs Bitbucket. FHF automation PRs are GitHub.

## Authority

- Ticket oracle: `jira-ticket-read` / Atlassian MCP `getJiraIssue`.
- CI freeze: Cypress Cloud.
- This skill: graph overlay. An empty graph is empty edges, not invented links.

If doctor is not ready, stay on Jira MCP and the task manifest.
