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

## Context and evidence

- Apply `engineering.memory.sessionScope`.
- Read only the path selected by `engineering.context.routes`; do not preload documentation.
- Preserve every fact named by `engineering.memory.preserveExactly`. Never invent a missing fact.
- Verify absence with more than one search term/path when naming variation is plausible.
- Validate subagent summaries against the cited diff/source before acting.
- Mechanical changes require a mechanical check, and a gate must be wired into the real runtime.
- Never `cd` into a worktree or repository that has no `.harness/workspace.local.json`. Hooks resolve
  `process.cwd()`, so a shell parked there stays WORKSPACE BLOCKED for the rest of the session and
  holds a directory lock that prevents removal. Inspect other checkouts with `git -C <path>`.

For multi-module work, use loan-lifecycle order:
Funding → Post Funding → Document Repository → Custodian → Titles → UniFi Servicing → UniFi
Collections → Loss Mitigation → Insurance → Ancillary → Checks → Complaints → Call Reports.

## Documentation

Use `config/qa-control-plane.json` → `documentation.owners`. Update or delete the owner instead of
creating another report, then run `scripts/harness/check-docs-links.mjs`. Apply the Obsidian
boundary in `engineering.memory.obsidian`.
