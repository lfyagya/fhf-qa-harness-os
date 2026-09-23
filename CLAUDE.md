# fhf-harness-os — QA Engineering Harness

Doc revision: [`docs-2026-09-22`](docs/framework/docs-release.md)

This repository is the **harness engine**: the policy, hooks, agents, skills, and loaders that
project a deterministic control plane into a local FHF workspace. It is not a QA test suite. It
holds no Cypress specs, application documentation, or coverage evidence — those stay on the
payload side of the workspace.

The workspace root receives the generated projection (`.claude/`, adapters, `.harness/` CLIs). A
lane receives no `.claude/` of its own (ADR-0032). Application source stays read-only; every
prompt is a task (ADR-0044): one that names no SERV ticket is a quick task that needs one owner
confirm; naming a ticket, manifest file or title selects its full, gated manifest (ADR-0043).

Read next: [`docs/framework/harness-engineering.md`](docs/framework/harness-engineering.md) —
system overview, control-plane order, current gate and sync behavior.
