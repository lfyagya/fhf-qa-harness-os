---
name: plan
description: >-
  Plans backend automation checklists per SERV module from project-context docs.
  Use when the user invokes /plan, asks for a module automation checklist, test
  coverage plan, or smoke/E2E checklist for Loss Mitigation (non-invoice),
  Insurance, Titles, Document Repository, Complaints, Custodian, or Checks.
disable-model-invocation: true
---

# /plan — Backend Automation Checklist Planner

Act as a **Senior Backend Test Automation Engineer**. Produce backend automation checklists (Smoke + E2E) from `project-context/` — do not write test code in this skill.

**Trigger:** `/plan` (optionally with a module name, e.g. `/plan Insurance` or `/plan Loss Mitigation — Impound`).

---

## Hard rules

1. **Read before planning.** Every checklist fact (tables, views, packages, endpoints, workflows, risks) must come from documents read *this session* under `project-context/` (or from existing repo test code when marking "Existing Tests"). Do not invent schema or endpoints.
2. **Scope exclusions are absolute.** Do **not** create or expand checklists for:
   - Ancillary (any sub-dashboard)
   - UniFi / Call Center (Collections, Servicing)
   - Loss Mitigation **Repo Invoice** and **Auction Invoice**
3. **One checklist file per top-level module** (or one file per sub-module if the user names a single sub-module). Write under `project-context/`.
4. **Match existing checklist style.** Follow the structure of:
   - `project-context/Auction Invoice Backend Automation Checklist.md`
   - `project-context/UniFi Backend Automation Checklist(1).md`
5. **Reuse first.** Scan `tests/` for existing coverage and label items as **Existing Tests** vs **New Test Cases**. Prefer API→DB assertions consistent with this framework (`BaseDB`, typed clients, `db_schema.py`, Allure-wrapped assertions).
6. **No implementation.** This skill stops at checklist markdown. Hand off to `/setup-test-module` or `e2e-tests-generator` only if the user asks next.

---

## In-scope modules (only these)

Create checklists for the modules and sub-areas below. Skip anything in Hard rule #2.

### 1. Loss Mitigation
- Assignment
- Repo
- Skip
- Re-Marketing
- Impound
- Transport
- Recon
- **Exclude:** Invoices → Repo Invoice, Auction Invoice

### 2. Insurance
- Total Loss
- Lienholder Claim

### 3. Titles
- General
- Release → Release View, Release Approval View
- Remarketing
- Remarketing Titles
- Missing Titles
- Re-Registration

### 4. Document Repository
- Loan Packages
- Download Job Queue

### 7. Complaints
- Complaints View

### 8. Custodian
- Exception Queue
- Custodian Requests
- Portfolio View
- Custodian Dashboard
- Contracts

### 13. Checks Module
- Insurance Repair Checks
- Lockbox Checks

Doc path map and reading order: [MODULE_SCOPE.md](MODULE_SCOPE.md).

---

## Workflow

### Phase 0 — Confirm scope

1. If the user named a module/sub-module, plan **only that**.
2. If `/plan` with no args, plan **all in-scope modules** above (still excluding Ancillary, UniFi, Repo/Auction Invoice).
3. If they ask for an excluded module, refuse briefly and list what *is* in scope.

### Phase 1 — Read project-context (root)

Read each document in `project-context/` (skip `index.html` and any checklist you are about to overwrite unless updating it). Priority order:

1. `Backend_QA_Context_Document.md`
2. `fhf-application-context.md`
3. `application-architecture.md`
4. `api-layer-guide.md`
5. `agentic-qa-spec-driven-process.md`
6. `harness-alignment.md`
7. `module-priority-breakdown (1).md`
8. `checks_module_index.md` (when planning Checks)
9. Existing example checklists (format reference only):
   - `Auction Invoice Backend Automation Checklist.md`
   - `UniFi Backend Automation Checklist(1).md`

Absorb: testing lanes (Backend Smoke vs Backend E2E), assertion depth, risk factors, and how this harness maps to API→DB work.

### Phase 2 — Read module docs

For each in-scope module being planned:

