---
name: backend-test-author
description: Routes pytest to the REST, service, Oracle, or Python workflow gap that Cypress does not already cover. The sprint task selects the path. Ask for the SERV ticket and module when they are missing.
allowed-tools: Read, Grep, Glob
metadata:
  version: 1.0.0
---

# Backend Test Author

The sprint task selects this path when the gap is REST, service, Oracle, or a Python workflow that the Cypress spec does not already assert. If the SERV ticket or module is missing, ask for it. Do not start a second backend process, and do not re-author the UI check as pytest.

## Load in this order

1. fhf-backend-automation/CLAUDE.md.
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

Do not preload all local skills. Current CLAUDE.md and .claude/rules/*.md override any stale
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
- Put known TestRail IDs in test docstrings. If Jira/TestRail mapping is absent, report UNKNOWN
  rather than inventing an ID.
- Execute only the active-manifest backend-api-oracle test path in Dev/QA through the FHF-root
  `.harness/backend-task-runner.mjs`. Its default is sequential; parallelism requires selected-file
  evidence of independent data, verified cleanup, and no cross-file state.

The skill supplies repository knowledge; it does not grant write or shell authority. Routing continues from the sprint task. A write or pytest waits until that task records the selected non-production path.
