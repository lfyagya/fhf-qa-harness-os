---
name: hookify
description: "Draft a harness hook-rule proposal. Use only when the user says hookify, write a hook rule, or configure hookify. Stay in parent. Do not edit .claude/hooks or qa-control-plane.json."
---

# Hookify (FHF-routed)

Stay in the parent. This skill is callable only from the `hookify` route.

## Job

Draft one hook-rule proposal for `fhf-harness-os`. Name the event, the matcher, and the fail-closed behaviour.

## Do not

- Edit `.claude/hooks/`, `.claude/settings.json`, or `config/qa-control-plane.json`.
- Add a hook to `engineering.harness.hooks` from chat.
- Run on E2E, Smoke, or backend consumer lanes.
- Bypass `FHF_ALLOW_HARNESS_EDIT`. A hook change needs an ADR (`docs/governance.md`).

Hand the draft to the owner. Policy membership is a control-plane edit, then sync.
