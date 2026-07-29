---
paths:
  - "CypressFHF/fhf-dashboards/cypress/**"
---
# AI Pilot Policy

## Purpose

AI accelerates a test slice only after the slice is specified. It must not turn ambiguous
requirements, live state, or missing selectors into a larger volume of brittle automation.

## Pilot entry criteria

Start with one approved scenario on one dashboard surface. Before an agent writes or changes a
spec, the handoff must identify all of the following:

1. A PO + QA Lead approved scenario object with traceability and expected outcome.
2. The published application route, access precondition, API contract, and stable `data-cy` hooks.
3. Controlled state: deterministic fixtures/stubs, or an explicit Dev/QA seed-and-cleanup plan.
4. The lane and evidence required to accept the change.

If any criterion is missing, stop test generation and create a testability/specification proposal.
Do not substitute CSS, text, index, or real-record selectors; do not use arbitrary waits; and do
not broaden the pilot to compensate for a missing contract.

## Cypress-only implementation

This harness is Cypress-oriented. Keep Config -> Commands -> Tests and Cypress's command model;
do not introduce page objects, actions files, or a locator abstraction.

## Proposal-only automation

An AI repair or generation run may prepare an uncommitted patch or draft PR only. It is never a
quality gate, never self-approves, and never merges. Deterministic CI evidence, the release gate,
QA acceptance, and owner review remain authoritative.

## Guardrail findings

Treat a guardrail result as valid until reproduced otherwise. For a verified false positive:

1. Capture the hook name, exact command/payload, affected file, and minimal reproducer.
2. Add a time-bounded, narrowly scoped entry to
   `docs/framework/process/guardrail-exceptions.md` with an owner and repair issue.
3. Repair the canonical hook or rule, add a regression case to `scripts/harness/test-hooks.mjs`,
   regenerate loader shims, and remove the exception.

Never use a blanket ignore, a permanent bypass, or a test-code workaround for a guardrail defect.