1. Read `project-context/modules/<module>_module_index.md` (if present).
2. Read `project-context/modules/<module>/00_README.md` or `README.md`.
3. Read **every** markdown file in that module folder that covers in-scope sub-areas (overview, dashboard docs, DB/API refs, QA strategy, cross-module).
4. **Skip** invoice docs under Loss Mitigation when planning LM (`08_invoice_processing.md` may be skimmed only for shared tables — do not produce Repo/Auction Invoice checklist sections).
5. **Skip** entire `project-context/modules/ancillary/` and `project-context/modules/unifi/`.

Extract per sub-area:
- Business purpose / primary users
- Tables, views, packages, triggers, crons
- API endpoints / client methods (if documented)
- Status machines / key transitions
- Cross-module side effects
- Known risks / bugs from QA strategy docs
- Suggested smoke vs E2E split

### Phase 3 — Inventory existing automation

For the module under plan, search the repo:

- `tests/` for related test files
- `api/` for typed clients
- `tests/commons/db_schema.py` for registered objects
- `tests/smoke/` for smoke coverage

Mark each checklist item:
- **Existing** — cite file/test name when found
- **New** — gap to automate; tag priority `[P1|P2|P3]` and confidence `[Confirmed|Needs Validation]` when evidence exists

### Phase 4 — Author the checklist

Write markdown to:

```
project-context/<Module Name> Backend Automation Checklist.md
```

Examples:
- `project-context/Loss Mitigation Backend Automation Checklist.md`
- `project-context/Insurance Backend Automation Checklist.md`
- `project-context/Titles Backend Automation Checklist.md`
- `project-context/Document Repository Backend Automation Checklist.md`
- `project-context/Complaints Backend Automation Checklist.md`
- `project-context/Custodian Backend Automation Checklist.md`
- `project-context/Checks Backend Automation Checklist.md`

If the user scoped a single sub-module, append it to the filename (e.g. `Loss Mitigation — Impound Backend Automation Checklist.md`).

### Phase 5 — Present summary

After writing file(s), reply with:
1. Paths created/updated
2. Sub-areas covered
3. Counts: smoke existing / smoke new / e2e existing / e2e new
4. Top P1 gaps (max 5 bullets)
5. Explicit note of what was excluded and why

Do **not** start implementing tests unless the user asks.

---

## Checklist output template

Use this structure (adapt section headings to the module's sub-areas):

```markdown
**<Module> Backend Automation Checklist**

Built from `project-context/modules/<module>/` and existing `tests/` inventory
(read this session). Excludes Ancillary, UniFi, and LM Repo/Auction Invoice.

# <Module>

## <Sub-area name>

Tables, Views, and Packages used

- `TABLE_OR_VIEW` — short purpose

Endpoints (if known)

- `METHOD path/env-key` — purpose

---

# Smoke Test Cases

## Existing Tests

1. …

## New Test Cases

1. … *[P2 · Needs Validation]*

---

# E2E Test Cases — <Sub-area>

## <Workflow / Feature>

### Existing Tests

1. …

### New Test Cases

1. … *[P1 · Confirmed]*
```

### What belongs in Smoke vs E2E

| Lane | Include |
|------|---------|
| **Smoke** | Master/reference data integrity; table/view existence; read-only GET health + response-time; API vs DB counts for stable lookups |
| **E2E** | Mutations, status transitions, trigger cascades, cron side effects, cross-module sync, negative/auth cases, financial calculations |

Prefer concrete, automatable statements ("Validate GET X returns 200 and count matches `VIEW_Y`") over UI-only wording.

### Priority tags

| Tag | Meaning |
|-----|---------|
| **P1** | Core daily path, financial/legal risk, or broken with high blast radius |
| **P2** | Important branch / regression lock |
| **P3** | Nice-to-have / opportunistic |
| **Confirmed** | Evidenced in module docs or live schema/API this session |
| **Needs Validation** | Plausible from docs but endpoint/rule/DB shape not verified |

---

## Interaction with other skills

| Next step | Skill |
|-----------|--------|
| Scaffold module folders/client/conftest | `setup-test-module` |
| Author tests from an approved checklist feature | `e2e-tests-generator` |
| Generate only client / conftest / factory / test file | `generate-*` skills |

---

## Done criteria

- [ ] Root `project-context/` docs relevant to scope were read
- [ ] Every in-scope module folder doc for the requested scope was read
- [ ] Exclusions honored (no Ancillary, UniFi, Repo Invoice, Auction Invoice)
