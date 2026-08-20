# ADR-0013 - Policy Classification and Placement

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-19 |

## Context

The harness previously defined source precedence and document ownership, but it did not distinguish
regulatory authority, public FHF commitments, approved internal policy, application contracts,
implementation observations, execution evidence, and unapproved research. That ambiguity allowed a
web finding, ticket, UI condition, or passing test to be mistaken for an adopted business rule and
made it unclear whether detailed logic belonged in harness configuration, product specifications,
source code, runtime state, or evidence.

## Decision

Add `policyGovernance` to `config/qa-control-plane.json` as the single tool-neutral taxonomy and
placement contract. It defines source categories, adoption and applicability states, the minimum rule
record, fail-closed decision conditions, and explicit do/do-not boundaries. The deterministic
documentation check validates the contract, and generated consumer harness configurations inherit it.

The control plane stores classification and gates only. Detailed business rules, thresholds, formulas,
allowed dropdown values, state transitions, and source citations remain in the configured application
contract. Executable behavior remains in application/API/backend source. Runtime selection and evidence
remain non-policy artifacts. Research and observed implementation cannot become approved policy without
a named owner decision.

## Consequences

- Root, E2E, and Smoke agents receive one consistent classification and placement contract.
- Unknown applicability, source conflicts, missing fields, or missing approval block adoption or
  enforcement and escalate to the owner.
- Official web research can support a proposal but cannot silently create product behavior or a legal
  conclusion.
- The harness does not duplicate application policy, statutes, secrets, local paths, or runtime facts.
- No hook topology, agent roster, skill route, test payload, or application source changes as a result
  of this decision.
