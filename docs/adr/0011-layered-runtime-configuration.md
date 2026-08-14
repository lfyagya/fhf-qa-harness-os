# ADR-0011 - Layered Runtime Configuration

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-14 |

## Context

The harness needs stable reusable policy and short-lived session choices. Rewriting the complete
control plane for every lane, ticket, budget, or route selection creates unnecessary projection
churn and makes it difficult to distinguish policy from runtime state.

## Decision

Keep `config/qa-control-plane.json` as the reviewed static policy and derive tool projections from
it. Accept an optional JSON `FHF_HARNESS_OVERLAY` for validated session metadata and lower budgets
only. The overlay cannot change hook topology, agent or skill rosters, permissions, data boundaries,
or hard safety ceilings. Effective configuration fingerprints, loop state, and traces are runtime
artifacts; they never update canonical policy automatically.

## Consequences

- Sessions can narrow scope without regenerating the entire policy for each request.
- Static policy remains reviewable and portable across contributors and clones.
- Runtime traces identify the base policy and overlay used for each event.
- Any improvement to durable policy remains a reviewed, versioned change followed by projection and
  evaluation checks.
