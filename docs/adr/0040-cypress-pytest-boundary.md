# ADR-0040 — Cypress owns the UI, pytest owns the remainder

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-22 |

## Context

Cypress and pytest were both able to look like the test for the same ticket. A missing task manifest stopped backend work with a setup block. Claude and Cursor auto-load `rules/`, while Codex and ChatGPT website chat only read `AGENTS.md`.

## Decision

1. `qualityAssurance.coverageBoundary` is the split. Cypress (`front-end-automation-e2e`, `front-end-automation-smoke`) owns the browser behavior of `fhf-dashboards`: the screen, its route, and the UI call that screen makes. Pytest (`fhf-backend-automation`) owns the REST, service, Oracle, and Python workflow gap that the Cypress spec for the sprint task does not already assert. Sources are `fhf-rest-internal`, `fhf-rest-service`, `fhf-rest-external`, `fhf_documents`, `fhf-letters`, and `fhf-reposession`. The catalog has no DAG repository, so those Python workflows are the configured job side.
2. The sprint task picks the path. `new-test` routes to Cypress and the `frontend-change` bundle. `backend-test` and `cross-layer-test-generation` route to one `qa-automation-generator`. The prompt states the boundary. A missing manifest asks for the SERV ticket, module, and the pytest remainder. Routing continues. A backend write or pytest still waits until that task records the selected non-production path.
3. `rules/` stays the one rule body. `ruleIndexText()` is the one index. Session start injects it, and both the engine `AGENTS.md` and the generated workspace `AGENTS.md` carry the same text, so Claude, Cursor, Codex, Copilot, Gemini, and ChatGPT website chat see one list.

## Consequences

A UI check is not re-authored as pytest. A Cypress pass is not proof of the service or Oracle remainder. Setup names the missing input instead of ending at a bare block. The dangerous write still waits for the task record.
