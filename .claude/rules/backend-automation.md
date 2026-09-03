---
paths:
  - "fhf-backend-automation/**"
---
# Backend Automation Boundary

fhf-backend-automation is a task-scoped authoring and execution lane. It is a harness sync
consumer: `harness.config.json`, `settings.json`, and hooks are generated from the aggregation
workspace. Local agents, rules, and skills remain authoritative for pytest architecture and are
never overwritten by sync.

- FHF_ACTIVE_TASK must point to a validated absolute task-manifest path.
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
