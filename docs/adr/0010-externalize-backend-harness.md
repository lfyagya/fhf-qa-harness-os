# ADR-0010 - Externalize Backend Harness

| Field | Value |
|---|---|
| **Status** | Superseded in part by ADR-0017 |
| **Date** | 2026-08-13 |

## Context

`fhf-backend-automation` is maintained by a separate engineer with its own pytest harness. Treating
it as a generated consumer made this Cypress harness responsible for stale backend configuration and
created a misleading sync and drift contract.

## Decision

Remove backend from the managed lane, sync, drift, adapter, and prompt-routing configuration. The
backend repository remains an external read-only evidence source when it is available. File edits and
shell mutations targeting its path are blocked by the existing protected-path hooks.

ADR-0017 preserves the key decision that this repository is not a generated consumer, but replaces
the blanket read-only boundary with active-manifest-scoped automation writes and Dev/QA pytest runs.

## Consequences

Only the FHF root, E2E, and Smoke repositories receive generated harness content. Backend automation
configuration, tests, and verification remain owned by its separate repository. Coverage or other
deliberate read-only discovery may still inspect backend evidence without installing this harness.
