# smoke-tests-writer Skill

Code-only smoke test writer. Takes a test case specification document produced by the
`smoke-test-cases` skill (or a manually written equivalent) and produces exactly the 3-file smoke
test implementation that matches the project's established patterns. **No research is done here —
all facts come from the spec.** Enters plan mode, gets approval, then writes and verifies.

**Trigger:** `Write smoke tests for <module>` (or similar).

---

## Hard rules

1. **Spec required.** Ask for the path to the test case specification document before doing
   anything else. Never start from scratch or from memory — the spec is the source of truth.
2. **No research.** Do not connect to Oracle MCP, Confluence, or Jira. All DB object names, enum
   values, endpoint paths, schema fields, and state threading order come from the spec document.
   If the spec is missing a fact, stop and ask the user to update the spec first.
3. **Reuse before creating.** Check the Phase 1 reuse inventory before adding any fixture, schema
   dict, client method, or constant. Only add new code when the inventory confirms it's absent.
4. **No code before plan approval.** All implementation happens after `ExitPlanMode`.
5. **Smoke = read-only.** Only GET methods. If the spec lists a non-GET endpoint, skip it with a
   comment. If the user asks to add one, refuse and explain why.
6. **Verify by running.** Show actual `py_compile` and `pytest --collect-only` output before
   declaring done.

---

## Phase 1 — Read the spec and local ground truth

1. Read the test case specification document in full (path provided by user).
2. `tests/smoke/conftest.py` — build fixture inventory: which `*_api_client` and
   `*_state_manager` fixtures already exist for this module.
3. The nearest existing smoke module in the same domain — read all 3 of its test files as a
   live pattern reference. (e.g., for `loss_mitigation/recon`, read `loss_mitigation/repo` files.)
4. `api/<module>_client.py` — which GET methods already exist.
5. `tests/commons/api_schemas/<module>_schemas.py` — which schema dicts already exist.
6. `tests/commons/db_schema.py` — which DB schema constants are already defined for this module.
7. `tests/constants.py` — relevant column/status constants already defined.
8. `tests/conftest.py` — current `file_order` list; find the right insertion point for new files.
9. `tests/unifi/conftest.py` — `parse_schema_qualified_object` (import needed for cross-schema objects).

Build a **reuse inventory** (not shown to user unless asked):
- Existing smoke fixtures for this module
- Existing schema dict functions
- Existing GET client methods
- Existing DB schema constants
- `file_order` insertion point

Every "New" item in the plan must be absent from this inventory.

---

## Phase 2 — Enter plan mode (`EnterPlanMode`)

Phases 3–4 happen inside plan mode.

---

## Phase 3 — Map spec to implementation

Work through each section of the spec and determine the exact code required.

### DB connectivity file

From the spec's "DB Connectivity" test cases table:

- Build `TABLES` list:
  ```python
  TABLES = [
      pytest.param(ModuleTables.FOO, "Group Label", id="snake_id"),
      pytest.param((ModuleTables.BAR, Schemas.FHF_DOC), "Cross-Schema", id="bar_id"),
  ]
  ```
  Single-schema tables: plain constant string. Cross-schema: `(CONSTANT, Schemas.SCHEMA_NAME)` tuple.

- Build `VIEWS` list: same pattern.

- Queryability checks: spec column "Extra Check = Queryable (ROWNUM<=1)" → add a dedicated test method
  using `assert_query_results_found`.

- Procedure/package validity: spec column "Extra Check = STATUS=VALID" → parametrize with
  `ALL_OBJECTS WHERE OBJECT_TYPE='PROCEDURE' AND STATUS='VALID'`.

- Package body: separate parametrize entry with `OBJECT_TYPE='PACKAGE BODY'`.

- Trigger ENABLED/DISABLED: `ALL_TRIGGERS WHERE TRIGGER_NAME=... AND STATUS='DISABLED'`.

- Queue distribution function: `SELECT * FROM TABLE(PKG_QUEUE_MANAGEMENT.FN_VERIFY_QUEUE_DISTRIBUTION(:dept, :region))`
  with one test per region and non-null column assertions.

### Master data file (omit entirely if spec's Master Data section is empty or says "N/A")

From the spec's "Master Data" test cases table:

