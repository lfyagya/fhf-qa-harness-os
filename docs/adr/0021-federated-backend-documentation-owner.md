# ADR-0021 - Federated Backend Documentation Owner

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-26 |
| **Amended by** | ADR-0048 (the owner moved to the harness-owned backend guide) |

## Context

`documentation.owners` named eleven concerns and none of them was backend. Read as a gap, that
invites a central backend standards document. The evidence says otherwise.

Authority already exists and is substantial. `fhf-backend-automation` carries 225 lines of
`CLAUDE.md`, six rule files totalling 456 lines covering API standards, assertions, module creation,
Oracle access, security, and testing, a persona, nine generator skills, and a coverage-audit
workflow. ADR-0010 and ADR-0017 made those authoritative and deliberately projected nothing into
that repository.

The contract side is also already owned centrally. `docs/framework/testing-standards/TESTS.md` has a
`Backend API/database` lane contract, and the false-green controls, assertion depth, and evidence
minimums apply to every lane. So the split is not missing — it is undeclared.

What is actually broken is the direction of the pointers. The control plane points *into* the backend
repository twice: `productTopology.repositories.fhf-backend-automation.instructions` names its
`CLAUDE.md`, and the backend routes tell a specialist to read it. Nothing points back. The backend
repository's own `CLAUDE.md` never mentions the control plane, the task manifest, `FHF_ACTIVE_TASK`,
or the gate.

That asymmetry works from one entry point and fails from the other. Arriving through the harness, a
contributor is routed correctly. Opening the backend repository directly — which is what a backend QA
adopting this workflow will do — they get 702 lines of local rules and no indication that
manifest-scoped writes, an evidence contract, or a review gate exist at all.

## Decision

No central backend standards document is created. Backend authoring rules stay where they are, and
the federation becomes explicit rather than implied.

`documentation.owners` gains `backend-standards`, pointing at
`fhf-backend-automation/CLAUDE.md`. An owner outside the documentation tree has precedent:
`regression-sprint-records` already points into `front-end-automation-e2e/docs/`.

The division of labour is stated rather than inferred. The control plane owns the *contract* — what
counts as backend coverage, the required evidence, the false-green controls — in `TESTS.md`. The
repository owns the *implementation* — how a test is written, how a module is scaffolded, how Oracle
is reached. A rule that says what proof is acceptable belongs here; a rule that says which helper to
call belongs there.

The documentation router gains a row naming the federated owner, the repository-local authority, and
the contract that still applies.

## Consequences

Twelve documentation owners, no content moved, and no duplication introduced. Had a central backend
document been created instead, it would have restated 702 lines that are already authoritative and
reversed ADR-0010 by making the central plane the place backend rules live.

**The missing back-pointer is not fixed by this decision, and cannot be.** The backend repository's
`CLAUDE.md` sits outside `allowedWriteRoots` for that repository, so the harness is refused write
access to it by design — correctly, since that boundary is what keeps agent edits inside selected
test paths. Adding a short section there that names the central boundary, the task manifest, and the
gate is a request to that repository's owner, not work this plane can perform. Until it lands, the
asymmetric entry point remains: routed contributors are fine, direct arrivals are not.

Backend coverage remains the separate and larger problem. Eleven of fourteen modules have no recorded
backend evidence. Declaring an owner changes where the rules are read, not how much is tested.

**What does NOT change:** hook topology, the agent roster, skill routing, the engine/payload split,
the task-scoped backend boundary from ADR-0010 and ADR-0017, and `TESTS.md` as the owner of every
lane contract including the backend one.
