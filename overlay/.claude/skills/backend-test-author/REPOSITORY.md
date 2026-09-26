# fhf-backend-automation — Repository Guide

pytest suite covering the FHF SERV backend through its REST APIs, with Oracle (and NLS)
verification. When the repository and this guide disagree, the repository wins — fix the guide.

## Setup

Python 3.10, Oracle Instant Client on `PATH`, virtualenv at `venv/`,
`pip install -r requirements.txt` — see the repository's `README.md`. Activate the venv per shell
(`.\venv\Scripts\Activate.ps1`). Local configuration is gitignored and copied from templates:

| File | Holds | Template |
|---|---|---|
| `config/config.ini` | Oracle DB, NLS (MSSQL), email, S3 credentials | `config/example_config.ini` |
| `tests/.env` | API base URL, credentials, Okta vars, endpoint paths, TestRail settings | `tests/example_env` |

Never read these into output or commit them (`.claude/rules/security.md`). In CI
(`buildspec.yml`), `config/config.ini`, `tests/.env` and `pytest.ini` come from AWS Secrets
Manager.

## Running tests

Agents run only the in-scope test path, Dev/QA, sequentially (`.claude/rules/backend-automation.md`).

`pytest.ini` already adds `--order-scope=module`, `--dist=loadfile`, Allure results to
`allure-results/`, JUnit to `reports/junit-report.xml`, and a debug log at `reports/pytest.log`.

```bash
pytest tests/loss_mitigation/repo_invoice/            # one module
pytest tests/loss_mitigation/repo_invoice/test_x.py   # one file
pytest tests/ -k "approval"                           # by keyword
```

`scripts/testrail_integration.sh` modes: `test` (run), `upload` (JUnit to TestRail), `all` (run,
then upload), `smoke`. `scripts/testrail_sync_titles.py` syncs case titles from
`allure.dynamic.title`. **TestRail uploads, Allure publication and email reports only when the
human asks.**

No linter or formatter is configured.

## Layout

```
api/                 typed clients; every *_client.py extends BaseAPIClient (base_client.py)
  endpoint_constants.py
tests/
  conftest.py        global fixtures, BaseDB, BaseStateManager, file_order
  constants.py       status values, DB column names, state-manager keys
  commons/           assertions.py, wait_utils.py, db_schema.py, queries.py,
                     api_schemas/, data_builder/, invoice_helpers.py, utils.py
  loss_mitigation/   repo_invoice/, auction_invoice/
  ancillary/         ancillary_products_dashboard/, ancillary_cancellation_dashboard/
  unifi/             conftest.py, integration/, e2e/
  smoke/             PRODUCTION, GET-only; conftest.py registry of client and state
                     fixtures, one directory per module
dao/oracle_dao.py    get / set / batch
db/oracle.py         Oracle connection (singleton)
helpers/             okta_auth_helper, db_helper, acd_helpers, cron_helper
reports/             email report helpers, helper.py (Allure attach helpers)
util/path_utils.py   PathUtils: paths and config/config.ini
scripts/             testrail_integration.sh, testrail_sync_titles.py, apd_data_seed/
project-context/     module docs and backend automation checklists
```

## Rules

`.claude/rules/`: `api-standards.md` (typed clients, fixtures), `assertions.md` (helpers, API+DB
dual validation, `wait_for`), `oracle-db.md` (DAO, column constants, schema registry),
`testing.md` (`BaseDB`, ordering, `StateManager`, factories, TestRail), `new-module.md`
(scaffolding), `security.md` (secrets), `backend-automation.md` (scope and runs),
`prod-data-handling.md` (backend smoke evidence).
