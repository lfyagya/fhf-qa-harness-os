# ADR-0037 — Checked context routing

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-22 |

## Context

Route selection was the first matching regex, and a quoted "Acceptance Criteria" outranked the task in front of the model. The product topology, the source bundles, and the cross-repository seam were three catalogs that a manifest could ignore: any expansion reason was accepted, and a repository past one hop was accepted. Loop state was a sentence telling the agent to open a file. Cursor's read guard dropped bounded reads because `limit` never arrived on the hook payload, so the correct document was refused. `git diff` on the control plane was refused as a write. Hook order let a scope refusal hide a later boundary refusal.

`config/qa-control-plane.json` stays the only policy. Claude and this Cursor agent already run the same `prompt-router.mjs` through UserPromptSubmit. Cursor's native `beforeSubmitPrompt` still cannot carry `additionalContext`. That vendor limit is not a second route table.

## Decision

1. The highest-priority match is a candidate. Every other match is named. Task intent decides when more than one route matches. Text inside `chat_selection` is not part of the match.
2. The router injects the candidate bundle's seeds, the only legal `expandBy` reasons, and the one topology hop from those seeds. A manifest is invalid when a reason is outside that list, when a reason is present but every selected repository is a seed, or when a selected repository is neither a seed nor that one hop.
3. One catalog, `productTopology`, is the center. Bundles and manifest slices are checked against it. The knowledge graph and the agent graph stay separate; they answer different questions. The seam remains the automation-to-automation binding and is not a second topology.
4. When a Jira ticket cannot be read, the turn uses those configured seeds and `moduleSpecPaths`. Ticket fields stay UNKNOWN. That is not a substitute ticket.
5. `prompt-router.mjs` and `session-context.mjs` read `engineering.context.runtime.stateFile` into the turn. A missing file is a first pass. An unreadable file, or a status of `blocked` or `escalated`, blocks the next write.
6. Reads of `engineering.context.readOutput.fullContextPaths` (`docs/framework/`, `docs/adr/`) are the correct context and are not line-capped. Every other file stays capped at `maxLines`. The route slice above is how the control plane enters the turn.
7. `git diff`, `status`, `log`, `show`, `blame`, `grep`, `ls-files`, and `rev-parse` may name a gate. `git checkout`, `apply`, and any piped command may not.
8. Hook phases run `boundary`, then `scope`, then `content`, then `ergonomic`. `engineering.harness.hookClasses` is the taxonomy `check-docs-links.mjs` enforces.

## Consequences

`validateTaskManifest` rejects the old free-text expansion reasons. Fixtures that named a reason without leaving the seed set now pass an empty list, and a real expansion must name an `expandBy` value. Owners still set `FHF_ALLOW_HARNESS_EDIT=1` to change a gate; this ADR does not let an agent set that for itself. Cursor-native `beforeSubmitPrompt` stays unwired until that event can carry the same `additionalContext` the router already emits.
