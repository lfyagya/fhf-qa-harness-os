---
paths:
  - ".claude/agents/cypress-debugger.md"
  - ".claude/agents/cypress-shipper.md"
---
# Jira Integration — FirstHelp projects, Real Fields, Approval-Gated Writes

Grounded against the live `firsthelpfinancial.atlassian.net` instance (queried 2026-07-20) — not
invented. Re-verify against live Jira if these values are ever suspected stale; this file is a
reference, the Jira instance is the source of truth.

## Scope

Project **SERV** ("Services Team Scrum") is the services sprint this harness queries.
Task identity also accepts these FirstHelp projects, confirmed on `firsthelpfinancial.atlassian.net` on 2026-09-22:

- **GEARS** ("GEARS: SharedTech") — infrastructure
- **LOS** ("Loan Team Scrum") — LOS
- **SDX** ("Spark Dealer Experience") — Spark

There is no Jira project key `SPARK`. New LOS keys (`NLOS`, `NLOSF`, `NLOSI`, `NLCP`, `NLDX`) stay off this list until a task uses them. Issue types relevant to QA automation work: **Bug**, **Task**, **Sub-task**. The create-field recipes below were verified on SERV. Do not copy those screens onto GEARS, LOS, or SDX without checking that project.

## Write policy — explicit approval before every mutation

| Action | Policy | Why |
|---|---|---|
| **Create a ticket** (Bug/Task) | Prepare a draft, then require explicit approval | A wrongly-created ticket clutters a real, shared backlog other teams also triage |
| **Status transition** | Prepare the eligible transition, then require explicit approval | Even QA-owned transitions change a shared workflow |
| **Comment** | Prepare the exact comment, then require explicit approval | Append-only is still an external write |
| **Confluence update** | Prepare the page diff, then require explicit approval | Shared specifications must not drift from an unreviewed AI interpretation |
| **Application-spec edit** | Prepare the local diff, then require explicit approval | Jira/Confluence context is evidence, not automatically authoritative product truth |

Use the real MCP tools directly (`mcp__atlassian__createJiraIssue`,
`mcp__atlassian__transitionJiraIssue`, `mcp__atlassian__addCommentToJiraIssue`,
`mcp__atlassian__getTransitionsForJiraIssue`) — this file states the business rule (what/when),
not a restated copy of their parameter schemas; introspect those directly when calling.

Read-only Jira, Confluence, and Teamwork Graph calls do not need approval. For a proposed write,
show the exact target and payload, ask once immediately before execution, and treat that approval
as single-use. Approval for one comment, transition, page, or spec file does not authorize another.

## Creating a Task in SERV — real required fields

Cross-checked against the live "Create Task" UI (2026-07-20): `summary`, `description`, `project`,
`issuetype`, and **`Service App`** (same field as Bug, same `Callcenter` default — confirmed via
API `requiredFieldsOnly` check, Task carries none of the Bug-only fields below). Optional shared
fields: `Components`, `Priority`, `Labels`, `Module`, `Assignee` (general, defaults `Automatic` —
distinct from the Bug/Task-shared custom `QA Assignee`), `Parent` (links to an Epic/Initiative),
`Sprint`, `Story Points`, `Dev Time` (`customfield_10821` — real help text: "tracks the amount of
time a story has been in development, Cycle Time field"), `Estimate Hours` (`customfield_10854` —
real help text: "used as a custom field for original estimate" — this text belongs to Estimate
Hours, not Bug Category, despite rendering adjacent to it in the UI), `Dev Due Time`
(`customfield_10855`).

## Creating a Sub-task in SERV — real required fields

Verified via API `requiredFieldsOnly` check (2026-07-20): identical to Task's required set
(`summary`, `description`, `project`, `issuetype`, `Service App`/`Callcenter`) **plus `parent` is
required** — a Sub-task must always link to its parent ticket, unlike Task where `parent` is
optional.

## Creating a Bug in SERV — real required fields

| Field | Key | Required | Allowed values |
|---|---|---|---|
| Summary | `summary` | Yes | free text |
| Description | `description` | Yes | free text |
| Service App | `customfield_10043` | Yes | `Callcenter`, `Autoportal` |
| Severity - Serv/LOS | `customfield_10047` | Yes | `Show Stopper`, `High`, `Medium`, `Low` |
| Environment | `customfield_10048` | Yes | `Pre-Production`, `Production`, `DEV`, `QA`, `UAT` |

