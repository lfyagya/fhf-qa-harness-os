---
name: setup-test-module
description: Scaffold a complete backend test module - directory, conftest, API client, data builder and first test file. Use when starting backend automation for a module that has none.
---
# Setup Test Module Skill

## 1. Name + Trigger

**Skill Name**: `setup-test-module`

**Trigger Command**:
```bash
/setup-test-module --module-name <name> --type <type> [--description <desc>]
```

**Aliases**: `/new-module`, `/create-test-module`

**Description**: 
Automates creation of a new test module with complete boilerplate code. Generates an API client, conftest.py with required fixtures (schema, state manager, API client), data builder factory, test file template, and optional updates to db_schema.py and the `file_order` list in tests/conftest.py. All generated files follow project conventions and are immediately usable—users add endpoint methods, factory implementations, and test cases after reviewing the setup structure.

---

## 2. When to Use This Skill

**Use this skill when:**
- Adding a new feature module to the test framework (payment processing, reporting, new dashboard, etc.)
- You need to create consistent boilerplate across API client, conftest, data builder, and test files
- You want to eliminate manual folder/file creation and naming errors
- You're following the multi-step test patterns (setup → creation → approval flow → denial flow)
- Your module will interact with the Oracle DB and require state sharing between ordered tests

**Do NOT use this skill when:**
- You're adding tests to an existing module (use the existing conftest and data builders instead)
- Your module has no API client or DB access (consider simpler test structure)
- You need to refactor or reorganize an existing module (handle manually to preserve test data)

---

## 3. Step-by-Step Process

### Phase 1: Input & Validation

**Step 1.1: Gather Module Information**
- Prompt user for:
  - **Module Name** (snake_case, e.g., "payment_processing")
  - **Module Type** (feature / invoice / dashboard)
  - **Description** (optional, for docstrings)
  - **Endpoints** (list of endpoint names the module will need)
  - **Database Tables** (optional, primary tables accessed)

**Step 1.2: Validate Inputs**
- Check module name is valid snake_case
- Verify module doesn't already exist
- Validate module type is one of: feature, invoice, dashboard
- Ensure endpoint names are valid (SCREAMING_SNAKE_CASE)

**Step 1.3: Derive Naming Conventions**
- Convert module_name to CamelCase for class names (e.g., `PaymentProcessing` → `PaymentProcessingClient`)
- Create fixture names in snake_case (e.g., `payment_processing_api_client`)
- Create schema constant class names (e.g., `PaymentProcessingSchemaConstants`)

### Phase 2: Create Folder Structure

**Step 2.1: Create Test Module Folder**
```
tests/<module_name>/
├── conftest.py          (created with boilerplate)
└── test_<module_name>.py (created with test class template)
```

**Step 2.2: Create Supporting Folders**
- Ensure `api/` folder exists (always exists in this project)
- Ensure `tests/commons/data_builder/` folder exists (always exists)

**Step 2.3: Create Data Builder Subfolder** (if module has related modules)
- For ancillary modules: `tests/ancillary/<module_name>/`
- For invoice modules: `tests/<module_name>/` at root level

### Phase 3: Generate API Client

**Step 3.1: Create API Client File**
- File: `api/<module_name>_client.py`
- Content includes:
  - Imports: `requests`, `BaseAPIClient`
  - Class: `<ModuleName>Client(BaseAPIClient)` with docstring
  - No template methods - user implements endpoints as needed

**Step 3.2: Code Structure**
- The file provides the class structure and inheritance setup
- User adds methods following existing project patterns (e.g., `APDClient`, `RepoInvoiceClient`)
- Users reference for patterns:
  - GET endpoints: `self.get("ENDPOINT_NAME", **kwargs)`
  - POST endpoints: `self.post("ENDPOINT_NAME", json=payload)`
  - PUT endpoints: `self.put("ENDPOINT_NAME", json=payload)`
  - Path parameters: `self.get_path("ENDPOINT_NAME", {"id": id})`
  - Multiple segments: `self.get_with_path("ENDPOINT_NAME", segment1, segment2)`

### Phase 4: Generate conftest.py

**Step 4.1: Create Schema Constants Dataclass**
- Extends `BaseSchema` (which provides `schema_firsthelp_coll`)
- Includes fields for:
  - Schema names: `schema_<name>: str = Schemas.<NAME>`
  - Table names: `table_<name>: str = <ModuleTables>.<TABLE>`
  - View names: `view_<name>: str = <ModuleViews>.<VIEW>`
- Import from `tests.commons.db_schema`:
  - `BaseSchema`
  - `Schemas` (FIRSTHELP_COLL, FIRSTHELP_LETTERS, FHF_DOC)
  - `SharedTables` (if using shared tables)
  - Relevant table/view classes from `db_schema.py`

**Step 4.2: Create Module Fixtures**
Create three essential module-scoped fixtures:
1. Schema fixture - returns `<Module>SchemaConstants()`
2. State Manager fixture - returns `BaseStateManager()`
3. API Client fixture - returns `<Module>Client(session, base_url)`

