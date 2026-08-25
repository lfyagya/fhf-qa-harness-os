# ADR-0016 — Task-Scoped Cross-Repository SDLC Protocol

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-21 |

## Context

A Jira feature can be implemented by separate frontend and backend tickets and then verified by
unit, API/Oracle, Cypress E2E, regression, and production Smoke lanes. Loading every repository and
ticket artifact into one session creates context noise. Treating each repository as an independent
workflow loses the feature-level impact chain.

LANE demonstrates useful mechanical patterns—grounded task context, progressive playbooks,
content-bound approvals, dependency graphs, frozen task state, runner matrices, deterministic next
steps, and golden tests—but its repository-local control plane and automatic Git workflow do not fit
FHF's multi-repository governance or execution boundaries.

## Decision

Port the mechanical patterns into the existing FHF control plane as
`engineering.taskProtocol`; do not install or scaffold LANE in FHF repositories.

Each job creates one runtime-only `fhf-harness/task/v1` manifest. It freezes only the selected Jira
family projection, acceptance-criteria digest, repository SHAs and paths, graph nodes, dependency
DAG, QA impact, runners, and proof modes. The repository catalog itself, unselected source, full Jira
history, chat history, and the derived Obsidian vault are never copied into the task snapshot.

Human approval is bound to the canonical digest of the ticket family, grounded evidence, source
selection, change plan, and QA plan. Any change to those fields invalidates approval and blocks the
next step. Agents cannot approve, commit, merge, deploy, or perform external writes automatically.

Proof is selected by test type:

- hermetic unit/component/service-contract changes may use RED/GREEN replay;
- an existing hermetic regression may use the same-test base/pass comparison;
- Cypress, production Smoke, API integration, Oracle integration, and third-party integration require
  native external execution evidence;
- `tests-not-applicable` is limited to metadata or non-behavioral chores with a recorded reason.

The task protocol is pure decision logic. Runtime adapters and repository-native commands remain
separate. Runner availability is preflighted and unavailable evidence is recorded as UNKNOWN, never
as a pass.

## Addendum — Intent vs built (2026-08-24)

Grounding source tells the harness **what shipped**. Jira acceptance criteria tell it **what was
asked**. If a task encodes only the shipped behavior, a wrong implementation gets a passing suite.

`grounding.intentVsBuilt` is therefore part of the v1 snapshot and approval digest. After source
grounding and before planning tests, every acceptance-criterion row must be `same`, `accepted`
(with `acceptedBy`), `defect`, `parked` (with a sibling SERV key), or `ask-product`.
`ask-product` and a missing classification emit `classify-intent-vs-built` and block planning.
`defect` emits `resolve-intent-vs-built-defect` and blocks verified/complete.

External-execution tests must record `honesty` (`live` | `stubbed` | `seeded`) and bind
`acceptanceIds`. A stubbed Cypress or agent self-report cannot complete a `same` or `accepted` row.
Independent live or seeded oracles are required.

## Consequences

- One task can span UI, API, Oracle, automation, and product-contract repositories without loading
  their full contents.
- Frontend functional, impacted regression, and Smoke scope are explicit plan fields rather than an
  afterthought.
- Stale Jira data, changed source SHAs, changed scope, dependency cycles, missing approvals, and
  missing native artifacts fail closed.
- Repository-local rules and security boundaries remain authoritative; this protocol grants no new
  write access.
- `scripts/harness/test-task-protocol.mjs` and routing goldens verify the deterministic mechanics.
