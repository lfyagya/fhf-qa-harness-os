# Adding a New Test Module — Checklist

Follow these steps in order when adding a new feature module to the framework.

## 1. Create the Module Directory
```
tests/<module_name>/
├── conftest.py       ← schema constants dataclass + StateManager + fixtures
└── test_<name>.py   ← test file(s)
```

## 2. Define Schema Constants in `conftest.py`
```python
from dataclasses import dataclass

@dataclass
class <Module>Schema:
    schema: str = "SCHEMA_NAME"
    table: str = "TABLE_NAME"
    view: str = "VIEW_NAME"

@pytest.fixture(scope="module")
def <module>_schema():
    return <Module>Schema()
```

## 3. Create a StateManager fixture in `conftest.py`
```python
@pytest.fixture(scope="module")
def <module>_state_manager():
    """
    Module-scoped state manager.
    """
    return BaseStateManager()

```

## 4. Inherit Test Classes from `BaseDB`
```python
from tests.conftest import BaseDB

class Test<Module>Creation(BaseDB):
    def test_create_record(self, okta_bearer_headers, <module>_schema):
        ...
```

## 5. Add Data Factory to `tests/commons/data_builder.py`
- Add a new factory class or methods under the appropriate factory
- Factory methods MUST accept `**kwargs` for field-level overrides
- Use `Faker` for dynamic fields — never hardcode test data

## 6. Add Constants to `tests/constants.py`
- Status values (e.g. `STATUS_PENDING = "PENDING"`)
- DB column name constants (e.g. `COL_RECORD_ID = "RECORD_ID"`)
- StateManager keys (e.g. `KEY_RECORD_ID = "record_id"`)

## 7. Register in Global File Order
In `tests/conftest.py`, add the new module's test files to the `file_order` list inside `pytest_collection_modifyitems`:
```python
file_order = [
    # ... existing files ...
    "tests/<module_name>/test_<name>.py",
]
```

## 8. Verify Before Pushing
```bash
# Run only the new module sequentially to verify ordering
pytest tests/<module_name>/ --order-scope=module -v

# Then run the full suite to confirm no interference with other modules
pytest tests/ --order-scope=module -v
```
