---
name: backend-test-author
description: Routes backend API and Oracle automation authoring to the exact fhf-backend-automation rules, existing module patterns, and local generator skill needed by the active task. Use for creating, updating, reviewing, or debugging backend pytest coverage.
allowed-tools: Read, Grep, Glob
metadata:
  version: 1.0.0
---

# Backend Test Author

Use this skill only after the active task manifest selects fhf-backend-automation.

## Load in this order

1. REPOSITORY.md in this skill (setup, commands, layout).
2. The exact existing module under api/, tests/, and, only when selected, dao/ or db/.
3. Only the repository-local rules needed by the task:
   - always: .claude/rules/testing.md, api-standards.md, assertions.md, security.md;
   - Oracle verification: .claude/rules/oracle-db.md;
   - new module only: .claude/rules/new-module.md.
4. Only one local skill matching the missing artifact:
   - plan: .claude/skills/plan/SKILL.md;
   - module skeleton: setup-test-module;
   - typed client: generate-api-client;
   - fixtures: generate-conftest;
   - builder/factory: generate-data-builder;
   - test file: generate-test-file.

Do not preload all local skills. Current .claude/rules/*.md override any stale
example inside a generator skill.

## Contract

- Reuse an existing typed client, fixture, builder, DB object, and assertion helper before adding
  one.
- Tests call api/ clients; tests do not call requests or sessions directly.
- Use tests.commons.assertions; raw assert is allowed only inside the central assertion helper.
- Use BaseDB, BaseStateManager, and the centralized DB registry. Never create ad hoc Oracle
  connections or embed credentials.
- Use Faker/anonymized owned data, wait_for, exact response/error contracts, exact Oracle state
  when applicable, and verified cleanup for persistent mutations.
- Name a test for TestRail with `@allure.title` or `allure.dynamic.title`, never a `[C<id>]`
  docstring marker (`.claude/rules/testing.md`). If the Jira/TestRail mapping is absent, report
  UNKNOWN rather than inventing one.
- Execute only the active-manifest backend-api-oracle test path in Dev/QA through the FHF-root
  `.harness/backend-task-runner.mjs`. Its default is sequential; parallelism requires selected-file
  evidence of independent data, verified cleanup, and no cross-file state.

The skill supplies repository knowledge; it does not grant write or shell authority. Hooks enforce
the active manifest.
