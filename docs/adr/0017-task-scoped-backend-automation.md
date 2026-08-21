# ADR-0017 - Task-Scoped Backend Automation

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-21 |

## Context

One Jira feature can require coordinated frontend Cypress and backend API/Oracle automation.
ADR-0010 correctly stopped generating the centralized harness into fhf-backend-automation, but its
blanket read-only boundary prevented the requested cross-layer authoring and execution workflow.
Unrestricted backend access would be too broad because this repository contains credentials,
integration tests, persistent mutations, and external reporting integrations.

## Decision

Keep fhf-backend-automation independent and do not project harness files into it. Grant the root,
E2E, and Smoke harness projections task-scoped authority over backend automation:

- FHF_ACTIVE_TASK points to one validated, absolute fhf-harness/task/v1 manifest.
- A backend write must match the repository, selectedPaths, planned change-unit paths, allowed
  authoring roots, and an approved/implementing task state.
- A backend run must use backend-api-oracle, contain the exact selected test path, and record Dev or
  QA as its environment.
- The FHF root vendors a mechanical backend task runner so hook-capable and instruction-only AI
  clients use the same preflight. It defaults to sequential pytest execution and produces digest-
  bound, non-zero JUnit evidence without publishing externally.
- The one cross-layer generator may author Cypress and pytest coverage for the same Jira family.
  Separate cross-layer debugger and gate agents own failure diagnosis and review.
- Repository-local backend rules and focused generator skills remain authoritative and load only
  when selected.

Application source, credential files, dependency changes, arbitrary shell writes, Git publication,
external uploads, production backend execution, and automatic human approval remain disallowed.

## Consequences

The harness can generate and verify both automation layers without a second control plane or
preloading every repository. The active manifest becomes a security and relevance boundary, so stale
approval, changed SHAs, unselected paths, and broader pytest commands fail closed. Native Cypress and
pytest/API/Oracle artifacts remain required for completion claims.
