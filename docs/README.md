# Documentation Router

Do not browse or preload this tree. Read the single owner matching the task.

| Need | Read |
|---|---|
| Cypress implementation rules | `framework/testing-standards/TESTS.md` |
| What a smoke test must / should / must not do — quick look | `framework/testing-standards/smoke-checklist.md` (derived from the strategy doc; hook-enforced rows marked 🔒) |
| Which named test is the smoke gate, per sub-module and layer | `framework/testing-standards/smoke-gate-map.md` (tag vocabulary + UI/API/DB gate test per sub-module; every cited name verified against source) |
| Product behavior and business rules | [`Test-Case-Automation-Using-Claude-Agents/specs/`](../Test-Case-Automation-Using-Claude-Agents/specs/INDEX.md) |
| Frontend implementation evidence | `../fhf-dashboards/src/` |
| Automation implementation evidence | `../front-end-automation-e2e/CypressFHF/fhf-dashboards/`, `../front-end-automation-smoke/CypressFHF/fhf-dashboards/`, and `../fhf-backend-automation/` |
| Backend API and Oracle authoring rules — how to write the tests | `../fhf-backend-automation/CLAUDE.md` and its `.claude/rules/`. **Federated owner**: authority is repository-local per ADR-0010, ADR-0017, ADR-0021. The lane *contract* — what counts as evidence — stays in `framework/testing-standards/TESTS.md` §Backend API/database |
| Canonical requirement registry — intent as machine-readable ids, for the five blueprint-ready sub-modules | `evidence/requirements.json` (generated; run `node ../fhf-harness-os/scripts/harness/build-requirements.mjs`) |
| Current repository test presence | `evidence/coverage-computed.json` |
| Latest execution and failure evidence | `evidence/execution-history.md` |
| Per-sprint regression pack — plan, checklist, release confidence | `../front-end-automation-e2e/docs/evidence/regression-effort/records/<sprint-id>/` (e.g. `sprint-26.3.5/`). Records moved out of this tree 2026-08-17; `evidence/regression-effort/` keeps only the workflow and templates. Content search skips that nested repository — resolve the path directly |
| Accepted UI → API → DB evidence | `planning/coverage/fullstack-chain-risk-matrix.md` |
| Smoke UI → API → DB chain coverage, per sub-module (2026-08-20) | `planning/smoke-ui-api-db-chain-coverage.md` — **temporary stand-in**: belongs in `planning/coverage/` and should be folded into the owner above; that directory is currently deny-blocked |
| The QA AI workflow standard — which document governs test generation, coverage design, regression development, data setup, reviews, quality checks, and who answers for each | `adoption/qa-ai-adoption-strategy.md` §3 (ratification-ready; not the adopted standard until its status line names a date) |
| Priority, scope, estimate, capacity, sequence, or impact | `planning/roadmap/effort-breakdown-by-module-and-subdashboard.md` |
| When to run which lane, change-based selection, gates, on-demand triggers | `framework/execution-strategy.md` |
| Cloud failure triage, night brief, failed-spec re-runs | `framework/triage-runbook.md` |
| Cypress version bump / migration prompts | `framework/cypress-version-upgrade-checklist.md` |
| Missing frontend test hooks | `planning/data-cy-hook-backlog.md` |
| Current sprint / Jira / evidence dashboard | `C:\Users\Leapfrog\fhf-harness-os\docs\framework\qa-control-plane.md` |
| Harness internals | `C:\Users\Leapfrog\fhf-harness-os\docs\framework\harness-engineering.md` |
| Getting a QA onboarded onto the harness — setup, usage, guardrails | `adoption/qa-harness.md` (one page, top to bottom) |
| Candidate QA AI workflow standard (proposed, under review) — maps test generation, coverage design, regression development, data setup, reviews, and quality checks to the document that governs each | `adoption/qa-ai-adoption-strategy.md` §3 |
| Evidenced QA-side adoption blockers — spec maturity, missing `data-cy` hooks, test-data lifecycle, backend parity, access grants, missing manual baseline, smoke deploy gate | `adoption/qa-ai-adoption-strategy.md` §4 |
| QA AI adoption program — objectives and baselines, backend/frontend parity, workshop run sheet, sync cadence | `adoption/qa-ai-adoption-strategy.md` |

## Where this tree lives

This tree is versioned on branch `fhf-docs` of the harness engine's remote,
`git@github.com:lfyagya/fhf-qa-harness-os.git`. Its history is unrelated to `main` and is never
merged into it: `main` stays engine-only, and the payload borrows the remote as storage without
entering the engine's history. ADR-0018 set that arrangement up; ADR-0035 made it the payload's
home rather than an interim parking spot.

To obtain it on a new machine:

```text
git clone -b fhf-docs --single-branch git@github.com:lfyagya/fhf-qa-harness-os.git FHF
```

Two consequences of sharing the engine's remote, both accepted in ADR-0035 rather than worked
around. Access is repository-scoped — GitHub grants read per repository, not per branch, so being
given this tree also gives you the engine on `main`; if someone should have the documentation but
not the harness internals, reopen the hosting question instead of reaching for a sparse checkout.
And the account is personal, so the durable backup is a second clone of this branch elsewhere, not
a second repository.

Keep the workspace checked out on `fhf-docs`. Checking out an engine branch at the workspace root
removes every payload-only file, because the two histories share no commits (ADR-0026).

## Ownership

Ownership is configured in
`C:\Users\Leapfrog\fhf-harness-os\config\qa-control-plane.json` → `documentation.owners`.
Update an existing owner; do not create another report. The team product specification owns intent;
live source/API/DB evidence verifies implementation and exposes conflicts. Obsidian is retrieval-only
and never writes facts back.

After documentation changes run:

```text
node ../fhf-harness-os/scripts/harness/check-docs-links.mjs
```
