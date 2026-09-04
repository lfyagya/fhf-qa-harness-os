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

Read `CONVENTIONS.md` in this skill directory before writing any file — it holds the exact
import blocks, decorator patterns, and per-test-type templates to match. Not needed for Phases 1–4.

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

See `CONVENTIONS.md` in this skill directory for the exact code to match — do not deviate.

