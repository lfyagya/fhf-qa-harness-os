---
paths:
  - "fhf-backend-automation/**"
---
# Backend Automation Boundary

`fhf-backend-automation` is the pytest API/Oracle lane (Python 3.10, venv at `venv/`).

- Scope comes from the approved GSD plan or the `/gsd-quick` request. Write only the paths it
  names; run only the test files it names or you wrote. Unclear scope → stop and ask.
- Agent runs are Dev/QA only. Production backend runs (including `tests/smoke/`, which targets
  production) are the owner's.
- Backend smoke lives in `tests/smoke/` on `master` (and `dev`), one folder per module. Smoke is
  read-only: GET endpoints and SELECT queries only — no create/update/delete (CRUD) tests, no
  POST/PUT/PATCH/DELETE calls, no DML. Mutating coverage belongs in the module's Dev/QA tests.
- Run pytest sequentially (no `-n`) unless the selected files are proven independent: own data,
  verified cleanup, no cross-file state. `pytest.ini` already sets `--order-scope=module` and
  `--dist=loadfile`.
- Application/service source (`fhf-rest-*`, `fhf_documents`, …) is read-only evidence.
- Credentials, dependency changes (`requirements.txt`), git publication, TestRail/Allure uploads,
  and email reports need the human's explicit request.
- Setup/auth/network failure is setup evidence — not a pass and not a product failure.

Use the `backend-test-author` skill for progressive loading. Never substitute Cypress architecture
for the repository's typed clients, fixtures/builders, assertion helpers, and Oracle abstractions.
