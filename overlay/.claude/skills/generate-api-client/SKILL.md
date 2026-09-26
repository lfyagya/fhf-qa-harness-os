---
name: generate-api-client
description: Generate api/{module}_client.py boilerplate extending BaseAPIClient for a backend module. Use when adding a new backend API client.
---
# generate-api-client Skill

Generate `api/{module}_client.py` boilerplate extending `BaseAPIClient`.

## Input

```
--module-name <name>        Required: snake_case module name (payment_processing)
```

## Process

1. **Validate module name** — snake_case only
2. **Derive naming** — payment_processing → PaymentProcessing
3. **Generate class** — extends BaseAPIClient
4. **Write file** — `api/{module}_client.py`

## Output

**File:** `api/{module}_client.py`

```python
from requests import Session
from api.base_client import BaseAPIClient

class <ModuleName>Client(BaseAPIClient):
    """
    Typed HTTP client for <module_name> endpoints.
    
    Inherits session management, timeout handling, and URL resolution from BaseAPIClient.
    Add one method per endpoint following patterns from existing clients.
    """
    
    def __init__(self, session: Session, base_url: str):
        super().__init__(session, base_url)
```

Then add one method per endpoint the task needs (no commented-out patterns in the file):

```python
def get_<entity>(self, **kwargs) -> requests.Response:
    return self.get("GET_<ENTITY>_ENDPOINT", **kwargs)

def create_<entity>(self, payload: dict, **kwargs) -> requests.Response:
    return self.post("CREATE_<ENTITY>_ENDPOINT", json=payload, **kwargs)

def get_<entity>_by_id(self, entity_id: int, **kwargs) -> requests.Response:
    return self.get_path("GET_<ENTITY>_ENDPOINT", {"id": entity_id}, **kwargs)
```

## Key Rules

✓ Extend BaseAPIClient (never inherit from requests.Session)  
✓ Add one method per endpoint (don't combine multiple endpoints)  
✓ Use BaseAPIClient methods: `self.get()`, `self.post()`, `self.put()`, `self.get_path()`, `self.get_with_path()`  
✓ Method names describe what they do (get_payment_status, create_payment, etc.)  
✓ Always accept `**kwargs` for flexibility (params, headers, etc.)  
✓ Return `requests.Response` (never parse response in client)  
✗ Don't hardcode URLs (use env var names like "GET_PAYMENT_ENDPOINT")  
✗ Don't handle authentication (BaseAPIClient does this)  
✗ Don't add error handling (let test layer handle this)  

## BaseAPIClient Methods Available

```python
self.get(endpoint_env, **kwargs)                    # GET request
self.post(endpoint_env, json, **kwargs)             # POST with JSON
self.put(endpoint_env, json, **kwargs)              # PUT with JSON
self.patch(endpoint_env, json, **kwargs)            # PATCH with JSON
self.delete(endpoint_env, **kwargs)                 # DELETE request
self.get_path(endpoint_env, path_params, **kwargs)  # GET with :param substitution
self.get_with_path(endpoint_env, *segments, **kwargs)  # GET + append path segments
self.url_for(endpoint_env, **path_params)           # Resolve URL string (for pagination)
```

## User Notes

- **Endpoint env vars:** User must add to `tests/.env` (e.g., `GET_PAYMENT_ENDPOINT=/api/v1/payments`)
- **Reference clients:** api/acd_client.py, api/apd_client.py, api/repo_invoice_client.py
- **API standards:** See .claude/rules/api-standards.md
- **Next step:** Use `/generate-data-builder` skill for test payloads

## Example

```bash
/generate-api-client --module-name payment_processing
```

Output: `api/payment_processing_client.py` created with `PaymentProcessingClient` and the endpoint methods the task needs.