- Module-level `EXPECTED_*` dict per enum — keys AND display names from spec's "Expected Keys" column:
  ```python
  EXPECTED_ACTION_KEYS = {
      "CLOSE_REPO": "Close Repo",
      "NO_ACTION": "No Action",
  }
  ```

- `pytest.param(TABLE, KEY_COL, NAME_COL, expected_dict, id=...)` parametrize list per profile group.

- Two test methods per profile group:
  1. Set match + name + IS_ACTIVE=1 validation → `assert_set_matches_expected` + inline loop + `attach_json`
  2. Required-columns not-null → `assert_required_fields_not_null`

### API health file

From the spec's "API Health" test cases table:

- One class per logical endpoint group (list → detail endpoint chain = two classes, same file).
- Class ordering: `@pytest.mark.order(N)` is continuous across classes within the file.
- HAR order column drives the class/method sequence — do not reorder.

For each endpoint row:
- If "Client Method = EXISTS": use it as-is, do not add a new one.
- If "Client Method = NEW": add to `api/<module>_client.py` in Phase 5.
- If "Schema Function = EXISTS": import and use it.
- If "Schema Function = NEW": add to `api_schemas/<module>_schemas.py` in Phase 5.
- If "State Stored As" is populated: add `state_manager.set(key, value)` at end of test.
- If "State Read From" is populated: read from `state_manager.get(key)` at start of test.
- If "Count Parity = YES": add count query + `assert_counts_match` + `attach_count_comparison_table`.
- Add `pytest.skip(...)` guard when the spec notes a status-filter dependency on live data.

### New code inventory

List every item that the Phase 1 inventory confirms is absent:
- DB schema constant class/field in `tests/commons/db_schema.py`
- Column/status constant in `tests/constants.py`
- Schema dict function in `tests/commons/api_schemas/<module>_schemas.py`
- GET client method in `api/<module>_client.py`
- Fixture in `tests/smoke/conftest.py`

If the inventory has nothing to add: state that explicitly — "No new code required beyond the 3 test
files and file_order registration."

---

## Phase 4 — Write the plan, then `ExitPlanMode`

```
## Smoke Test Writer Plan: <Module>
## Spec: <path to spec document>

### Files to create / modify
| File | Action | What changes |
|------|--------|-------------|
| tests/smoke/<domain>/test_<module>_db_connectivity.py | CREATE | N tables, M views, K procedure checks |
| tests/smoke/<domain>/test_<module>_master_data.py | CREATE or SKIP | <reason if skip> |
| tests/smoke/<domain>/test_<module>_api_health.py | CREATE | N endpoint groups, M total test methods |
| tests/smoke/<domain>/__init__.py | CREATE | empty — new subdirectory |
| tests/smoke/conftest.py | MODIFY | add <X> fixtures |
| tests/conftest.py | MODIFY | add 3 files to file_order |
| api/<module>_client.py | MODIFY or NO CHANGE | add <X> GET methods |
| tests/commons/api_schemas/<module>_schemas.py | MODIFY or NO CHANGE | add <X> schema dicts |
| tests/commons/db_schema.py | MODIFY or NO CHANGE | add <X> constants |

### DB connectivity test cases
| Class | Method order | Test name | Parametrize? | Assertion |
...

### Master data test cases
| Class | Method order | Test name | Table | Filter | n expected values | Assertions |
...

### API health test cases
| Class | Method order | Test name | Endpoint | Params source | State stored? | Schema fn | Count? |
...

### New code (justified against Phase 1 inventory)
- <item> in <file> — <why it doesn't already exist>
- (or: No new code required beyond test files and file_order.)
```

---

## Phase 5 — Implementation (only after plan approval)

Write in this strict order:

1. New DB schema constants in `tests/commons/db_schema.py`
2. New column/status constants in `tests/constants.py`
3. New schema dict functions in `tests/commons/api_schemas/<module>_schemas.py`
4. New GET methods in `api/<module>_client.py`
5. New fixtures in `tests/smoke/conftest.py`
6. `tests/smoke/<domain>/__init__.py` — empty file, only if subdirectory is new
7. `tests/smoke/<domain>/test_<module>_db_connectivity.py`
8. `tests/smoke/<domain>/test_<module>_master_data.py` — omit if spec says none
9. `tests/smoke/<domain>/test_<module>_api_health.py`
10. Add the 3 new files to `file_order` in `tests/conftest.py` (db_connectivity → master_data → api_health)

