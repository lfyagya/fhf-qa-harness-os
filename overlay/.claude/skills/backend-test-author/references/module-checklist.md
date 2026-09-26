# Backend module automation checklist (Smoke + E2E)

Produce a backend automation checklist for one SERV module from `project-context/` (in
`fhf-backend-automation`). Markdown only — no test code. Act as a senior backend test automation
engineer.

## Hard rules

1. **Read before planning.** Every fact (tables, views, packages, endpoints, workflows, risks)
   comes from documents read this session under `project-context/`, or from existing repo test
   code when marking "Existing". Never invent schema or endpoints.
2. **Out of scope, always:** Ancillary (any sub-dashboard), UniFi / Call Center (Collections,
   Servicing), Loss Mitigation **Repo Invoice** and **Auction Invoice** — already automated. Asked
   for one → refuse briefly and list what is in scope.
3. One checklist file per top-level module (or per sub-module when the user names one).
4. Match the existing style: `project-context/Auction Invoice Backend Automation Checklist.md`.
5. Reuse first: scan `tests/` and label items **Existing** (cite file/test) vs **New**.
6. Stop at the checklist. Hand off to `setup-test-module` / `e2e-tests-generator` only if asked.

## In-scope modules and doc map

Paths relative to `project-context/`. Each module has `modules/<module>_module_index.md` (Checks:
`checks_module_index.md`) and a folder under `modules/`.

| Module | Sub-areas → primary doc |
|---|---|
| Loss Mitigation (`modules/loss_mitigation/`) | Overview `00_README.md`, `01_module_overview_architecture.md`; Assignment `02_assignment_dashboard.md`; Repo `03_repo_dashboard.md`; Skip `04_skip_dashboard.md`; Re-Marketing `05_remarketing_dashboard.md`; Impound `06_impound_dashboard.md`; Transport `07_transport_dashboard.md`; Recon `09_recon_dashboard.md`; cross-module/QA `10_cross_module_relationships.md`, `11_qa_testing_strategy.md`. **Skip** `08_invoice_processing.md` (skim only for shared tables). |
| Insurance (`modules/insurance/`) | Overview `00_README.md`, `01_…`; Total Loss `02_total_loss_dashboard.md`; Lienholder Claim `03_lienholder_claim_dashboard.md`; `04_cross_module_relationships.md`, `05_qa_testing_strategy.md` |
| Titles (`modules/titles/`) | Overview `README.md`; General `01_general_titles.md`; Release (View + Approval View) `02_release.md`; Remarketing / Remarketing Titles `03_remarketing.md`; Missing Titles `04_missing_titles.md`; Re-Registration `05_re_registration.md`; `06_cross_module_dependencies.md`, `07_qa_testing_strategy.md` |
| Document Repository (`modules/document_repository/`) | Overview `00_README.md`, `01_…`; Loan Packages `02_loan_packages.md` (+ `04_loan_package_merge.md`, `06_document_types_subtypes.md`); Download Job Queue `03_download_job_queue.md`; `05_rdn_documents_automation.md`, `07_cross_module_relationships.md`, `08_qa_testing_strategy.md` |
| Complaints (`modules/complaints/`) | Overview `00_README.md`, `01_…`; Complaints View `02_complaint_types_assignment.md`; `03_notes_management.md`, `04_email_notifications.md`, `05_unifi_integration.md` (cross-links only — don't plan UniFi); `06_cross_module_relationships.md`, `07_qa_testing_strategy.md` |
| Custodian (`modules/custodian/`) | Overview `00_README.md`, `01_…`; Exception Queue `02_exception_queue.md`; Custodian Requests `03_custodian_requests.md`; Portfolio View `04_portfolio_view.md`; Custodian Dashboard `05_custodian_dashboard.md`; Contracts `06_contracts_dashboard.md`; `07_cross_module_relationships.md`, `08_qa_testing_strategy.md` |
| Checks (`modules/checks/`) | Overview `00_README.md`, `01_…`; Insurance Repair Checks `02_irc_dashboard.md`, `03_irc_ai_workflow.md`; Lockbox Checks `04_lbc_dashboard.md`, `05_lbc_ai_pipeline.md`, `06_lbc_sftp_email.md`; `07_cross_module_relationships.md`, `08_database_schema.md`, `09_api_endpoints_reference.md`, `10_qa_testing_strategy.md`, `11_jira_confluence_references.md` |

Verify a doc exists before citing it — the folder on disk wins over this table.

## Workflow

1. **Scope.** Named module/sub-module → only that. No argument → all in-scope modules.
2. **Root context** (`project-context/`), in order: `Backend_QA_Context_Document.md`,
   `fhf-application-context.md`, `application-architecture.md`, `api-layer-guide.md`,
   `agentic-qa-spec-driven-process.md`, `module-priority-breakdown (1).md`, `checks_module_index.md`
   (Checks only), then the format reference checklist. Absorb the Smoke vs E2E lanes, assertion
   depth, and risk factors.
3. **Module docs.** Index, README, and every in-scope doc for the module. Extract per sub-area:
   purpose/users; tables, views, packages, triggers, crons; endpoints/client methods; status
   machines; cross-module side effects; known risks/bugs; suggested Smoke vs E2E split.
4. **Existing automation.** Search `tests/`, `api/`, `tests/commons/db_schema.py`, `tests/smoke/`.
   Mark each item Existing (cite) or New with `[P1|P2|P3]` and `[Confirmed|Needs Validation]`.
5. **Write** `project-context/<Module> Backend Automation Checklist.md` (sub-module:
   `<Module> — <Sub> Backend Automation Checklist.md`).
6. **Summary:** paths written, sub-areas covered, counts (smoke existing/new, e2e existing/new),
   top 5 P1 gaps, what was excluded and why.

## Template

```markdown
**<Module> Backend Automation Checklist**

Built from `project-context/modules/<module>/` and existing `tests/` inventory
(read this session). Excludes Ancillary, UniFi, and LM Repo/Auction Invoice.

# <Module>

## <Sub-area>

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

| Lane | Include |
|---|---|
| **Smoke** | Master/reference data integrity; table/view existence; read-only GET health + response time; API vs DB counts for stable lookups |
| **E2E** | Mutations, status transitions, trigger cascades, cron side effects, cross-module sync, negative/auth cases, financial calculations |

Prefer automatable statements ("GET X returns 200 and count matches `VIEW_Y`") over UI wording.

| Tag | Meaning |
|---|---|
| **P1** | Core daily path, financial/legal risk, or broken with high blast radius |
| **P2** | Important branch / regression lock |
| **P3** | Nice-to-have |
| **Confirmed** | Evidenced in module docs or live schema/API this session |
| **Needs Validation** | Plausible from docs; endpoint/rule/DB shape not verified |
