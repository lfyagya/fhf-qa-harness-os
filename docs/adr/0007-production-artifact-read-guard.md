# ADR-0007 - Production Artifact Read Guard

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-07-28 |

## Context

The production Smoke lane captures screenshots, reports, downloads, and videos that may contain
live customer data. A `protect-prod-data.mjs` hook and supporting rules existed in canonical files,
but its `Read|Bash` registration existed only in hand-edited generated settings. Synchronization
correctly blocked rather than overwriting those target-side edits.

## Decision

Register `protect-prod-data.mjs` in canonical settings and generated Cursor configuration for the
parent workspace and Smoke lane. The guard blocks production artifact reads and content-extraction
commands unless the owner explicitly launches the session with `FHF_ALLOW_PROD_DATA=1`. The Dev/QA
E2E lane does not receive this production-specific registration.

## Consequences

- The harness has 15 deterministic hooks.
- Loader templates now generate lane-specific portable settings and Cursor hooks.
- Hook self-tests cover default denial, safe JUnit evidence, and explicit owner opt-in.
- Existing generated target-side safety files are preserved by being made canonical, not overwritten.