---

## Exact code conventions — do not deviate

These are extracted from the live codebase. Match them exactly.

### File-level ordering markers
```python
pytestmark = pytest.mark.order(0)   # db_connectivity files
pytestmark = pytest.mark.order(1)   # master_data files
pytestmark = pytest.mark.order(2)   # api_health files
```

### Standard imports (db_connectivity)
```python
import pytest
import allure
from tests.conftest import BaseDB
from tests.commons.assertions import assert_table_existence, assert_query_results_found
from tests.commons.db_schema import Schemas, <ModuleTables>, <ModuleViews>
from tests.unifi.conftest import parse_schema_qualified_object
```

### Standard imports (master_data)
```python
import pytest
import allure
from reports.helper import attach_json
from tests.conftest import BaseDB
from tests.commons.assertions import assert_set_matches_expected, assert_required_fields_not_null
from tests.commons.db_schema import Schemas, <ModuleTables>
```

### Standard imports (api_health)
```python
import random
import pytest
import logging
import allure
from reports.helper import attach_count_comparison_table, attach_schema_validation_table
from tests.conftest import BaseDB
from tests.commons.assertions import (
    assert_response_status, assert_response_time,
    assert_response_with_items, assert_response_schema,
    assert_required_fields_not_null, assert_counts_match,
)
from tests.commons.api_schemas.<module>_schemas import get_<endpoint>_schema
from tests.commons.db_schema import Schemas, <ModuleViews>

logger = logging.getLogger(__name__)
```

### Class decorator pattern
```python
@allure.parent_suite("Smoke Tests")
@allure.suite("Database Connectivity")   # "Master Data" / "API Health"
@allure.sub_suite("<Descriptive Subtitle>")
class TestSmoke<Module><Group>(BaseDB):
    schema = Schemas.FIRSTHELP_COLL      # class-level attribute, not __init__
```

### Table/view existence test
```python
TABLES = [
    pytest.param(ModuleTables.FOO, "Module Core", id="lm_foo_tracker"),
    pytest.param((ModuleTables.BAR, Schemas.FHF_DOC), "Cross-Schema", id="bar_table"),
]

@pytest.mark.order(1)
@pytest.mark.parametrize("table, group", TABLES)
def test_<module>_tables_exist(self, table, group):
    obj_label = table if isinstance(table, str) else table[0]
    allure.dynamic.title(f"[{group}] Verifying existence of table: {obj_label}")
    assert_table_existence(self, parse_schema_qualified_object(table), object_name="table")
```

### Queryability check
```python
@pytest.mark.order(3)
def test_<view>_is_queryable(self):
    allure.dynamic.title("Verifying <VIEW_NAME> is queryable")
    query = f"SELECT * FROM {self.schema}.<VIEW_NAME> WHERE ROWNUM <= 1"
    _, results = self.execute_query(query, {})
    assert_query_results_found(results, "<VIEW_NAME> returned no rows")
```

### Procedure validity check
```python
@pytest.mark.order(4)
@pytest.mark.parametrize("procedure", [
    pytest.param("PR_LM_DSHBRD_CLOSE_REPO", id="pr_lm_dshbrd_close_repo"),
])
def test_<module>_procedures_exist_and_valid(self, procedure):
    allure.dynamic.title(f"Verifying existence and VALID status of procedure: {procedure}")
    query = """
        SELECT OBJECT_NAME FROM ALL_OBJECTS
        WHERE OWNER = :owner AND OBJECT_NAME = :name
          AND OBJECT_TYPE = 'PROCEDURE' AND STATUS = 'VALID'
    """
    _, results = self.execute_query(query, {"owner": self.schema, "name": procedure})
    assert_query_results_found(results, f"Procedure {procedure} does not exist or is not VALID")
```

### Package spec + body validity check (two separate parametrize entries)
```python
@pytest.mark.parametrize("object_type", [
    pytest.param("PACKAGE", id="package_spec"),
    pytest.param("PACKAGE BODY", id="package_body"),
])
def test_<package>_is_valid(self, object_type):
    allure.dynamic.title(f"Verifying existence and VALID status of {object_type}: <PKG_NAME>")
    query = """
        SELECT OBJECT_NAME FROM ALL_OBJECTS
        WHERE OWNER = :owner AND OBJECT_NAME = :name
          AND OBJECT_TYPE = :object_type AND STATUS = 'VALID'
    """
    _, results = self.execute_query(
        query, {"owner": self.schema, "name": "<PKG_NAME>", "object_type": object_type}
    )
    assert_query_results_found(results, f"<PKG_NAME> ({object_type}) does not exist or is not VALID")
```

