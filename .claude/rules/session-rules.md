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

## Memory lifecycle — archive closed project memories, don't accumulate forever

`MEMORY.md` truncates past 200 lines — an unbounded index silently loses its oldest entries with
no warning. `project` memories are the type that goes stale: a task finishes, a bug gets fixed, a
gap gets closed, and the memory recording it stops being actionable but stays indexed forever
unless someone prunes it.

A `project` memory is closed when its underlying task is fully resolved with no forward-looking
action left (confirmed against current state, not just recalled — same rule as "before
recommending from memory" below applies to closing one too). On confirming closure:

- If the resolution was promoted into a checked-in rule or repo doc (the "Where standards live"
  pattern above), move the memory file to `memory/archive/` and drop its `MEMORY.md` index line —
  the checked-in doc is now the durable record, keeping the memory file live is pure duplication.
- If it wasn't promoted anywhere (a one-off historical fact with no standing rule to point to),
  archive the file but leave one condensed index line pointing at it — don't delete institutional
  history, just get it out of the always-loaded index.
- Check for closable `project` memories opportunistically whenever `MEMORY.md` is touched for an
  unrelated reason, and always once it crosses ~150/200 lines (75% of the truncation limit) —
  don't wait for the cap to bite.
- `user`, `feedback`, and `reference` memories don't have a "task resolved" state — this policy
  only applies to `project` memories.

## Verifying subagent output

A subagent's final message describes what it intended to do, not necessarily what it did. Before treating a subagent's report as fact — especially citations (Cloud run numbers, doc paths, "user-approved scope" claims) or a "files touched" summary — independently verify: check the citation resolves, diff the actual files changed. Never relay a subagent's self-reported summary as a verified result without that check.

## Mechanical refactors need a mechanical proof, and gates need to be wired

Two failures found on the same day (2026-07-26) during a 69-site selector consolidation in the
smoke suite:

- **Prove behaviour-neutrality, don't assert it.** "I read the diff" does not cover a many-site
  refactor. Resolve the artefacts before and after and compare *values*: for Cypress configs,
  import every `*.ui.js` and diff every resolved string (3099 of them, that time). Zero drift is
  a claim someone else can re-run; a read-through is not. Build the comparison before the edit —
  if the refactor does change something, find out from the diff, not from production. The same
  applies to renames: resolve every import (including bare `import "./x"` side-effect imports —
  5 of 17 breaks hid there, in `e2e.js`, and would have silently unregistered whole command
  files at runtime). Keep the throwaway script in the scratchpad unless a second refactor needs it.
- **A check that runs nowhere is not a gate.** `check-duplicate-selectors.js` existed, passed,
  and was invoked by no CI step, no hook and no pretest — so the clean state it reported was
  unguarded. Any new static check gets wired into the lane's real CI (`buildspec.yml`
  `pre_build`, which is `on-failure: ABORT`) in the same change that adds it, and gets verified
  in both directions: passes clean, and fails on a deliberately injected violation.

Corollary for tooling you change: strengthening a checker can silently *narrow* it. Consolidating
values into `common.ui.js` removed them from that script's vocabulary, leaving it blindest for the
most-shared selectors. After editing a check, re-run the injected-violation test, not just the clean one.

## Absence claims — the same discipline applies to this agent's own words, not just subagents'

"No CI exists," "nothing implements X," "this file doesn't exist" are the highest-risk class of
claim this harness makes, because a negative is invisible to spot-check unless the search scope
is shown — a wrong positive claim gets caught the first time someone looks for the thing; a wrong
negative claim just sits there being believed. Real incident (2026-07-24): "no CI exists in
either repo" was asserted from one glob (`.github/workflows/` at the FHF root only), missing AWS
CodeBuild entirely; the correction was *itself* wrong for the same reason (missed the sub-repos'
own `.github/workflows/`) and directly contradicted `harness-engineering.md §3`, already quoted
earlier in the same session.

Before stating an absence as fact:
- Search from every plausible angle — naming convention, config format, subdirectory depth — not
  one glob pattern in one location. A CI claim needs every known CI config format checked
  (GitHub Actions, CodeBuild/`buildspec.yml`, CircleCI, Jenkins, GitLab CI, etc.), tree-wide, not
  root-scoped.
- State what was searched alongside the conclusion, not just the conclusion — "checked X, Y, Z,
  found nothing" is a claim that can be spot-checked; "nothing exists" alone cannot.
- Cross-check any new claim against sources already established in the same session before
  asserting it. If a doc was quoted three turns ago and the new claim contradicts it, that's a
  signal to re-read the doc, not to trust the new search over it.
- A claim backed by a shown, re-runnable command (grep output, test results) and a claim stated
  as prose with no attached verification are not the same confidence level — don't present them
  as if they were.
