---
paths:
  - "fhf-backend-automation/**"
---
# Backend Automation Boundary

fhf-backend-automation is a task-scoped authoring and execution lane. It is a full harness sync
consumer on equal footing with the E2E and Smoke lanes: `harness.config.json`, `settings.json`,
hooks, agents, rules, and skills are all generated from the aggregation workspace. Backend-specific
rules and skills (api-standards, assertions, oracle-db, testing, security, new-module, and all
backend skill directories) live in the harness and are synced out — nothing is locally authoritative.

- Every prompt is a task. Unticketed: a quick task (ADR-0044) that needs one owner confirm, then
  writes inside allowedWriteRoots and runs only the test files it wrote or named.
- A named SERV ticket, manifest file or title selects a full task (ADR-0043): writes must be inside
  both grounding.repositories[].selectedPaths and plan.changeUnits[].paths.
- Runs must use backend-api-oracle, the exact plan.tests[].path, and Dev/QA.
- From the FHF root, use `.harness/backend-task-runner.mjs` for preflight and execution. It forces
  sequential pytest until the selected files prove independent data, cleanup, and no cross-file state.
- Application/service source is read-only evidence.
- Credentials, dependency changes, Git publication, TestRail/Allure uploads, and production
  backend runs remain blocked or separately approval-gated.

Use backend-test-author for progressive loading. Never substitute Cypress architecture for the
repository's typed clients, fixtures/builders, assertion helpers, and Oracle abstractions.
