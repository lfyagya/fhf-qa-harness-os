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

- An active, validated task manifest must be selected: the prompt names its ticket (or local-task
  title) and the router records the focus (ADR-0043); FHF_ACTIVE_TASK overrides.
- Writes must be inside both grounding.repositories[].selectedPaths and
  plan.changeUnits[].paths for fhf-backend-automation.
- Runs must use backend-api-oracle, the exact plan.tests[].path, and Dev/QA.
- From the FHF root, use `.harness/backend-task-runner.mjs` for preflight and execution. It forces
  sequential pytest until the selected files prove independent data, cleanup, and no cross-file state.
- Application/service source is read-only evidence.
- Credentials, dependency changes, Git publication, TestRail/Allure uploads, and production
  backend runs remain blocked or separately approval-gated.

Use backend-test-author for progressive loading. Never substitute Cypress architecture for the
repository's typed clients, fixtures/builders, assertion helpers, and Oracle abstractions.
