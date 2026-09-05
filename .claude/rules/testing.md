# Testing Rules

## Test Class Structure
- ALL test classes that need DB access MUST inherit from `BaseDB` (defined in `tests/conftest.py`)
- `BaseDB` provides `setup_class`/`teardown_class` Oracle connection management and `self.execute_query(query, params)` — never re-implement this
- One `conftest.py` per feature module — never add module-specific fixtures to the global `tests/conftest.py`
- Use assertion methods from `commons/assertions.py`- never add raw assertions to the test file
- Perform assertions only in the test file, not in fixtures.

## Test Ordering
- ALWAYS run pytest with `--order-scope=module` — omitting this flag will break multi-step flows
- Global file execution order is enforced by `pytest_collection_modifyitems` in `tests/conftest.py` — add new modules there
- Within a file, use `@pytest.mark.order(N)` from `pytest-order` to sequence steps

## StateManager
- Use `StateManager` (defined per module in each `conftest.py`) to share data between ordered tests in a module- inherit from `BaseStateManager` for additional methods otherwise use the BaseStateManager
- StateManager is module-scoped — it resets automatically when the module ends; never use it for cross-module data
- Typical pattern: Test 1 creates a record and stores its ID → Test 2 retrieves it via `state.get(key)`

## Data Factories
- Use factories in `tests/commons/data_builder.py` for all test payloads — never hardcode request bodies in test files
- Keep data factories in `tests/commons/data_builder/{feature_name}.py` file 
- Keep common data factories in `tests/commons/data_builder/shared.py` file - never duplicate the payload code; instead make generic payload to be used across the tests 
- All factory methods MUST accept `**kwargs` for field-level overrides
- Use `Faker` for dynamic data generation — prevents data collisions in parallel runs

## Parallelism
- Tests run with `pytest-xdist`; the `loadfile` scheduler keeps all tests in one file on the same worker
- `--dist=loadfile` is already set in `pytest.ini` — do not override this
- Use `filelock` when reading/writing shared files like `data_files/responses.json` — never write to shared files without a lock

## TestRail Integration

Two separate mechanisms, neither of which reads a docstring:

- **Results** upload from `reports/junit-report.xml` through `trcli`
  (`./scripts/testrail_integration.sh all -n auto` runs the tests and uploads in one step).
  The JUnit `name` pytest emits is the test function name, so nothing in a docstring reaches it.
- **Titles** sync from `allure.dynamic.title` via `scripts/testrail_sync_titles.py`, which parses
  `allure-results/*.json` and updates case titles through the API. This is non-destructive.

Use `@allure.title` / `allure.dynamic.title` to give a test the name it should carry in TestRail,
and `@allure.feature` / `@allure.story` for grouping.

Do **not** add `[C<id>]` markers to docstrings. This rule previously required them, describing them
as the link between a test and its TestRail case. Verified 2026-09-05: no code in this repository
parses that marker, `trcli` never sees a docstring, and zero committed tests carry one - the
requirement had never been executable. The `tests/unifi/e2e/` carve-out that pointed at
`allure.dynamic.title` was not an exception; it was how the whole repository already works.

If a stable test-to-case identifier is wanted, it needs a real mechanism - a `trcli` case-matching
strategy or an Allure label the sync script reads - not a convention in prose.

## Setup Test Module Skill Rules

### Must Follow
- **Naming**: Module names in `snake_case`, classes in `PascalCase`, fixtures as `<module>_<resource>`
- **Imports**: Always use absolute imports from project root (never relative)
- **API Clients**: Must extend `BaseAPIClient`
- **Schema Constants**: Use dataclass extending `BaseSchema` in conftest.py
- **Database Names**: Never hardcode table/view names — use `tests/commons/db_schema.py`
- **Generated Code**: Files contain only essential setup (no template methods, examples, or commented code)
- **Fixtures**: Three required module-scoped fixtures — schema, state manager, API client

### Must NOT Do
- Include template methods or commented-out examples in generated files
- Hardcode table/view names in tests
- Use relative imports
- Create API clients without `BaseAPIClient` parent
- Write schema constants inline (use dataclass in conftest)
- Pass test data directly without factories
- Call `os.getenv()` for endpoints in tests
- Use raw `requests.Session` instead of typed API client
- Share state between modules
