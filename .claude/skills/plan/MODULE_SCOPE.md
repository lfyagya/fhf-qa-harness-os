# Module scope & doc map for `/plan`

Read this after `SKILL.md` when planning. Paths are relative to the repo root.

## Always skip

| Area | Path | Reason |
|------|------|--------|
| Ancillary | `project-context/modules/ancillary/` | Already automated / out of `/plan` scope |
| UniFi / Call Center | `project-context/modules/unifi/` | Already automated / out of `/plan` scope |
| LM Repo Invoice & Auction Invoice | `project-context/modules/loss_mitigation/08_invoice_processing.md` (do not checklist) | Already covered; existing checklists exist at repo root of `project-context/` |

## Loss Mitigation

**Index:** `project-context/modules/loss_mitigation_module_index.md`  
**Folder:** `project-context/modules/loss_mitigation/`

| Sub-area | Primary doc |
|----------|-------------|
| Overview / architecture | `00_README.md`, `01_module_overview_architecture.md` |
| Assignment | `02_assignment_dashboard.md` |
| Repo | `03_repo_dashboard.md` |
| Skip | `04_skip_dashboard.md` |
| Re-Marketing | `05_remarketing_dashboard.md` |
| Impound | `06_impound_dashboard.md` |
| Transport | `07_transport_dashboard.md` |
| Recon | `09_recon_dashboard.md` |
| Cross-module / QA | `10_cross_module_relationships.md`, `11_qa_testing_strategy.md` |
| Invoices | **SKIP** `08_invoice_processing.md` for checklist output |

**Output:** `project-context/Loss Mitigation Backend Automation Checklist.md`

## Insurance

**Index:** `project-context/modules/insurance_module_index.md`  
**Folder:** `project-context/modules/insurance/`

| Sub-area | Primary doc |
|----------|-------------|
| Overview | `00_README.md`, `01_module_overview_architecture.md` |
| Total Loss | `02_total_loss_dashboard.md` |
| Lienholder Claim | `03_lienholder_claim_dashboard.md` |
| Cross-module / QA | `04_cross_module_relationships.md`, `05_qa_testing_strategy.md` |

**Output:** `project-context/Insurance Backend Automation Checklist.md`

## Titles

**Index:** `project-context/modules/titles_module_index.md`  
**Folder:** `project-context/modules/titles/`

| Sub-area | Primary doc |
|----------|-------------|
| Overview | `README.md` |
| General | `01_general_titles.md` |
| Release (View + Approval View) | `02_release.md` |
| Remarketing / Remarketing Titles | `03_remarketing.md` |
| Missing Titles | `04_missing_titles.md` |
| Re-Registration | `05_re_registration.md` |
| Cross-module / QA | `06_cross_module_dependencies.md`, `07_qa_testing_strategy.md` |

**Output:** `project-context/Titles Backend Automation Checklist.md`

## Document Repository

**Index:** `project-context/modules/document_repository_module_index.md`  
**Folder:** `project-context/modules/document_repository/`

| Sub-area | Primary doc |
|----------|-------------|
| Overview | `00_README.md`, `01_module_overview_architecture.md` |
| Loan Packages | `02_loan_packages.md` (+ `04_loan_package_merge.md`, `06_document_types_subtypes.md` as needed) |
| Download Job Queue | `03_download_job_queue.md` |
| Related / QA | `05_rdn_documents_automation.md`, `07_cross_module_relationships.md`, `08_qa_testing_strategy.md` |

**Output:** `project-context/Document Repository Backend Automation Checklist.md`

## Complaints

**Index:** `project-context/modules/complaints_module_index.md`  
**Folder:** `project-context/modules/complaints/`

| Sub-area | Primary doc |
|----------|-------------|
| Overview | `00_README.md`, `01_module_overview_architecture.md` |
| Complaints View / types | `02_complaint_types_assignment.md` |
| Notes / email / UniFi touchpoints | `03_notes_management.md`, `04_email_notifications.md`, `05_unifi_integration.md` (document cross-links; do not plan UniFi module) |
| Cross-module / QA | `06_cross_module_relationships.md`, `07_qa_testing_strategy.md` |

**Output:** `project-context/Complaints Backend Automation Checklist.md`

## Custodian

**Index:** `project-context/modules/custodian_module_index.md`  
**Folder:** `project-context/modules/custodian/`

| Sub-area | Primary doc |
|----------|-------------|
| Overview | `00_README.md`, `01_module_overview_architecture.md` |
| Exception Queue | `02_exception_queue.md` |
| Custodian Requests | `03_custodian_requests.md` |
| Portfolio View | `04_portfolio_view.md` |
| Custodian Dashboard | `05_custodian_dashboard.md` |
| Contracts | `06_contracts_dashboard.md` |
| Cross-module / QA | `07_cross_module_relationships.md`, `08_qa_testing_strategy.md` |

**Output:** `project-context/Custodian Backend Automation Checklist.md`

## Checks Module

**Index:** `project-context/checks_module_index.md` + `project-context/modules/checks/`  
**Folder:** `project-context/modules/checks/`

| Sub-area | Primary doc |
|----------|-------------|
| Overview | `00_README.md`, `01_module_overview_architecture.md` |
| Insurance Repair Checks (IRC) | `02_irc_dashboard.md`, `03_irc_ai_workflow.md` |
| Lockbox Checks (LBC) | `04_lbc_dashboard.md`, `05_lbc_ai_pipeline.md`, `06_lbc_sftp_email.md` |
| Cross-module / QA / schema / API | `07_cross_module_relationships.md`, `08_database_schema.md`, `09_api_endpoints_reference.md`, `10_qa_testing_strategy.md`, `11_jira_confluence_references.md` |

**Output:** `project-context/Checks Backend Automation Checklist.md`

## Root context docs (Phase 1)

Read from `project-context/`:

- `Backend_QA_Context_Document.md`
- `fhf-application-context.md`
- `application-architecture.md`
- `api-layer-guide.md`
- `agentic-qa-spec-driven-process.md`
- `harness-alignment.md`
- `module-priority-breakdown (1).md`
- Format references: `Auction Invoice Backend Automation Checklist.md`, `UniFi Backend Automation Checklist(1).md`
