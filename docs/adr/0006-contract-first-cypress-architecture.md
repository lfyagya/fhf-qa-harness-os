# ADR-0006 - Contract-First Cypress Architecture

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-07-28 |

## Context

The application and Cypress framework both use domain-oriented concepts, but the automation
repository accumulated overlapping layouts and some specs bypassed Config -> Commands -> Tests by
registering intercepts, literal routes, and large stubs directly. That makes route drift, selector
drift, and command ownership difficult to detect.

## Decision

New and intentionally migrated Cypress domains consume a public application contract: named route,
access precondition, API contract, stable `data-cy` hooks, and approved scenario. Cypress does not
copy application component, hook, service, or migration-era structure.

Specs orchestrate only. Domain commands own interception, fixture selection, navigation, and
waits; configs own constants; fixtures own deterministic payloads. The existing validation hook
blocks raw intercept registration and literal routes in newly edited specs. Legacy modules are
migrated deliberately, not reorganized opportunistically.

## Consequences

The application owns `fhf-dashboards/src/constants/routes.js`; Cypress does not copy it. The
harness publishes its default export to the generated, checked-in
`cypress/configs/app/application-routes.contract.json` artifact and validates every
`DASHBOARD_MODULES` entry against it. Cypress may consume only an active application route;
legacy, development-only, wildcard, and unpublished routes fail validation. The publisher also
hashes the source, so a stale contract cannot silently pass after an application route changes.

Run `publish-route-contract.mjs` after a route-source change, then run
`validate-cypress-route-contract.mjs` as part of the config verification loop. The current hook
topology, agent roster, and routing map do not change. Generated tool overlays are regenerated
from the canonical harness after a loader change.