**`Service App` = `Callcenter` — confirmed default for all FHF Dashboards work (resolved
2026-07-20).** Verified against 100 real, most-recently-updated SERV Bug tickets: 99/100 use
`Callcenter`; every ticket carrying a `Module` value matching an FHF dashboard (`UniFi`,
`Ancillary Cancellation Dashboard`, `Titles - Release/General/Remarketing/Missing Titles/Re-Reg`,
`Custodian - Exception Queue/Dashboard`, `Letters`, `Docman - Loan Packages`, `Complaint`,
`LossMitigation - Assignment/Transport/Impound/Repo Invoices`, `Ancillary - Product/Verification/
Follow Up Dashboard`, `Agent Call Volume Dashboard`) used `Callcenter` — zero used `Autoportal`
for any dashboard module. `Autoportal` is a different application (dealer/customer self-service
portal) this harness never touches. Fill `Callcenter` automatically; no need to ask or restate it
per-ticket. Re-verify with a fresh JQL sample only if a future Bug genuinely doesn't belong to any
FHF dashboard module — that's outside this harness's scope in the first place.

Optional but relevant fields (fill when the information is known, don't fabricate a value to fill
a gap):

| Field | Key | Allowed values |
|---|---|---|
| Bug Areas | `customfield_10050` | `Frontend`, `Backend`, `Middleware`, `API`, `Deployment`, `Performance`. Real help text: "The location of the bug origination" |
| Bug Category | `customfield_10111` | **Corrected 2026-07-20 — full 15 values** (an earlier pass under-recorded this at 8 by truncating the API response): `Functional Issue`, `Logical Issue`, `Technical Issue`, `Design Issue`, `Data & Infrastructure Issue`, `API issue`, `Compatibility Issue`, `Performance Issue`, `Deployment Issue`, `Missed Requirements`, `Missed Implementation`, `Legacy Issue`, `Security Issue`, `Compliance Issue`, `Cognitive Issue`. Real help text: "Type of the bug" |
| Module | `customfield_10142` | 56 real values matching FHF dashboard names — e.g. `Complaint`, `Custodian - Dashboard`, `Titles - General`, `Insurance - Total Loss`, `LossMitigation - Impound`, `PostFunding`, `UniFi`. Pick the exact match for the module under test; if none matches, say so rather than picking the nearest-sounding one. Also present on Task (shared field) |
| QA Assignee | `customfield_10054` | user — use `lookupJiraAccountId` for the real reporter, don't guess an account ID. Distinct from the general `assignee` field (defaults `Automatic`) |
| Priority | `priority` | `High`, `Medium`, `Low` |
| Labels | `labels` | free text, not a fixed enum — Jira just surfaces frequently-used suggestions. Real ones observed: `QA`, `Automation`, `BE`, `FE`, `Carryover`, `Churn`, `Expedite`, `TSP`, `over-estimate` |
| Components | `components` | `Services Team Dependency`, `GEARS Dependency`, `Squad 1 (EL) Dependency`, `Squad 2 (LOS) Dependency`, `Squad 3 (OE) Dependency`, `Squad 4 (Integrations) Dependency`, `Squad 5 (Foundations) Dependency`, `Squad 6 (Contracts Prep) Dependency` — full list, 8 total, re-verified without truncation |
| Fix versions | `fixVersions` | **584+ values and growing** — real release tags per app component (`Dashboards_vX.Y.Z`, `Callcenter_vX.Y.Z`, `Database_vX.Y.Z`, `Letters_vX.Y`, `UIReporting_vX.Y.Z`, etc.). Too large and volatile to enumerate here — look up the current latest `Dashboards_v*` tag live rather than trusting any snapshot of this list |