### Queue distribution function check
```python
NON_NULL_COLUMNS = ("USR_PERCENTAGE", "INDIVIDUAL_COUNT", "PERCENTAGE", "WEIGHT", "LAST_QUEUED_ID")

@pytest.mark.parametrize("region", [
    pytest.param("EAST_REGION_ATLANTIC", id="east_region_atlantic"),
    pytest.param("CENTRAL_REGION_HEARTLAND", id="central_region_heartland"),
    pytest.param("WEST_REGION_PACIFIC", id="west_region_pacific"),
])
def test_fn_verify_queue_distribution_is_callable(self, region):
    allure.dynamic.title(f"Verify fn_verify_queue_distribution is callable for <DEPT>/{region}.")
    query = f"""
        SELECT * FROM TABLE(
            {self.schema}.PKG_QUEUE_MANAGEMENT.FN_VERIFY_QUEUE_DISTRIBUTION(:dept, :region)
        )
    """
    with allure.step(f"Call fn_verify_queue_distribution('<DEPT>', '{region}')"):
        _, results = self.execute_query(query, {"dept": "<DEPT>", "region": region})
    assert results, f"fn_verify_queue_distribution returned no rows for <DEPT>/{region}."
    failures = [
        f"row {i} column '{col}' is null"
        for i, row in enumerate(results)
        for col in self.NON_NULL_COLUMNS
        if row.get(col) is None
    ]
    assert not failures, "\n".join(failures)
```

### Master data test (profile table pattern)
```python
EXPECTED_FOO_ACTIONS = {
    "ACTION_KEY_A": "Display Name A",
    "ACTION_KEY_B": "Display Name B",
}

FOO_PROFILES = [
    pytest.param(
        ModuleTables.ACTION_PROFILE, "ACTION_KEY", "ACTION_NAME",
        EXPECTED_FOO_ACTIONS, id="action_profile",
    ),
]

@pytest.mark.order(1)
@pytest.mark.parametrize("table, key_col, name_col, expected", FOO_PROFILES)
def test_expected_foo_rows_exist(self, table, key_col, name_col, expected):
    allure.dynamic.title(f"Verify {table} has exactly {len(expected)} IS_FOO=1 rows.")
    with allure.step(f"Query database for IS_FOO=1 rows in {table}"):
        query = f"""
            SELECT {key_col}, {name_col}, IS_ACTIVE, CREATED_AT
            FROM {self.schema}.{table}
            WHERE IS_FOO = 1 ORDER BY {key_col}
        """
        _, results = self.execute_query(query, {})
        db_keys = [row.get(key_col) for row in results]
    assert_set_matches_expected(db_keys, expected.keys(), f"{table} keys")
    with allure.step(f"Validate {name_col} and IS_ACTIVE=1 for each expected row"):
        by_key = {row[key_col]: row for row in results}
        for key, expected_name in expected.items():
            row = by_key[key]
            assert row[name_col] == expected_name, (
                f"{name_col} mismatch for {key}: expected '{expected_name}', got '{row[name_col]}'"
            )
            assert int(row["IS_ACTIVE"]) == 1, f"Expected IS_ACTIVE=1 for {key}, got {row['IS_ACTIVE']}"
    attach_json(results, f"{table} rows (IS_FOO=1)")

@pytest.mark.order(2)
@pytest.mark.parametrize("table, key_col, name_col, expected", FOO_PROFILES)
def test_required_columns_not_null(self, table, key_col, name_col, expected):
    allure.dynamic.title(f"Verify {table} required columns are never null")
    query = f"SELECT {key_col}, {name_col}, IS_ACTIVE, CREATED_AT FROM {self.schema}.{table}"
    _, results = self.execute_query(query, {})
    required_schema = {key_col: str, name_col: str, "IS_ACTIVE": int, "CREATED_AT": str}
    assert_required_fields_not_null(results, required_schema, table)
```

