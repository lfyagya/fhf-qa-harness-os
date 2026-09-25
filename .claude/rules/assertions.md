---
paths:
  - "fhf-backend-automation/**"
---
# Assertion Standards

All assertion helpers live in `tests/commons/assertions.py`. Import only from there — never write raw `assert` statements or inline validation loops in test files.

---

## Core assertion helpers

### HTTP response

```python
assert_response_status(response, 200)             # int or tuple of ints
assert_response_time(response, 10)                # max seconds
assert_response_body(response_dict, expected, field)  # single field check
```

Every call wraps in an Allure step automatically — do not add a redundant `with allure.step(...)` around them.

### API / DB sync

```python
assert_api_db_sync(api_record, db_record, field_mapping)
```

Validates that selected API fields match their corresponding DB columns. `field_mapping` is an explicit dict so the mapping stays readable:

```python
assert_api_db_sync(
    api_record=response.json(),
    db_record=db_row,
    field_mapping={
        "invoice_status":     "INVOICE_STATUS",
        "invoice_status_key": "INVOICE_STATUS_KEY",
        "batch_id":           "BATCH_ID",
    },
)
```

**Type handling**: values are normalised before comparison — do NOT wrap either side in `str()`. The normaliser handles Oracle `NUMBER` columns returning strings, `"1"`/`"0"` booleans, and trailing whitespace automatically. Explicitly casting defeats the purpose.

### Response schema

```python
from tests.commons.assertions import assert_response_schema
from tests.commons.api_schemas.ancillary_products_dashboard_schemas import get_products_dashboard_schema

assert_response_schema(
    record=response.json()["items"][0],
    schema=get_products_dashboard_schema(),
    optional_fields={"is_dealer_under_audit"},   # fields allowed to be absent
)
```

- Always use `assert_response_schema` for field-presence and type checks — never write an inline `for field, expected_type in schema.items()` loop in a test file
- Schema dicts live in `tests/commons/api_schemas/{module}_schemas.py` (one file per module) — add new schemas there, not inline in tests
- Fields whose type is `(SomeType, type(None))` are nullable; pass them in `optional_fields` if they may also be absent from the response entirely

### DB structure

```python
assert_table_existence(db_instance, objects, object_name)
assert_column_names(db_instance, table_name, expected_columns)
assert_loan_number_existence(db_instance, loan_number, table_name)
```

`db_instance` is `self` inside a `BaseDB` test class. Pass `self` explicitly — these are module-level functions, not class methods.

### Invoice-specific

```python
assert_invoice_status_and_key(data, expected_status, expected_status_key)
```

---

## Dual validation — API + DB

Every test that modifies state MUST assert both:
1. The API response (status code, body)
2. The corresponding DB row after the write

Never assert only the HTTP response and skip the DB check.

---

## Async DB writes — `wait_for()`

If an endpoint triggers a background or async DB write, poll for the expected state before asserting:

```python
from tests.commons.wait_utils import wait_for

# Wait up to 15 s for the row to appear, then assert normally
wait_for(
    lambda: self.execute_query(query, params)[1],
    timeout=15,
    description="invoice row visible in DB after async write",
)
columns, results = self.execute_query(query, params)
assert results[0]["INVOICE_STATUS"] == "APPROVED"
```

- Default timeout is 30 s; pass `timeout=` to override
- Default poll interval is 1 s; pass `interval=` to override
- `wait_for` raises `TimeoutError` on expiry — do not catch it in tests

Do NOT add `time.sleep()` in test code to work around async writes — use `wait_for` instead.

---

## What NOT to do

```python
# Bad — raw assert
assert response.status_code == 200

# Bad — str() cast masks real type bugs
if str(api_value) != str(db_value):
    ...

# Bad — inline schema loop
for field, expected_type in schema.items():
    assert field in record
    assert isinstance(record[field], expected_type)

# Bad — sleep instead of polling
time.sleep(3)
columns, results = self.execute_query(query, params)

# Bad — calling Okta helper directly
headers = get_okta_bearer_headers()   # use the okta_bearer_headers fixture instead
```

---

## Okta authentication

- Use the `okta_bearer_headers` fixture (function-scoped, `tests/conftest.py`) for all Okta-protected endpoints
- Never call `get_okta_bearer_headers()` directly in a test

---

## Allure reporting

- Use `@allure.feature`, `@allure.story`, and `@allure.title` on test classes and methods
- Attach request body, response body, and DB record on failure for traceability
- The Allure results directory is set in `pytest.ini` — do not change it
