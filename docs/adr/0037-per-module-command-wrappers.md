# ADR-0037: Keep per-module command wrappers over shared generics

**Status:** Accepted
**Date:** 2026-07-26 (renumbered and moved into this series 2026-09-20)
**Deciders:** Repo owner (Yagya)
**Applies to:** Both Cypress lanes (`ProdSmokeExecution`, `AG Frontend Automation`)

> Decided on 2026-07-26 as ADR-0005 in a second series under `FHF/docs/adr/`, which held this
> one record. That number was already ADR-0005 (centralized QA control plane) here, so "ADR-0005"
> named two different decisions depending on which tree you were standing in. One series, one
> numbering space: renumbered to 0037, content unchanged below.

## Context

A structural sweep of the smoke suite (912 commands, 42 UI configs, 29 specs, 2026-07-26) found
114 groups of commands with byte-identical implementation *shape*:

```js
Cypress.Commands.add('interceptTitlesGeneralDashboardApis', () => {
  cy.interceptDashboardApis(TITLES_GENERAL_API, { only: TITLES_GENERAL_ALIASES });
});
```

Read as raw duplication that is 111 groups of "the same command written many times", and the
obvious conclusion is to delete the wrappers and have specs call the generic directly. That
conclusion is wrong, and this ADR exists so the next sweep does not reach it.

## Decision

Keep the per-module wrapper layer. Enforce one rule mechanically:

> A per-module command earns its name only if its body references module-specific config.

Wrappers that bind config to a shared generic stay. Commands whose bodies are identical *and*
reference no module config are aliases and get deleted.

## Options considered

### A. Collapse wrappers, specs call generics directly

| Dimension | Assessment |
|---|---|
| Command count | 912 → ~200 |
| Spec weight | Every spec imports its module's UI/API configs |
| Change blast radius | A selector change touches specs, not one command |

**Pros:** far fewer command definitions; less indirection to trace.
**Cons:** breaks `Config → Commands → Tests` — specs stop being thin orchestration and become
config consumers. A `data-cy` change would edit 29 specs instead of one command. The suite's
stated architecture becomes nominal.

### B. Keep wrappers, gate aliases (chosen)

| Dimension | Assessment |
|---|---|
| Command count | 912 → 905 (7 genuine aliases removed) |
| Spec weight | Unchanged — specs stay thin |
| Change blast radius | One command per selector change |

**Pros:** architecture stays real; specs read as intent (`cy.assertTitlesGeneralColumnHeaders()`),
not mechanism. Config stays out of specs.
**Cons:** large command surface with no natural ceiling — it grows with dashboards × assertions.
Requires a gate, or dead wrappers accumulate (they had: 7 found).

## Trade-off

The wrapper layer buys a single edit point per selector and thin specs, and costs a command
count that grows multiplicatively. That cost is acceptable only while the layer stays free of
entries that carry no information. The alias rule is what makes it acceptable: it is a cheap,
mechanical test that separates the 111 legitimate groups from the 3 that were noise.

Applying the rule by hand is not reliable at this scale — the first pass through the sweep
misread the 111 as duplication. Hence the gate.

## Consequences

- Easier: adding a dashboard follows one obvious shape; renaming a selector is one edit.
- Harder: the command count keeps growing, and `grep` across 905 commands is the discovery tool.
- Revisit when: a generic accumulates so many per-module bindings that the bindings themselves
  diverge in behaviour (at that point the generic is doing too much, not the wrappers).

## Enforcement

`CypressFHF/fhf-dashboards/scripts/check-alias-commands.js`, wired into `buildspec.yml`
`pre_build` (which is `on-failure: ABORT`). Verified both directions: passes on the clean tree,
exits 1 on an injected alias pair. Companion gate `check-duplicate-selectors.js` runs beside it.

Rule text lives in `.claude/rules/ui-config-hierarchy.md`.
