# Data Builder Creation Checklist

Use this when generating a new factory method.

## 1. Gather Input
- [ ] Module name (repo_invoice, acd, apd, auction_invoice)
- [ ] Factory class name (RepoInvoiceFactory, ACDDataFactory)
- [ ] Method name (create_approval_payload, build_add_product)
- [ ] Actual API request payload (JSON with dummy data)
- [ ] ⚠️ Confirmed: NO real PII, client names, loan numbers in sample

## 2. Classify Fields
For each field in payload:

| Field | Type | Notes |
|-------|------|-------|
| application_id | ID | Required param |
| loan_number | ID | Required param |
| modified_by | Audit | → COLLECTION_MANAGER |
| invoice_status | Enum | → _VALID_VALUES |
| notes | Text | → Faker.sentence() |
| anc_prod_value | Number | → Faker.random_number() |
| cancellation_date | Date | → _get_random_past_date() |

## 3. Enum Values (If Applicable)
For each enum field:
- [ ] List valid values
- [ ] Check tests/constants.py for existing values
- [ ] Note if values need to be added to constants

## 4. Check Existing Code
Before creating helpers:
- [ ] Search `tests/commons/data_builder/{module_name}.py` for similar methods
- [ ] Search `tests/commons/data_builder/shared.py` for BaseInvoiceFactory patterns
- [ ] Search `tests/commons/data_builder/ancillary_cancellation_dashboard.py` for ACD patterns
- [ ] If found: ADAPT existing pattern, DON'T DUPLICATE

## 5. State Manager (If Module Uses It)
- [ ] Does this module have state_manager? (YES/NO)
- [ ] If YES: Which state keys? (acd_cancellation_reasons, etc.)

## 6. Generate Factory
- [ ] Type hints on all params
- [ ] ID fields as required keyword-only params
- [ ] modified_by hardcoded to COLLECTION_MANAGER
- [ ] _VALID_VALUES dict for enums
- [ ] Local helpers follow project patterns
- [ ] Imports from constants.py (never hardcoded)

## 7. Verify Generated Code
- [ ] No Faker used for IDs
- [ ] No enum values generated (only random.choice)
- [ ] No real data in comments or examples
- [ ] Helper methods match existing project patterns
- [ ] Type hints complete
- [ ] docstring explains required vs optional fields

## 8. Suggest to User
- [ ] What to add to tests/constants.py (if needed)
- [ ] Which helpers match project patterns
- [ ] Usage example with field overrides
