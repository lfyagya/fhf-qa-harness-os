# Cypress Version Upgrade Checklist

Both lanes currently track Cypress `^15.11.0`. When bumping, use Cypress's per-version migration
prompt from https://docs.cypress.io (Migration Guide → your current version section → copy the
ready-made AI prompt). Upgrade **one major/minor step at a time**.

## Steps

1. Run `node scripts/execution/cloud-access-doctor.mjs` (Node floor for Cloud CLI must still hold).
2. Open the Cypress migration guide for the **current** version; paste the prompt into an upgrade
   branch session. Confirm compatibility notes before applying.
3. Bump `cypress` in:
   - `front-end-automation-e2e/CypressFHF/fhf-dashboards/package.json`
   - `front-end-automation-smoke/CypressFHF/fhf-dashboards/package.json`
4. Install / lockfile update in each package.
5. Apply guided API renames; never weaken smoke GET-only or Config→Commands→Tests.
6. Run static architecture checks (smoke already has four; E2E when available).
7. `node .harness/verify.mjs change` in each lane package.
8. Spawn `cypress-gate` on the upgrade diff — **BLOCK** on `cy.wait(number)`, mutations in smoke,
   committed `cy.prompt(`, leftover scratch specs.
9. Smoke smoke suite + one representative E2E module against Dev/QA (not prod for E2E).
10. Record the bump in `docs/evidence/execution-history.md` (version → date → any breaking notes).

## Do not

- Jump multiple majors in one PR.
- Enable Studio AI self-heal as a migration shortcut.
- Change `connectors.cypressCloud.laneAccess` as part of a version bump.
