# ADR-0005 — Centralized QA Control Plane

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-07-24 |

## Context

FHF QA work spans Jira, Confluence, Teamwork Graph, two Cypress lanes, a separate backend
pytest repository, Cypress Cloud, and TestRail evidence. The harness already centralizes
deterministic policy and AI overlays, but sprint intake, specification freshness, implementation
state, and evidence reporting remain separate activities. Some Jira comments and QA-owned status
transitions were also autonomous, which conflicts with the owner's requested approval boundary.

The control plane must remain usable from Cursor, Claude, Copilot, Gemini, or another
MCP-capable client. It must not make one AI client, a database, or a hosted dashboard the source
of truth.

## Decision

Add a dependency-free control-plane runner and declarative configuration to this harness.
Atlassian OAuth stays in each client's MCP connection; clients export normalized read-only
snapshots for the runner. The runner combines those snapshots with repository-derived coverage
and execution evidence and writes portable JSON, Markdown, and static HTML into the FHF consumer
repository.

The existing four-agent Cypress roster remains unchanged. Approved work continues through the
existing E2E, Smoke, and backend architectures. The routing map gains a control-plane route for
sprint intake, specification proposals, and command-center refreshes.

All Jira comments, ticket creation, transitions, Confluence updates, and FHF application-
intelligence specification edits require explicit owner approval immediately before the write.
Read-only discovery remains autonomous. Exporting generated evidence into the sibling FHF
workspace requires an explicit, single-use consent reference and runtime outputs stay ignored.

## Consequences

- `qa-control-plane.json` is the canonical non-secret configuration. Its `engineering` section
  owns context, memory, harness topology, and bounded-loop policy.
- `qa-command-center.mjs` is the single runner for snapshot validation, classification, reporting,
  lifecycle evidence, metric gates, prioritization, and self-test behavior.
- The `contract` command prints the Jira, Teamwork Graph, and Confluence interchange shape without
  writing outside the harness; `qa-workflow-state.json` records the nine-stage lifecycle.
- Coverage generation emits machine-readable data and a backend-specific rubric in addition to
  the existing Cypress five-layer ledger.
- Consumer evidence is generated under `FHF/docs/evidence/`; application specifications are never
  silently synchronized from Jira or Confluence.
- Jira rules and the generator/debugger/shipper instructions must prepare proposed writes and wait
  for approval.
- Loader templates generate Claude, Cursor, and vendored config projections from that file;
  tool-native settings are adapters, not independent configuration.
- No scheduler, database, server, or new agent is introduced. Those are reconsidered only if the
  explicit refresh workflow proves insufficient.
