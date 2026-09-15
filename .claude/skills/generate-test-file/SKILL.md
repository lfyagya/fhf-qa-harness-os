---
name: generate-test-file
description: Generate a backend pytest test file inheriting BaseDB with ordered tests and shared assertion helpers. Use when adding backend tests to an existing module.
---
# generate-test-file Skill

Generate `tests/{module}/test_{module}.py` with `BaseDB` test class template and Allure decorators.

## Input

```
--module-name <name>        Required: snake_case module name (payment_processing)
--module-type <type>        Required: feature | invoice | dashboard
```

## Process

1. **Validate inputs** — module_name is snake_case, type is valid
2. **Derive naming** — payment_processing → PaymentProcessing → TestPaymentProcessing
3. **Generate test class** — extends BaseDB, includes Allure decorators
4. **Create __init__.py** — `tests/{module_name}/__init__.py` (empty)
5. **Write files** — test_file.py and __init__.py
6. **Set order marker** — `pytestmark = pytest.mark.order(1)`

## Output

**File:** `tests/{module_name}/test_{module}.py`

```python
import pytest
import allure
import logging
from tests.conftest import BaseDB
from tests.commons.assertions import (
    assert_response_status,
    assert_response_time,
    assert_api_db_sync,
    assert_response_schema,
)

logger = logging.getLogger(__name__)
pytestmark = pytest.mark.order(1)

@allure.parent_suite("Automation E2E Tests")
@allure.suite("<Module> Tests")
class Test<Module>(BaseDB):
    """Test class for verifying <module_name> functionality."""
    
    # Add test methods here
    # Pattern:
    # def test_<scenario>(self, <module_name>_api_client, <module_name>_schema):
    #     """[C<id>] Test description."""
    #     # Arrange: setup data
    #     # Act: call API via client
    #     # Assert: validate response + DB state
```

**File:** `tests/{module_name}/__init__.py` (empty)

## Key Rules

✓ Inherit from BaseDB (provides DB connection management via setup_class/teardown_class)  
✓ Use module fixture: `{module_name}_api_client` for all API calls  
✓ Use module fixture: `{module_name}_schema` for table/view names  
✓ Use module fixture: `{module_name}_state_manager` for sharing data between ordered tests  
✓ Include Allure decorators: @allure.parent_suite, @allure.suite  
✓ Use @pytest.mark.order(N) for test sequencing (1=first, 2=second, etc.)  
✓ Import assertions from tests.commons.assertions (never raw assert)  
✓ Include TestRail case ID in docstring: `"""[C1234] Test description."""`  
✓ Set pytestmark for global ordering  
✗ Don't add placeholder test methods (user adds them)  
✗ Don't use raw requests.Session (use {module_name}_api_client fixture)  
✗ Don't hardcode table/view names (use {module}_schema fixture)  
✗ Don't skip logging (include logger setup)  

## Test Method Pattern

```python
@pytest.mark.order(1)
def test_create_payment(self, payment_processing_api_client, payment_processing_schema):
    """[C1001] Create new payment and verify DB state."""
    # Arrange
    payload = PaymentProcessingFactory.create_payment_payload(
        application_id=12345,
        amount=500,
    )
    
    # Act
    response = payment_processing_api_client.create_payment(payload)
    
    # Assert
    assert_response_status(response, 201)
    columns, result = self.execute_query(
        f"SELECT * FROM {payment_processing_schema.table_payment_transaction} WHERE id = ?",
        [response.json()["payment_id"]]
    )
    assert result[0]["AMOUNT"] == 500
```

## User Notes

- **Fixtures provided:** By setup-test-module agent or manual conftest.py
- **DB access:** Via `self.execute_query(query, params)` from BaseDB
- **Assertion helpers:** See tests/commons/assertions.py
- **Test ordering:** Use @pytest.mark.order(N) to sequence multi-step flows
- **TestRail:** Include [C<id>] in docstring to link to test cases
- **Reference tests:** tests/repo_invoice/test_repo_invoice.py, tests/ancillary/ancillary_cancellation_dashboard/test_acd_*.py
- **Next step:** Use `/generate-data-builder` skill for test payloads

## Running Tests

```bash
pytest tests/<module_name>/ --order-scope=module -v
```

## Example

```bash
/generate-test-file --module-name payment_processing --module-type feature
```

Output: `tests/payment_processing/test_payment_processing.py` created with `TestPaymentProcessing` class, ready for user to add test methods.
