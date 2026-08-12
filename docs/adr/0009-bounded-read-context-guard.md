# ADR-0009 — Bounded Read Context Guard

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-06 |

## Context

Claude compacted repeatedly after several full API-config reads refilled the conversation within three turns.

## Decision

Use Claude's adaptive auto-compact window and add a shared Read hook. Reads larger than 2 KiB must request no more than 120 lines.

## Consequences

Claude and Cursor receive the guard in every lane. Small files remain readable without a limit; the guard does not alter file contents or application behavior.
