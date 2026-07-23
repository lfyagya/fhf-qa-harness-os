# Session Rules — Errors, Escalation, Context

## Structured errors

Tool failures and agent handoffs use structured fields — never "Operation failed" or a silently empty result:

```json
{
  "isError": true,
  "errorCategory": "timeout | auth | not_found | validation | selector_stale | api_alias_mismatch | config_missing",
  "isRetryable": true,
  "context": { "attempted": "...", "file": "file:line", "suggestion": "..." }
}
```

**Access failure ≠ empty result.** DB/API unreachable → `isError: true` (the check was NOT performed). Checked and found nothing → `isError: false` with an empty array. Never return `[]` for a failed connection.

Retryable: `timeout`, `rate_limit`. Not retryable: `selector_stale` (re-explore first), `auth`, `not_found`, `config_missing`, `api_alias_mismatch`.

Valid escalation triggers: explicit human request, policy gap, business threshold exceeded, same failure 3×. Never escalate on tone or self-reported confidence.

## MCP tool/server connections

An MCP server (Cypress Cloud, Atlassian, Chrome, etc.) is reachable or it isn't — that's
orthogonal to which client surface the session is running in (Claude Code CLI, Claude Desktop,
claude.ai chat). The harness handles the connection; the client surface is not the user's problem
to route around.

- A dropped/unavailable MCP connection is `timeout`-class and retryable — retry per the
  contract above before reporting anything to the user.
- **The only MCP failure that should ever stop and ask the human for action is `auth`** — an
  expired or invalid token, because only the human can re-authenticate. Everything else (server
  restart, a transient network drop, a tool being registered in one client surface but not
  another) is the agent's job to absorb: retry, fall back to an equivalent tool/path, or degrade
  gracefully. `cypress-shipper`'s UI Coverage mode already does this — falls back to asking the
  user to describe the Cloud UI when the MCP is unavailable — that's the pattern to follow, not
  an exception to it.
- Never fabricate a result because a connection failed silently — an unreachable MCP server is
  `isError: true`, `errorCategory: "timeout"` (or `"auth"` if it's a real token failure), never a
  quietly empty result (same rule as DB/API access above).

## Context discipline

For any task spanning >10 tool calls, keep a scratchpad at `cypress/exploration/<flow>.md` and **re-read it after every compact event**.

When specific IDs/selectors/endpoints must survive the session, open with an immutable block and never summarize it:

```
## CASE FACTS (do not summarize — reference directly)
- Jira: SERV-####
- Module / Spec / Key selectors / Key endpoints
```

In exploration reports, tag every selector/endpoint with its evidence source: `source:<path>` or `runtime:<step>`. Track pass/fail per module, not just aggregate — aggregates mask per-module failures.

## Work sequencing (multi-module tasks)

When a task spans multiple modules (e.g., "rebuild the docs for these 6 modules," "add smoke coverage for these 3 dashboards"), sequence by **actual business workflow/integration order** — how the modules relate in the real loan lifecycle — never by file count, size, or alphabet. State the proposed order up front before starting, so it can be corrected before work begins rather than after. Reference order for FHF: Funding → Post Funding → Document Repository → Custodian → Titles → UniFi Servicing → UniFi Collections → Loss Mitigation → Insurance → Ancillary → Checks → Complaints → Call Reports → Letters Tracking.

## Where standards live

A recurring correction or confirmed judgment call (a "feedback" memory) is a candidate rule, not a place to stop. Session/agent memory is per-assistant-instance and can be wiped or unavailable to a different session — it is not a substitute for the harness. Once a piece of feedback is confirmed as a standing rule (not a one-off), promote it into the checked-in harness: `.claude/rules/*.md` here in `fhf-harness-os` (then `sync-loader-shims.mjs`) for anything cross-repo/engine-level, or the relevant repo's `CLAUDE.md` for a repo-specific rule. Memory may still record *why* the rule exists and reference the canonical file — it should not be the only place the rule itself lives.

## Verifying subagent output

A subagent's final message describes what it intended to do, not necessarily what it did. Before treating a subagent's report as fact — especially citations (Cloud run numbers, doc paths, "user-approved scope" claims) or a "files touched" summary — independently verify: check the citation resolves, diff the actual files changed. Never relay a subagent's self-reported summary as a verified result without that check.
