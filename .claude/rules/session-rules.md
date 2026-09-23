# Session Rules

## Errors and escalation

Never turn failed access into an empty result. Use:

```json
{
  "isError": true,
  "errorCategory": "timeout | auth | not_found | validation | selector_stale | api_alias_mismatch | config_missing",
  "isRetryable": true,
  "context": { "attempted": "...", "file": "file:line", "suggestion": "..." }
}
```

Retry transient timeouts/rate limits. Re-map stale selectors. Escalate only for explicit human
request, a policy gap, a business threshold, or the limit in
`config/qa-control-plane.json` → `engineering.loops.sameFailureLimit`. Authentication requires
the owner; unavailable evidence remains unverified.

### Owner-action stop

A capability status carries `ownerAction` (`OWNER_ACTION_STATUSES` in
`.claude/hooks/lib/capability-control.mjs`). When it is true — `blocked-authentication`,
`blocked-authorization`, `access-request-required`, or `escalated` — stop the task at that
point and ask the owner. Do not retry the call, do not proceed on partial data, do not
switch to a fallback or a sanitized export on your own initiative, and never guess a
credential or a substitute subject.

Surface it as a single question with explicit options, not prose — the owner picks:

- authenticate now (they run the OAuth/login flow, then you re-probe and continue),
- supply the capability's declared `fallback` (for example a sanitized ticket export),
- proceed with that capability's evidence marked unverified, where the task allows it,
- stop the task.

The prompt router injects this as session context and exits 0. Do not fail-close the
Cursor turn: a blocked overlay with only Retry cannot collect authentication. Ask in
the turn, then call the client's Atlassian auth/login tool when the owner chooses
authenticate.

## Pre-human review (every task)

Before a manifest, scenarios, plan, or test-cases stamp: write `review.<gate>` comparing
`intentVsBuilt`, `scenarioRef`, planned `assertion`, and frozen source. MATCH only when
they agree. A source-proven `defect` notifies Dev before any Cypress or pytest run.
Accepted overlays, parked rows, and runtime-only claims are not bugs.

Report which capability, which subject, and the exact status; the harness prints the same
banner via `formatCapabilityStatus`. Only auth, authorization, an undeclared connector, or
an exhausted retry budget reaches the owner this way. A transient connector failure
(`unavailable`, `retry-required`) is yours to retry inside the budget and must not be
escalated as an authentication problem. The same split applies to any MCP connector that
is unreachable or unauthenticated, whether or not it has a capability entry.

## Context and evidence

- Apply `engineering.memory.sessionScope`.
- Read only the path selected by `engineering.context.routes`; do not preload documentation.
- Preserve every fact named by `engineering.memory.preserveExactly`. Never invent a missing fact.
- Verify absence with more than one search term/path when naming variation is plausible.
- Validate subagent summaries against the cited diff/source before acting.
- Mechanical changes require a mechanical check, and a gate must be wired into the real runtime.
- Never `cd` into a worktree or repository that has no `.harness/workspace.local.json`. Hooks resolve
  `process.cwd()`, so a shell parked there goes WORKSPACE BLOCKED and holds a directory lock that
  prevents removal. Inspect other checkouts with `git -C <path>`.
- That block is recoverable, not a dead session. The Bash and PowerShell tools share one working
  directory, but the guard intercepts Bash and Edit only, so `Set-Location <workspace-root>` through
  the PowerShell tool clears it for both. A plain `cd` back cannot: the guard rejects the command
  before it runs. Verified 2026-09-01.

For multi-module work, use loan-lifecycle order:
Funding → Post Funding → Document Repository → Custodian → Titles → UniFi Servicing → UniFi
Collections → Loss Mitigation → Insurance → Ancillary → Checks → Complaints → Call Reports.

## Documentation

Use `config/qa-control-plane.json` → `documentation.owners`. Update or delete the owner instead of
creating another report, then run `scripts/harness/check-docs-links.mjs`. Apply the Obsidian
boundary in `engineering.memory.obsidian`.
