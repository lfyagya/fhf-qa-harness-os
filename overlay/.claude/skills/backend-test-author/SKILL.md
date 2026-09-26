---
name: backend-test-author
description: Routes backend API and Oracle automation work in fhf-backend-automation to the exact rules, existing module patterns, and generator skill it needs. Use for creating, updating, reviewing, planning, or debugging backend pytest coverage.
allowed-tools: Read, Grep, Glob
metadata:
  version: 1.1.0
---

# Backend Test Author

Use when the work touches `fhf-backend-automation`. Scope comes from the approved GSD plan or the
`/gsd-quick` request.

## Load in this order

1. `REPOSITORY.md` in this skill (setup, commands, layout).
2. The exact existing module under `api/`, `tests/`, and, only when needed, `dao/` or `db/`.
3. Only the rules the task needs (`.claude/rules/`):
   - always: `testing.md`, `api-standards.md`, `assertions.md`, `security.md`,
     `backend-automation.md`;
   - Oracle verification: `oracle-db.md`;
   - new module only: `new-module.md`.
4. Only one skill or reference matching the missing artifact:
   - module automation checklist (Smoke + E2E plan from `project-context/`):
     `references/module-checklist.md`;
   - smoke test-case spec (research, no code): `smoke-test-cases`; smoke code from that spec:
     `smoke-tests-writer`;
   - mutable Dev/QA API+Oracle flow: `e2e-tests-generator`;
   - module skeleton: `setup-test-module`;
   - typed client: `generate-api-client`;
   - fixtures: `generate-conftest`;
   - builder/factory: `generate-data-builder`;
   - test file: `generate-test-file`.

Do not preload all skills. The rules override any stale example inside a generator skill.

## Contract

- Reuse an existing typed client, fixture, builder, DB object, and assertion helper before adding
  one.
- Tests call `api/` clients; never `requests` or sessions directly.
- Use `tests.commons.assertions`; raw `assert` belongs only inside the central helpers.
- Use `BaseDB`, `BaseStateManager`, and the `tests/commons/db_schema.py` registry. Never open ad
  hoc Oracle connections or embed credentials.
- Faker/anonymized owned data, `wait_for`, exact response/error contracts, exact Oracle state when
  applicable, verified cleanup for persistent mutations.
- Name a test for TestRail with `@allure.title` / `allure.dynamic.title`, never a `[C<id>]`
  docstring marker (`testing.md`). Unknown Jira/TestRail mapping → report UNKNOWN, don't invent.
- Run only the in-scope test path, Dev/QA, sequentially unless the files are proven independent
  (own data, verified cleanup, no cross-file state).
