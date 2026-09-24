# ADR-0050 — Task Manifests Live in the FHF Workspace

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-24 |
| **Amends** | ADR-0043, ADR-0047 |

## Context

A task manifest is created once, at `FHF/.harness/tasks/<key>.json`. Writes into the E2E checkout were resolved with that checkout as the task root, so the gate read `E2E/.harness/tasks/` (absent) and the lane branch name. The file in the FHF workspace was never opened. Copying the manifest into the lane splits the task.

## Decision

`taskRoot` in `scripts/harness/task-protocol-lib.mjs` is the only resolver. Hooks and the task CLI call it. Lane names come from `paths.lanes` and the setup file from `workspaceContract.setupFile`. It resolves a lane checkout to the FHF workspace before any manifest or focus lookup.

1. A directory whose `.harness/lane.json` says `root` is the workspace.
2. A directory whose lane is one of `paths.lanes` uses `consumerRoot` from that setup file when the path exists and is not the lane itself.
3. Otherwise the parent of that lane is used when it is the root lane or already contains `.harness/tasks`.
4. A directory that is not a lane checkout stays the task root, as before.

The lane does not receive its own `.harness/tasks` copy.

## Consequences

An E2E write uses `FHF/.harness/tasks/SERV-12599.json` and the workspace focus file. `FHF_ACTIVE_TASK` remains an absolute override. A lane with no `consumerRoot` and no parent workspace still searches the lane checkout.

## What this does not decide

It does not select a task by itself, stamp a gate, or change which paths a manifest must list.
