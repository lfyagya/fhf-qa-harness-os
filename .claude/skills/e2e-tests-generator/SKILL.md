---
name: e2e-tests-generator
description: Generate backend end-to-end pytest suites that span API and Oracle for a module. Use for mutable dev-environment backend flows.
---
# e2e-tests-generator Skill

Research-gated test writer. It does not write a single line of test code until it has
(1) read the module's real code, (2) confirmed the real DB shape via Oracle MCP,
(3) confirmed the real API contract via Jira/Confluence, (4) mapped a checklist feature
to concrete test cases, and (5) gotten your explicit sign-off on the plan.

**Trigger:** `Generate tests for <module> — <feature>` (or similar). If the module isn't stated, ask first — nothing below can start without it.

---

## Hard rules (apply to every phase, no exceptions)

1. **Never assume — verify or ask.** Table names, column names, data types, endpoint paths, payload shapes, status values, business rules: every one of these must trace to something read *this session* (a live Oracle query, a Confluence page, a Jira ticket, or existing repo code) or to an explicit answer from the user. If it isn't in the knowledge base gathered this session, stop and ask — especially for endpoints and DB structures. Do not fill gaps from training-data guesses about what a FHF table "probably" looks like.
2. **Reuse before creating.** Before writing any new fixture, factory method, assertion, schema entry, or client method, check whether one already covers it (see the inventory in Phase 1 and the reference table at the bottom). Adapt an existing one via `**kwargs` before adding a parallel method that does almost the same thing.
3. **No plan, no code.** Test code is written only after the user approves the plan via `ExitPlanMode`. Research, DB introspection, and checklist analysis are not implementation — do them in plan mode.
4. **Cite provenance in the plan.** Every DB fact and every API fact in the plan is tagged with where it came from (`DB: schema_information`, `Confluence: <page title>`, `Jira: <key>`, `Existing code: <file>`). A fact with no citation doesn't go in the plan.
5. **Verify by running, not by asserting.** "Framework rules verified" is only true after `py_compile` and `pytest --collect-only` actually ran and passed. Show their output.

---

## Phase 0 — Identify scope

