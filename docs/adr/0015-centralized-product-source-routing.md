# ADR-0015 — Centralized Product Source Routing

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-21 |

## Context

FHF is one product implemented and verified across frontend, API-routing, service, Oracle,
automation, and agent-workflow repositories. ADR-0010 treated backend automation as an external
read-only evidence source because it was independently maintained. The workspace now contains the
application, contract, and automation repositories, so routing can use a complete source catalog.

Loading every repository into every session would create context noise and make factual answers less
reliable. Keeping a separate backend harness would create two competing routing policies.

## Decision

Keep `config/qa-control-plane.json` as the one canonical policy and add a source topology there.
Each source record declares its role, entry paths, local rules, execution boundary, and checkout
constraint. Context routes select a small source bundle first; the agent then reads source just in
time and cites it as implementation evidence.

The topology is routing metadata only and grants no mutation authority. Existing
`engineering.harness.boundaries`, repository-local instructions, and explicit approval policies
remain authoritative. Activating a different application-source write model requires a separate
security decision; this ADR does not make that change. `fhf_documents` remains source-inspectable
through Git objects, and its Windows checkout limitation is declared explicitly.

The root projection is the common entry point for Claude, Codex, Cursor, Copilot, and Gemini.
Repository-local `CLAUDE.md`/`AGENTS.md` remain the detailed authority for changes inside that
repository. Obsidian remains a derived retrieval index only; it cannot become product fact or
write back automatically.

## Consequences

- The source catalog routes read-only discovery across every selected application repository.
  ADR-0017 separately enables task-scoped backend automation authoring and Dev/QA execution. Native
  API/DB/JUnit artifacts remain required for execution claims.
- The router and generated root projection gain product-source routes and are tested with golden
  routing cases.
- The existing backend automation configuration and ownership are not overwritten. The catalog
  cannot grant write access; only the active-manifest boundary defined by ADR-0017 can.
- A source index is generated on demand and is evidence, not a static claim of runtime topology.
