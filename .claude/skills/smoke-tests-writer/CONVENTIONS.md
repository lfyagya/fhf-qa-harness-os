# smoke-tests-writer — Exact code conventions

These are extracted from the live codebase. Match them exactly. Read this file during Phase 5
(implementation) — not needed for planning.

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