No template methods or commented-out examples. Just the required fixtures for:
- Schema constants (imported from `db_schema.py`)
- State management for test data sharing
- Typed HTTP client for API calls

### Phase 5: Generate Data Builder

**Step 5.1: Create Data Builder File**
- File: `tests/commons/data_builder/<module>.py`
- Content includes:
  - Imports: `Faker`, typing annotations
  - Class: `<Module>Factory()` with essential factory class structure
  - No template methods - user implements as needed

### Phase 6: Generate Test File Template

**Step 6.1: Create Initial Test File**
- File: `tests/<module_name>/test_<module_name>.py`
- Content includes:
  - Essential imports
  - Allure decorators: `@allure.parent_suite`, `@allure.suite`
  - Test class: `Test<Module>` extending `BaseDB`
- No template test methods - just the class structure ready for user to implement tests

### Phase 7: Update Project Configuration

**Step 7.1: Update db_schema.py** (if needed)
- Add new table/view classes to `tests/commons/db_schema.py`:
  ```python
  class <Module>Tables:
      """Tables for <Module>."""
      TABLE1 = "TABLE_NAME_1"
      TABLE2 = "TABLE_NAME_2"
  
  class <Module>Views:
      """Views for <Module>."""
      VIEW1 = "VIEW_NAME_1"
  ```

**Step 7.2: Update conftest.py file_order** (if module is top-level)
- Add `tests/<module_name>/test_<module_name>.py` to `file_order` list in `tests/conftest.py`

**Step 7.3: Endpoint env vars** (if needed)
- `tests/.env` is gitignored and holds credentials — never read or print it. Tell the user which
  endpoint vars to add, and add the placeholder to `tests/example_env`:
  ```env
  ENDPOINT_NAME_ENDPOINT=/path/to/endpoint
  ```

### Phase 8: Provide User Checklist

**Step 8.1: Generate Completion Summary**
```
 Completed:
  ✓ Created tests/<module_name>/ folder
  ✓ Created api/<module_name>_client.py
  ✓ Created tests/<module_name>/conftest.py
  ✓ Created tests/commons/data_builder/<module_name>.py
  ✓ Created tests/<module_name>/test_<module_name>.py
  ✓ Updated tests/commons/db_schema.py (if needed)

📝 Next Steps:
  1. [ ] Review generated folder structure and files
  2. [ ] Add table/view names to conftest.py schema constants
  3. [ ] Define endpoint env vars in tests/.env
  4. [ ] Implement API client methods in api/<module_name>_client.py
  5. [ ] Implement factory methods in data builder
  6. [ ] Create test fixtures in conftest.py (beyond the 3 essential ones)
  7. [ ] Write test methods in test_<module_name>.py
  8. [ ] Run tests to verify setup: pytest tests/<module_name>/ --order-scope=module
  9. [ ] Add module to file_order in tests/conftest.py (if top-level module)
```

---

## 4. Reference Files

### Key Files Referenced

| File | Purpose | Usage |
|------|---------|-------|
| `tests/commons/db_schema.py` | Centralized DB object registry | Import table/view classes, add new ones |
| `tests/conftest.py` | Global test configuration | Add module to file_order, reference BaseStateManager |
| `tests/.env` | Environment variables (gitignored) | Add endpoint paths and credentials |
| `api/base_client.py` | Base HTTP client class | Parent class for all API clients |
| `tests/conftest.py` BaseStateManager | State management for tests | Use in module conftest fixtures |
| `tests/commons/data_builder/shared.py` | Shared factory base classes | Extend for module-specific factories |
| `tests/commons/assertions.py` | Assertion helpers | Use in tests for validations |

--

## 5. Rules & Standards

See `.claude/rules/testing.md` for comprehensive rules, including **Setup Test Module Skill Rules** section with Do's (Naming, Imports, API Clients, Schema, DB, Code, Fixtures) and Don'ts (no templates, no hardcoding, no relative imports, no raw sessions, etc.).

---


## Appendix: Quick Reference


### File Checklist Post-Setup

After running the skill, verify these files exist:

- [ ] `tests/<module_name>/__init__.py`
- [ ] `tests/<module_name>/conftest.py`
- [ ] `tests/<module_name>/test_<module_name>.py`
- [ ] `api/<module_name>_client.py`
- [ ] `tests/commons/data_builder/<module_name>.py`

### Next Steps Checklist

- [ ] Review all generated files
- [ ] Add table/view names to schema dataclass
- [ ] Define endpoints in `tests/.env`
- [ ] Implement factory methods
- [ ] Create test fixtures
- [ ] Write test methods
- [ ] Run: `pytest tests/<module_name>/ --order-scope=module`
- [ ] Update `tests/conftest.py` file_order (if top-level module)

---

**End of SKILL.md**
