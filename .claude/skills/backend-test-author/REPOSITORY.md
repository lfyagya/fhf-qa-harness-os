# fhf-backend-automation — Repository Guide

The harness owns this guide (ADR-0048). The backend repository gitignores `CLAUDE.md` on `master`
and `dev`, and since ADR-0032 its rules live in the harness `.claude/rules/`. Checked against
`origin/master` on 2026-09-24. When the repository and this guide disagree, the repository wins, so
fix the guide.

pytest suite covering the FHF SERV backend through its REST APIs, with Oracle (and NLS) verification.

## Setup

Installation (Python 3.10, Oracle Instant Client, virtualenv, `pip install -r requirements.txt`)
is in the repository's `README.md`. Local configuration is gitignored and copied from templates:

| File | Holds | Template |
|---|---|---|
| `config/config.ini` | Oracle DB, NLS (MSSQL), email, S3 credentials | `config/example_config.ini` |
| `tests/.env` | API base URL, credentials, Okta vars, endpoint paths, TestRail settings | `tests/example_env` |

Never read these into output or commit them (`.claude/rules/security.md`). In CI (`buildspec.yml`),
`config/config.ini`, `tests/.env` and `pytest.ini` are fetched from AWS Secrets Manager.

## Running tests

An agent runs only the active task's selected test path, through the FHF-root
`.harness/backend-task-runner.mjs`, against Dev/QA (`.claude/rules/backend-automation.md`). The
commands below are for reference and for the owner.

`pytest.ini` already adds `--order-scope=module`, `--dist=loadfile`, Allure results to
`allure-results/`, JUnit to `reports/junit-report.xml`, and a debug log at `reports/pytest.log`.

```bash
pytest tests/loss_mitigation/repo_invoice/            # one module
pytest tests/loss_mitigation/repo_invoice/test_x.py   # one file
pytest tests/ -k "approval"                           # by keyword
```

`scripts/testrail_integration.sh` has four modes: `test` (run), `upload` (JUnit to TestRail),
`all` (run, then upload), `smoke`. `scripts/testrail_sync_titles.py` syncs case titles from
`allure.dynamic.title`. **TestRail uploads, Allure publication and email reports are approval-gated
for agents.**

No linter or formatter is configured.

## Layout

```
api/                 typed clients; every *_client.py extends BaseAPIClient (base_client.py)
  endpoint_constants.py
tests/
  conftest.py        global fixtures, BaseDB, BaseStateManager
  constants.py       status values, DB column names, state-manager keys
  commons/           assertions.py, wait_utils.py, db_schema.py, queries.py,
                     api_schemas/, data_builder/, invoice_helpers.py, utils.py
  loss_mitigation/   repo_invoice/, auction_invoice/
  ancillary/         ancillary_products_dashboard/, ancillary_cancellation_dashboard/
  unifi/             conftest.py, integration/, e2e/
  smoke/             GET-only; conftest.py registry of client and state fixtures,
                     one directory per module
dao/oracle_dao.py    get / set / batch
db/oracle.py         Oracle connection (singleton)
helpers/             okta_auth_helper, db_helper, acd_helpers, cron_helper
reports/             email report helpers
util/path_utils.py   PathUtils: paths and config/config.ini
scripts/             testrail_integration.sh, testrail_sync_titles.py, apd_data_seed/
```

## Rules

How a test is written lives in the harness rules, and the lane contract (what counts as backend
coverage and evidence) lives in `docs/framework/testing-standards/TESTS.md`:

- `.claude/rules/api-standards.md`: typed clients and their fixtures
- `.claude/rules/assertions.md`: shared assertion helpers, API and DB dual validation, `wait_for`
- `.claude/rules/oracle-db.md`: the DAO layer, column constants, schema registry
- `.claude/rules/testing.md`: `BaseDB`, ordering, `StateManager`, factories, TestRail
- `.claude/rules/new-module.md`: scaffolding a module
- `.claude/rules/security.md`: secrets and gitignored files
