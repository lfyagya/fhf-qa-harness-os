# ADR-0020 - Retire the Parallel Backend Harness

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-26 |

## Context

A second control plane existed in the FHF workspace. `fhf-backend-agentic-harness` declared its own
schema (`fhf-backend-agentic-harness/v1`), a thirteen-entry source registry, an `evidence-only`
default execution mode, its own forbidden-operation list and failure limit, plus an `AGENTS.md`, an
architecture document, a generated source inventory, and inventory and validation scripts.

Nothing in this repository referenced it. It was absent from `productTopology`. It was not a git
repository and was untracked in FHF, so `git clean -fdx` would have removed it without a trace.

That combination is the problem. A second definition of backend boundaries that no tooling reads
cannot be enforced, but it can still be *found* — by a person or an agent — and followed instead of
the plane that is enforced. Two documents describing the same boundaries will eventually disagree,
and the unenforced one is the one that drifts unnoticed.

The trigger list in `docs/governance.md` does not enumerate control-plane or topology retirement.
This record follows the practice set by ADR-0001, ADR-0010, and ADR-0012, which treat repository
topology as ADR-worthy even though the list names only hook topology, the agent roster, and skill
routing.

## Decision

Retired. One control plane governs both automation layers.

A comparison against `config/qa-control-plane.json` found it superseded on every count but one:

| Its content | Status here |
|---|---|
| Thirteen sources | All present in `productTopology.repositories`, classified by `kind`, `roles`, `businessDomains`, `entryPaths`, `instructions`, and `evidence` |
| Five forbidden operations | All five have equivalents, enforced by hooks rather than declared in prose: `manual-task-guard`, `protect-automation-scope`, `dependencyChanges`, `autoDeploy`, `externalUploads` |
| `sameFailureLimit: 3` | Identical to `engineering.loops.sameFailureLimit` |
| `allure-results` evidence | Already referenced in the control plane and the backend task-runner test |
| `evidence-only` execution mode | Subsumed by the task protocol's proof modes and stage gating |
| Seven trace chains, eleven pairs | Six already declared as edges; five were not |

The five undeclared pairs were its only unique content. Four were verified against live source and
added as `data-contract` edges with citations: `fhf-rest-internal`, `fhf-serv-agents`, `fhf-letters`,
and `fhf-reposession`, each to `fhf_documents`. The fifth, `fhf-llm-poc` to `fhf-serv-agents`, was
rejected: no reference exists in either direction, and the catalogue's own authority requires live
source rather than an inherited assertion.

The directory was then removed from the workspace.

## Consequences

Backend and frontend automation now resolve boundaries, topology, runners, and routing from one
place. This does not change the federation that ADR-0010 and ADR-0017 established: repository-local
rules inside `fhf-backend-automation` remain authoritative and receive no projection. Retiring a
duplicate plane is not the same as centralising the rules it duplicated.

The four added edges close a real routing gap rather than a documentation one. Because
`progressiveLoading.expandOnlyWithReason` accepts `declared-topology-edge`, grounding a Letters or
Repossession change previously froze a source slice containing no Oracle while reporting itself
complete.

**This ADR is the only durable record that the parallel harness existed.** The directory was never
tracked in any repository, so its removal produced no diff. A copy of its eight files was kept in a
session scratchpad, which is ephemeral and should not be relied on.

If a separate backend harness is ever wanted again, the requirement this one was meeting — routing
across backend sources and naming their dependency chains — is now served by `productTopology.edges`
and `sourceBundles`. Re-creating a separate plane should supersede this record explicitly rather than
appear alongside it.

**What does NOT change:** hook topology, the agent roster, skill routing, lane contracts, the
engine/payload split from ADR-0001 and ADR-0018, and the backend task-scoping from ADR-0010 and
ADR-0017.
