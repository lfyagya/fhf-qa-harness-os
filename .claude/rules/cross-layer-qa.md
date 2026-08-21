---
paths:
  - "front-end-automation-e2e/**"
  - "front-end-automation-smoke/**"
  - "fhf-backend-automation/**"
  - ".harness/tasks/**"
---
# Cross-Layer QA Workflow

One Jira family may select frontend and backend implementation evidence plus both automation lanes.
Use one active manifest and one specialist:

1. Map acceptance criteria to applicable UI, API, and Oracle outcomes.
2. Freeze only selected source SHAs/paths and a reasoned one-hop dependency graph.
3. Plan automation change units and exact runners/test paths.
4. Generate Cypress plus pytest coverage without editing application source.
5. Run functional tests first, then impacted regression, then the explicitly selected Smoke scope.
6. Record native artifacts with revision, environment, exact selection, and assertion-level result.

No layer is presumed applicable or passing. Use NOT_APPLICABLE with evidence or UNKNOWN.
Production Smoke stays GET-only; backend automation stays Dev/QA.
