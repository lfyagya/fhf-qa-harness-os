# Guardrail Exceptions and Repair

This register prevents verified guardrail noise from consuming pilot cycles while preserving
fail-closed safety. It is not a bypass list.

## How to record an exception

Add only a reproduced false positive. Each entry must include the hook/rule, exact trigger,
minimal reproduction, owner, repair issue, and expiry. Scope it to the smallest possible path or
payload. The exception expires when the canonical hook is repaired and its regression is added to
`scripts/harness/test-hooks.mjs`.

| Status | Hook/rule | Scope | Owner | Repair issue | Expiry |
|---|---|---|---|---|---|
| None active | — | — | — | — | — |

## Current repair backlog

- Selector duplication detection intentionally checks literal `data-cy` re-declarations only
  within one lane's `cypress/configs/ui` tree. Cross-lane and CSS-class analysis are coverage
  gaps, not safe exceptions; `cypress-gate` must review them until a low-noise detector exists.
- A suspected hook false positive must be added above with a minimal reproducer before anyone
  changes a test or suppresses the finding.