### API health list endpoint (with state storage and count parity)
```python
@pytest.mark.order(1)
def test_get_foo_accounts(self, foo_api_client, foo_state_manager, response_time_threshold_config):
    allure.dynamic.title("Verify foo accounts returns 200 OK within response time threshold.")

    with allure.step("Call GET Foo Accounts endpoint"):
        response = foo_api_client.get_foo_accounts(params={"limit": 100})

    assert_response_status(response, 200)
    assert_response_time(response, response_time_threshold_config("foo"))

    items = assert_response_with_items(response)
    foo_state_manager.set("foo_accounts_items", items)

    # Status filter for detail endpoint dependency — only store if eligible data exists
    eligible = [item for item in items if item.get("foo_status_key") in STATUS_KEYS_WITH_DATA]
    if not eligible:
        pytest.skip("No foo accounts with eligible status; cannot test detail endpoints.")
    foo_state_manager.set("foo_selected_account", random.choice(eligible))

    logger.info(f"Foo accounts healthy (elapsed: {response.elapsed.total_seconds():.2f}s)")

@pytest.mark.order(2)
def test_get_foo_accounts_schema(self, foo_state_manager):
    allure.dynamic.title("Validate the response schema for foo accounts.")
    items = foo_state_manager.get("foo_accounts_items")
    schema = get_foo_accounts_schema()
    assert_response_schema(items[0], schema)
    assert_required_fields_not_null(items, schema, "foo accounts")
    attach_schema_validation_table(schema, items[0], "Foo Accounts")

@pytest.mark.order(3)
def test_foo_accounts_count_matches_db(self, foo_state_manager):
    allure.dynamic.title("Validate foo accounts total count matches API vs DB.")
    items = foo_state_manager.get("foo_accounts_items")
    with allure.step("Read total_rows from API response"):
        api_count = items[0]["total_rows"]
    with allure.step("Query database count"):
        query = f"SELECT COUNT(*) AS COUNT FROM {Schemas.FIRSTHELP_COLL}.<VIEW>"
        _, results = self.execute_query(query, {})
        db_count = results[0]["COUNT"] if results else 0
    assert_counts_match(api_count, db_count, "Foo Accounts")
    attach_count_comparison_table(api_count, db_count, "Foo Accounts Count Integrity")
```

### API health detail endpoint (reads from state)
```python
@pytest.mark.order(4)
def test_get_foo_detail(self, foo_api_client, foo_state_manager, response_time_threshold_config):
    allure.dynamic.title("Verify foo detail returns 200 OK within response time threshold.")
    selected = foo_state_manager.get("foo_selected_account")

    with allure.step("Call GET Foo Detail endpoint"):
        response = foo_api_client.get_foo_detail(selected["foo_status_key"], selected["tracker_id"])

    assert_response_status(response, 200)
    assert_response_time(response, response_time_threshold_config("foo"))
    items = assert_response_with_items(response)
    foo_state_manager.set("foo_detail_items", items)

@pytest.mark.order(5)
def test_get_foo_detail_schema(self, foo_state_manager):
    allure.dynamic.title("Validate the response schema for foo detail.")
    items = foo_state_manager.get("foo_detail_items")
    schema = get_foo_detail_schema()
    assert_response_schema(items[0], schema)
    assert_required_fields_not_null(items, schema, "foo detail")
    attach_schema_validation_table(schema, items[0], "Foo Detail")
```

### Fixtures in `tests/smoke/conftest.py` (append to existing file)
```python
@pytest.fixture(scope="module")
def foo_api_client(session, base_url):
    from api.foo_client import FooClient
    return FooClient(session, base_url)

@pytest.fixture(scope="module")
def foo_state_manager():
    return BaseStateManager()
```

### Schema dict in `tests/commons/api_schemas/<module>_schemas.py`
```python
def get_foo_accounts_schema():
    return {
        "required_str_field": str,
        "required_int_field": int,
        "nullable_str_field": (str, type(None)),
        "nullable_numeric": (int, float, type(None)),
    }
```

### GET client method in `api/<module>_client.py`
```python
def get_foo_accounts(self, **kwargs) -> requests.Response:
    return self.get("FOO_ACCOUNTS_ENDPOINT", **kwargs)

def get_foo_detail(self, status_key: str, tracker_id: int, **kwargs) -> requests.Response:
    return self.get_path(
        "FOO_DETAIL_ENDPOINT",
        {"status_key": status_key, "tracker_id": tracker_id},
        **kwargs
    )
```
