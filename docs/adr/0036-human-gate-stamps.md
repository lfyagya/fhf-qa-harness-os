# ADR-0036 — Multi-Gate Human Stamps on the Task Protocol

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-17 |
| **Amends** | ADR-0016 |

## Context

ADR-0016 ports LANE's mechanical patterns into `engineering.taskProtocol` and forbids installing
LANE in FHF repositories. The v1 protocol has one digest-bound approval (`approval.approvedDigest`)
with no recorded approver or timestamp.

A Claude Code session then used the global `lane` CLI (`TICKET.md` / `TSD.md` / `lane dashboard`)
as a second control plane. That CLI's terminal confirm reads `/dev/tty` and fails closed on
Windows. The dashboard path works, but it stamps LANE artifacts, not `fhf-harness/task/v1`.

QA needs human approval, with **who** and **when**, at six process points: spec, scenarios, plan,
test cases, evidence, and release. Those stamps must be the same in Cursor and Claude CLI.

## Decision

1. Keep LANE out of FHF. Do not scaffold it, do not route Claude CLI to `lane approve`, and do
   not treat LANE dashboard as the harness approval UI. LANE remains a pattern reference only.
2. Extend `engineering.taskProtocol.approval` with an ordered `gates` list. Each gate binds a
   digest of named manifest fields, and a current stamp is `{ approvedBy, approvedAt, digest }`.
3. `node .harness/task-protocol.mjs next` blocks on the earliest missing or stale required gate
   for the current stage (`await-human-approval` / `refresh-human-approval`, plus `gate`).
4. A human-only `approve` command writes the stamp. It must use stdin on a real TTY (Windows-safe).
   It refuses when Claude Code or Cursor Agent is the process. Agents still cannot approve.
5. The existing single `approvedDigest` remains valid as a legacy **plan** stamp only, so current
   manifests do not all go stale on the day this ships.
6. A click-to-approve page, if added later, is a thin harness view over `digest` / `next` /
   `approve` — preferably on `qa-command-center` — not an embedded LANE dashboard.
7. Before every spec, scenarios, plan, or test-cases confirm, the agent writes `review.<gate>`
   on the manifest. MATCH only when spec (`intentVsBuilt`), scenario (`scenarioRef`), planned
   test (`assertion`), and frozen source agree. A `defect` that is readable from selected source
   is a Dev notice **before** any run. Accepted overlays, parked rows, and runtime-only claims
   are not bugs. This applies to every task and every QA member using the harness, not one ticket.
8. A stamp requires a fresh human yes in the **current** turn. A prior card, a delayed
   notification, or `git config user.name` by itself is not approval. Ask again.

Session start and prompt routing inject the current gate. Write and pytest hooks fail
closed on the earliest missing stamp, so a later step cannot start until the earlier
gate is current. The human still types `yes`; the harness only auto-stops.

## Consequences

- Spec, scenario, plan, test, evidence, and release approvals are visible on the task manifest
  and fail closed when bound content changes.
- Claude CLI and Cursor share one gate list after sync.
- Using `lane` on an FHF ticket is a process defect, not an alternative harness.
- A LANE-like browser UI is optional follow-on work inside the harness, not a reason to adopt LANE.

Amended by ADR-0039: the first gate is `manifest` (absorbing `spec`); Cypress E2E and Smoke join
the same `automationSource` write map as backend.
