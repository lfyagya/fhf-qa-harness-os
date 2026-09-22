# ADR-0038 — Prompt delivery and the repeat guard

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-22 |

## Context

ADR-0037 left two gaps. An identical retry was a sentence in the loop digest, so the next tool call was not compared with the last recorded output. Cursor `beforeSubmitPrompt` was unwired because that event cannot carry `additionalContext`. `docs/adr/0030-apply.mjs` still searched for the router text from before ADR-0037, so it was not safe to run.

## Decision

1. `repeat-tool-guard.mjs` runs before every tool call. The call is the tool name, the working directory, and the canonical input. When that signature equals the last recorded call, the hook exits 2 and prints the last recorded output. `PostToolUse` and `PostToolUseFailure` record the call and the output in `engineering.context.runtime.lastToolFile`. The loop digest includes that same output.
2. Cursor `beforeSubmitPrompt` runs the same `prompt-router.mjs` as Claude `UserPromptSubmit`. On that event the router returns `{ continue: true, user_message }` with the original prompt and the same route text. `engineering.harness.adapters.cursor.promptRouting` is `before-submit-prompt`. Session start still runs `session-context.mjs`.
3. `docs/adr/0030-apply.mjs` checks the current ADR-0030 policy, including `formatInvoke` and `formatBundleSlice`. `node docs/adr/0030-apply.mjs --check` is part of `check-docs-links.mjs`. It does not splice the old router and it does not serialize the control plane. A drift is fixed in the control plane under `FHF_ALLOW_HARNESS_EDIT=1`, then the check is run again.

## Consequences

A repeated tool call is refused and the previous output is the text the agent already has. The first call in a session has no record, so it proceeds and is recorded after it returns. Cursor and Claude deliver one router script through the field each host accepts. Docs verification runs the ADR-0030 check. Gate edits still require `FHF_ALLOW_HARNESS_EDIT=1`.
