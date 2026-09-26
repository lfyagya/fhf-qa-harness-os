---
name: generate-conftest
description: Generate a backend module conftest.py with the schema dataclass, state manager and module-scoped API client fixture. Use when scaffolding a new backend test module.
---
# generate-conftest Skill

Generate `conftest.py` with schema dataclass and 3 required fixtures for a test module.

## Input

```
--module-name <name>        Required: snake_case module name (payment_processing, audit_logging)
--module-type <type>        Required: feature | invoice | dashboard
--tables <table1,table2>     Optional: comma-separated table names (PAYMENT_TRANSACTION,STATUS)
```

## Process

1. **Validate module name** — snake_case only, length 5-50 chars
2. **Derive naming** — snake_case → CamelCase (payment_processing → PaymentProcessing)
3. **Determine location** — top-level or ancillary?
4. **Build schema dataclass** — if tables provided, include imports from db_schema.py
5. **Generate fixtures** — 3 required: schema, state_manager, api_client
6. **Write file** — `tests/{module_name}/conftest.py`

## Output

**File:** `tests/{module_name}/conftest.py`

```python
import pytest
from dataclasses import dataclass
from tests.commons.db_schema import BaseSchema, Schemas, <Module>Tables, <Module>Views
from api.<module_name>_client import <ModuleName>Client
from tests.conftest import BaseStateManager

@dataclass
class <ModuleName>SchemaConstants(BaseSchema):
    """Schema, table and view names for <module_name> tests."""

    table_<name>: str = <Module>Tables.<NAME>   # one field per table/view the module uses
    view_<name>: str = <Module>Views.<NAME>

@pytest.fixture(scope="module")
def <module_name>_schema():
    """Provides centralized schema and table name constants."""
    return <ModuleName>SchemaConstants()

@pytest.fixture(scope="module")
def <module_name>_state_manager():
    """Module-scoped state manager for <module_name> tests."""
    return BaseStateManager()

@pytest.fixture(scope="module")
def <module_name>_api_client(session, base_url) -> <ModuleName>Client:
    """Typed HTTP client for all <module_name> endpoints."""
    return <ModuleName>Client(session, base_url)
```

## Key Rules

✓ Always import BaseSchema from tests.commons.db_schema  
✓ Always import BaseStateManager from tests.conftest  
✓ 3 required fixtures: schema, state_manager, api_client (module-scoped)  
✓ Schema dataclass inherits from BaseSchema (provides schema_firsthelp_coll)  
✓ Fixture names follow pattern: `{module_name}_{resource}` (snake_case)  
✓ If tables provided, import from db_schema.py (e.g., `<Module>Tables.TABLE_NAME`)  
✗ Don't add template test methods or commented examples  
✗ Don't hardcode table/view names (use db_schema.py constants)  

## User Notes

- **After generation:** User edits conftest.py to add actual table/view names from db_schema.py
- **Reference:** See tests/loss_mitigation/repo_invoice/conftest.py, tests/ancillary/ancillary_cancellation_dashboard/conftest.py
- **Smoke modules:** don't write fixture bodies — add one `_client(...)` / `_state(...)` line to the registry in `tests/smoke/conftest.py` (`.claude/rules/api-standards.md`)
- **Next step:** Use `/generate-api-client` and `/generate-test-file` skills for other boilerplate

## Example

```bash
/generate-conftest --module-name payment_processing --module-type feature --tables PAYMENT_TRANSACTION,PAYMENT_STATUS
```

Output: `tests/payment_processing/conftest.py` created with empty schema dataclass ready for user to fill in table/view names.
