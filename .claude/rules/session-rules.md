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

## Context discipline

For any task spanning >10 tool calls, keep a scratchpad at `cypress/exploration/<flow>.md` and **re-read it after every compact event**.

When specific IDs/selectors/endpoints must survive the session, open with an immutable block and never summarize it:

```
## CASE FACTS (do not summarize — reference directly)
- Jira: SERV-####
- Module / Spec / Key selectors / Key endpoints
```

In exploration reports, tag every selector/endpoint with its evidence source: `source:<path>` or `runtime:<step>`. Track pass/fail per module, not just aggregate — aggregates mask per-module failures.
