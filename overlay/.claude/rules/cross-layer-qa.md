---
paths:
  - "front-end-automation-e2e/**"
  - "front-end-automation-smoke/**"
  - "fhf-backend-automation/**"
---
# Cross-Layer QA Workflow

One Jira family may need frontend and backend evidence plus both automation lanes. It is one task
with one builder (`qa-automation-generator`), not two parallel suites.

1. Map every acceptance criterion to its UI, API, and Oracle outcomes. A layer that does not apply
   is NOT_APPLICABLE with evidence; an unknown one is UNKNOWN. Never presume a layer applies or
   passes.
2. Read only the source the ticket reaches, expanding one hop only when an import, API call,
   Oracle contract, or shared component proves the dependency.
3. **Bind the layers at a named seam** — the endpoint contract (method + path) plus a correlation
   key both lanes carry. Cypress owns the half above the seam (the UI reached it; this is what it
   sent). Backend owns the half below (given that request, this API result and this Oracle row).
   Capture the seam request and response in Cypress, not just the UI outcome.
   The test of a correct binding: when the flow fails, the two halves together must distinguish
   "the UI sent an invalid payload" from "the API rejected a valid payload". A pair that cannot
   separate those cannot tell you which team owns the defect, so it is not cross-layer coverage.
   A unit with genuinely no shared seam is NOT_APPLICABLE with evidence — never silently omitted.
4. Run functional tests first, then impacted regression, then the explicitly selected Smoke scope.
5. Report per acceptance criterion: seam, which lane proved which half, native artifact (revision,
   environment, exact test selection, assertion-level result). Unproven seams are reported as
   unproven, not covered.

Production Smoke stays GET-only; backend automation runs Dev/QA only. Never edit application
source.
