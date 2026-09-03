# generate-data-builder Skill

Generate data builder factory methods for FHF test payloads.

## Input

1. **Module & Factory Info**
   - Module name (repo_invoice, acd, apd, auction_invoice)
   - Factory class name (RepoInvoiceFactory, ACDDataFactory)
   - Method name (create_approval_payload, create_add_product_payload)

2. **Request Payload (JSON Sample)**
   - User provides actual API request with **dummy data only**
   - ⚠️ Warning: No real PII, client names, loan numbers, emails

3. **Field Classification**
   - A) IDs (test provides): application_id, loan_number, invoice_tracker_id, vin, etc.
   - B) Audit (hardcoded): modified_by, created_by, created_by_id
   - C) Enums (predefined set): invoice_status, contract_state, anc_prod_status
   - D) Text (Faker/test): notes, email_text, file_comment
   - E) Numbers (Faker/test): anc_prod_value, contract_price
   - F) Dates (Faker/test): invoice_date, cancellation_date

4. **Enum Values**
   - User specifies valid values for each enum field
   - Confirm if in tests/constants.py

5. **State Manager** (optional)
   - Yes/No: does module use state manager?
   - If yes: which state keys needed?

## Output

**Generated File:** `tests/commons/data_builder/{module_name}.py`

Factory class with:
- Type-hinted method with required ID params (keyword-only)
- `_VALID_VALUES` dict for enums
- `modified_by`/`created_by` hardcoded to `COLLECTION_MANAGER`
- Local helper methods following project patterns
- Proper imports from constants.py
- Usage example

## Key Rules

**DO:**
- Make ID fields required params (no defaults)
- Hardcode audit fields to COLLECTION_MANAGER
- Use `random.choice(_VALID_VALUES["field"])` for enums
- Use Faker only: names, company, sentence, numbers, dates
- Check existing code for similar helpers before creating new ones
- Import from constants.py (never hardcode values)

**DON'T:**
- Use Faker for IDs or constrained fields
- Allow modified_by/created_by to be overridable
- Include real PII in sample data
- Create duplicate helpers (adapt existing patterns instead)
- Generate enum values (define valid set explicitly)

## Existing Helper Patterns (Project-Specific)

| Pattern | Location | Use If |
|---------|----------|--------|
| `_generate_random_number(digits)` | shared.py / BaseInvoiceFactory | Invoice numbers, random IDs |
| `_get_cancellation_date()` | ancillary_cancellation_dashboard.py | Past date within 365 days |
| `_pick_*_from_state(state_mgr, key)` | ancillary_cancellation_dashboard.py | Pick from state manager |
| `_resolve_*_id(value, lookup_map)` | ancillary_cancellation_dashboard.py | Map name to ID |

**Before creating a helper:** Check if similar method exists in module's factory or shared.py. Adapt, don't duplicate.

## Example Output

```python
import random
from faker import Faker
from tests.constants import COLLECTION_MANAGER, INVOICE_DOCMAN_ID

_VALID_VALUES = {
    "invoice_status": ["CREATED", "APPROVED", "DENIED"],
}

class RepoInvoiceFactory:
    _faker = Faker()
    
    @staticmethod
    def create_approval_payload(
        *,
        application_id: int,
        loan_number: str,
        invoice_tracker_id: int,
        **kwargs
    ) -> dict:
        return {
            "application_id": application_id,
            "loan_number": loan_number,
            "invoice_tracker_id": invoice_tracker_id,
            "invoice_status": kwargs.get(
                "invoice_status",
                random.choice(_VALID_VALUES["invoice_status"])
            ),
            "modified_by": COLLECTION_MANAGER,
            "notes": kwargs.get("notes", cls._faker.sentence(nb_words=10)),
        }
```

## Warnings

⚠️ **Before creating helpers:**
- Check if similar method exists in {module} factory
- Check shared.py for BaseInvoiceFactory patterns
- Check ancillary_cancellation_dashboard.py for ACD patterns
- If found → ADAPT, DON'T DUPLICATE

⚠️ **ID fields:** ALWAYS required params, NEVER generated, NEVER Faker

⚠️ **Audit fields:** ALWAYS hardcoded to COLLECTION_MANAGER, never override

⚠️ **Sample data:** Use dummy values only (no real PII, client names, loan numbers)
