# ADR-0008: AI pilot boundaries and proposal-only automation

**Status:** Accepted
**Date:** 2026-07-28
**Deciders:** FHF QA owner

## Context

The harness already enforces command-first, contract-first Cypress patterns and scenario approval,
but the E2E package retained stale agent names and an unattended coverage-generation workflow.
That shape could amplify missing selectors or uncontrolled state instead of producing reliable
evidence.

## Decision

Run AI as a narrow, human-triggered pilot: one PO + QA-approved scenario, one dashboard surface,
an explicit published application contract, and controlled state. The headless loop creates draft
proposals only and requires the approved scenario ID plus an explicit `PROPOSE` confirmation.

Cypress remains Config -> Commands -> Tests, with no page objects, actions files, or locator
abstraction. Guardrail false positives use a time-bounded exception-and-repair workflow; no
blanket bypasses are allowed.

## Consequences

- AI output cannot become a release decision without scoped CI evidence, QA acceptance, and owner review.
- Missing `data-cy` hooks or state setup stop a pilot and become application/specification work.
- The four-agent roster is the only active Cypress routing model; stale role references must be removed from current instructions.
- Broader unattended coverage generation is intentionally deferred until the pilot proves reliable.