If the module and feature aren't already clear from the request, ask directly (plain question, not `AskUserQuestion` — there's no fixed option set yet):
- Which module (`repo_invoice`, `auction_invoice`, `ancillary/ancillary_products_dashboard`, `ancillary/ancillary_cancellation_dashboard`, `unifi`, or a new one)?
- Rough scope for this round (one endpoint, one checklist feature — don't try to cover a whole module in one pass)

## Phase 1 — Local ground truth

Read, in order:
- `CLAUDE.md` and all of `.claude/rules/*.md`
- The module's `conftest.py`, existing `test_*.py` files, its entry (if any) in `tests/commons/db_schema.py`, `tests/commons/data_builder/{module}.py` and `tests/commons/data_builder/shared.py`, `tests/commons/api_schemas/{module}_schemas.py`, `api/{module}_client.py`, and any module-specific constants in `tests/constants.py`

Build a short **reuse inventory** (not shown to the user unless asked): existing fixtures, existing factory methods, existing assertion helpers relevant to this feature, existing DB schema constants already defined. Everything in Phase 8 gets checked against this list.

## Phase 2 — Enter plan mode

Call `EnterPlanMode` now. Phases 3–7 (DB introspection, doc retrieval, checklist analysis, coverage check, plan authoring) happen inside plan mode — this is exploration and design, not code.

## Phase 3 — Database introspection (Oracle MCP)

Tools are deferred — `ToolSearch` for `mcp__oracle-sqlcl__*` if not already loaded.

1. `connections_list` if the connection name isn't already known — don't guess one. The known connections in this project are `fhf-dev` and `fhf-db`; use `fhf-dev` unless the user says otherwise.
2. `connect` to it.
3. `schema_information` (then targeted `sql_run` `DESCRIBE`/`SELECT` as needed) for every table/view already in `db_schema.py` for this module, plus any new ones the feature implies. Get real column names and data types — do not carry over column names from memory or from a similar-sounding table.
4. For status/enum-like columns, query `DISTINCT` values rather than assuming a valid set.
5. Note any procedures/packages the feature's endpoints trigger, if relevant to what the test needs to validate.

## Phase 4 — API contract (Jira + Confluence)

Tools are deferred — `ToolSearch` for `mcp__confluence__*` / `mcp__jira__*` if not already loaded.

1. Ask the user directly for the Confluence space (and page, if they know it) that holds the API-DB doc for this feature. Do not guess a space key.
2. `confluence_search_pages` (scoped to that space) or `confluence_execute_cql_search`, then `confluence_get_page_outline` / `confluence_get_page_section` to pull the endpoint contract (method, path, payload, response) and any DB-mapping notes — pull sections, not the whole page, to keep this cheap.
3. If a Jira ticket is the source of the requirement or its acceptance criteria, ask for the key and pull it with `get_issue` (or `jql_search` if only a rough description is known).
4. Cross-check every endpoint found here against `tests/.env` — if the doc references a path with no matching env var, flag it as a gap rather than inventing one.

## Phase 5 — Checklist and feature selection

Ask the user directly where the checklist lives (file path, Confluence page, or pasted text) if not already given. Read it. If the checklist lists multiple candidate features/scenarios and the user hasn't already narrowed it down, use `AskUserQuestion` to have them pick one — this is a genuine multi-option decision, unlike the open-ended lookups above.

## Phase 6 — Coverage re-verification

Cross-reference the checklist against what Phases 3–4 actually found, and against four dimensions: **positive, negative, boundary/edge, acceptance criteria**. Produce a gap list: checklist items the DB/API doc contradicts or doesn't support, and dimensions the checklist is silent on (e.g., a `NOT NULL` column with no negative case, a status transition with no denial path). Don't silently expand scope — surface the gap and let the plan account for it explicitly.

## Phase 7 — Write the plan, then exit plan mode

Write the plan to the plan file using this shape, then call `ExitPlanMode`:

```
## Feature: <name>                     Module: <module>

### Knowledge base (with provenance)
- DB: <table/view> — columns: <name: TYPE, ...>          [DB: schema_information]
- API: <METHOD> <path> — payload: {...} / response: {...} [Confluence: "<page>"]
- Acceptance criteria: <...>                              [Jira: <KEY> / Confluence]

### Checklist coverage gaps found in Phase 6
- <gap>, and how this plan addresses or explicitly excludes it

### Test cases
| # | Order | Scenario type | Test name | API call → expected | DB validation | Reuses | New |
|---|-------|---------------|-----------|---------------------|----------------|--------|-----|
| 1 | 1     | positive      | test_...  | POST /x → 201       | TABLE.COL      | api_client.create_x, assert_response_status | — |
| 2 | 2     | negative      | test_...  | POST /x (bad Y) → 400 | none         | assert_response_status | — |
...

### New code required (justified against the Phase 1 inventory)
- Factory: `<Module>Factory.create_x_payload()` in data_builder/{module}.py — nothing existing covers this shape
- Schema: `get_x_schema()` in api_schemas/{module}_schemas.py
- Constants: <...> in tests/constants.py
- (If none of the above have a "New" row, say so — most rounds shouldn't need new fixtures.)
```

If the user pushes back or edits, revise and exit plan mode again — do not start Phase 8 without an approved plan.

## Phase 8 — Implementation (only after approval)

Write in this order, and only the pieces the plan actually listed as new: constants → `api_schemas` entry → `data_builder` factory method(s) → `api/{module}_client.py` method (only if the endpoint truly isn't covered yet) → conftest fixtures (only if missing) → test methods.

Apply DRY/SOLID as they map onto this framework, not as abstract OOP theater:
- **SRP** — one test method per scenario; validation logic belongs in `assertions.py`, not inlined in the test.
- **OCP** — extend factories via `**kwargs` overrides instead of branching inside an existing factory method or duplicating it.
- **LSP** — module `Schema`/`StateManager` subclasses only add fields/behavior, never break `BaseSchema`/`BaseStateManager`'s contract.
- **ISP** — inject only the fixtures a test actually needs (don't pull in the whole module's fixture set out of habit).
- **DIP** — tests call the typed API client and `execute_query`/DAO layer, never `requests`/raw cursors directly.
- **DRY** — no payload dict, query string, or magic value repeated across two or more test methods; if you're about to type the same literal twice, it belongs in a constant, factory default, or fixture.

Follow `.claude/rules/api-standards.md`, `assertions.md`, `oracle-db.md`, and `testing.md` exactly for mechanics (client patterns, DAO usage, assertion helpers, ordering, TestRail `[C<id>]` — see the exception in `testing.md` for `tests/unifi/e2e/`). This skill doesn't restate those rules; if something here ever looks like it contradicts them, the rule file wins and this file is stale.

## Phase 9 — Verify, don't narrate

Run, and show the actual output of:
```bash
python3 -m py_compile <every file touched>
pytest <path::to::new tests> --order-scope=module --collect-only
```
Only report the test(s) as generated once both pass. If either fails, fix and re-run — don't report success first and caveat second.