**When to actually create one:** `cypress-debugger` may file a Bug when a `[BUG-NNN]` regression
test deterministically reproduces (its existing escalation rule already says this "raises real-bug
probability") — but only when the human explicitly asks it to file one, never as an automatic side
effect of the debugging pass itself.

## Status transitions — two distinct workflow schemes, don't conflate them

**Correction 2026-07-21:** the original "real workflow" list below was derived from a JQL sample
that mixed every issue type together — it actually captured a *different* scheme (Task/Story's),
not Bug's. Confirmed by the user posting the real "FHF Bug Workflow" diagram from Jira's workflow
editor. The two schemes share almost no status names in common; never assume a status list learned
from one issue type applies to another. Always resolve which scheme applies from the *ticket's own
issue type*, not from a general project-wide status list.

### Bug workflow (confirmed via the real workflow diagram, 2026-07-21 — authoritative)

```
Open → In Progress → Code Complete → Ready for Testing → In Testing ──┬─→ Fix Verified → Complete → Released
                                                                       └─→ Fix Failed → (back to In Progress)
In Testing → In Progress (direct escape hatch, no Fix Failed detour required)
Open → Not a Bug
Open ↔ Deffered
```

Live-verified: a ticket sitting at `In Testing` has exactly 3 available transitions —
`Fix Failed`, `Fix Verified`, `In Progress` — matching the diagram exactly.

**QA-owned for Bug (confirmed 2026-07-21 — narrowest option, deliberately excludes the
rejection path):** only `In Testing` → `Fix Verified` → `Complete`. The harness may propose these
two steps once tests genuinely pass, but must obtain approval before each transition and never
advance ahead of the real state.

**Never propose as a routine QA transition for Bug** (human decision or dev/release-management
territory): `Open` →
`In Progress`/`Not a Bug`/`Deffered`, `In Progress` → `Code Complete` → `Ready for Testing`,
`In Testing` → `Fix Failed` (rejecting a fix and sending it back is a human call, not a
mechanical one, even though QA is the one making it), `In Testing` → `In Progress` (the direct
escape hatch), `Complete` → `Released` (release management, not QA).

### Task/Story/other-issue-type workflow (confirmed via real workflow diagram, 2026-07-21 —
### authoritative, same standing as Bug's)

```
Open → Groomed ──┬─→ Ready for Dev → In Development ──┬─→ PR Review → Code Completed ─┐
                  │                                     └─→ Ready for Dev (rejected)   │
                  └─→ Ready for Test (skip-dev path)                                   │
                                                                                        ▼
                                              Ready for Test ←── Code Completed
                                                    │
                                                    ▼
                                               In Testing ──┬─→ Done → Ready for Release → Released
                                                             └─→ Ready for Test (failed test, retest loop)
Canceled reachable from any state.
```

Live-verified: a ticket at `Ready for Dev` has exactly 3 available transitions — `Groomed`,
`In Development`, `Canceled` — matching the diagram. This confirms the status list an earlier
type-filtered JQL sample already found (`Open`, `Groomed`, `Ready for Dev`, `In Development`,
`PR Review`, `Ready for Test`, `Done`) — that data was correct all along; it just wasn't
attributable to a confirmed graph until this diagram, unlike the Bug-workflow mix-up above where
the underlying status list itself was wrong for Bug.

**QA-owned for this workflow (same narrow-scope pattern as Bug — only the single confirming
step):** only `In Testing` → `Done`. The harness may propose it after tests pass, but must obtain
approval before the transition. It mirrors `Fix Verified → Complete` in Bug's workflow.

**Never propose as a routine QA transition:** `Ready for Test` → `In Testing` (pickup step),
`In Testing` → `Ready for
Test` (failed-test rejection loop), `Done` → `Ready for Release` → `Released` (release
management), everything upstream of `Ready for Test` (dev/PM workflow), `Canceled`.

Always call `getTransitionsForJiraIssue` first to get the real transition ID for the ticket's
*current* status regardless of issue type — transition IDs are not stable across
tickets/workflows, never hardcode one.

## Comments — lightweight phase-completion proposals

Prepare a short comment (not a restated summary of the whole work) at these points, then show it
to the owner and request approval before posting:

- `cypress-generator`: after scenarios are drafted from a Jira-sourced ticket — e.g. "Scenarios
  drafted: N positive / N negative / N edge. AC coverage: X/Y mapped."
- `cypress-shipper`: after a PR opens against a ticket's branch — e.g. "PR #NNN opened against
  `dev`/`staging`: `<PR title>`."

Never post a comment that just restates the full generated output — link to the PR/spec, state
counts, keep it to 1-2 lines. A debugging summary or coverage report stays in the conversation
unless the owner approves its exact Jira comment payload.
