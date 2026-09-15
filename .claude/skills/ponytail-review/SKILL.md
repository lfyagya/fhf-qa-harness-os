---
name: ponytail-review
description: "Read-only over-engineering review of harness-os engine code. Use only when the user says ponytail or over-engineering review. Stay in parent. Do not edit application source or consumer tests."
---

# Ponytail review (FHF-routed)

Stay in the parent. This skill is callable only from the `ponytail-review` route.

## Job

Review `fhf-harness-os` engine code for unused abstraction, duplicated stdlib, and dead flexibility. One line per finding: path, what to delete, why it is safe.

## Do not

- Edit `fhf-dashboards/src` (read-only).
- Edit E2E, Smoke, or backend automation tests.
- Apply deletions. Report only.
- Treat a passing test as proof a deletion is safe.

Application and payload changes stay on their own routes and specialists.
