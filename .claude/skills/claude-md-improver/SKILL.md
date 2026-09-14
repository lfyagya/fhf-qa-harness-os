---
name: claude-md-improver
description: "Audit harness-os CLAUDE.md only. Use when the user says claude-md, audit CLAUDE.md, or improve CLAUDE.md. Stay in parent. Do not edit generated consumer CLAUDE.md files."
---

# Claude MD improver (FHF-routed)

Stay in the parent. This skill is callable only from the `claude-md-improver` route.

## Job

Audit `fhf-harness-os/CLAUDE.md`. Propose a shorter pointer that still names the engine,
payload split, and verify commands.

## Do not

- Edit consumer `CLAUDE.md` files. Those are generated pointers; sync overwrites them.
- Hand-edit FHF-root or lane `.claude/` projections.
- Invent a second router beside `engineering.context.routes`.

A CLAUDE.md change in the engine is ordinary authoring. A change to generated copies is drift.
