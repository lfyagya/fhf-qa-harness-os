# ADR-0034 — A Shipped Skill Must Be Usable

| Field | Value |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-09-16 |
| **Extends** | ADR-0022 (allow-listing a skill is an ADR decision) |

## Context

Nine of the nineteen skills projected into the workspace were refused the moment they were invoked.
Verified by running the guard rather than inferred:

```
generate-api-client    exit=2   BLOCKED: skill is not in the FHF allowlist
setup-test-module      exit=2
smoke-tests-writer     exit=2
plan                   exit=2
```

Eight of the nine are the entire backend authoring family — `generate-api-client`,
`generate-conftest`, `generate-data-builder`, `generate-test-file`, `setup-test-module`,
`e2e-tests-generator`, `smoke-test-cases`, `smoke-tests-writer` — plus `plan`. `backend-test-author`
was the only backend skill that worked.

Two independent defects stacked. None of the eight carried frontmatter, so they had no `description`
and intent routing had nothing to match on; a backend task could never be routed to
`generate-api-client` by what it does. And none were in `engineering.harness.skills`, so even a
correct route would be refused at the gate.

This survived every check in the repository. `18/18` canonical scripts and 160+ hook self-tests
passed throughout, because each verifies that what is *declared* is *projected*. Nothing verified the
other direction: that something shipped is usable. ADR-0032 had just centralised the projection so
every consumer receives the full set, which made nine dead entries a cost paid in every session.

## Decision

1. **All nine are allow-listed, not deleted.** They carry 3.2K–11.8K characters of working
   instructions each. The alternative — deleting a family of skills that the backend lane needs
   because a roster entry was missed — is the wrong repair for a bookkeeping failure.

2. **The eight gain `name` and `description` frontmatter**, derived from each skill's own opening
   prose rather than invented. A description is what intent routing matches on, so a wrong one routes
   work to the wrong skill, which is worse than routing nowhere.

3. **`check-docs-links.mjs` asserts that a shipped skill is usable.** For every directory under
   `.claude/skills/`: it must appear in `engineering.harness.skills`, it must have a `SKILL.md`, and
   that file must declare a non-empty `description`. This is the check whose absence let nine skills
   sit dead, and it is the reverse direction of every check that already existed.

   Verified by removing `generate-api-client` from the allowlist and re-running: the check failed
   with exit 1 naming the skill, and passed again once restored. A gate that has not been observed
   failing has not been shown to work.

## Consequences

The backend authoring family is reachable. `generate-api-client`, `setup-test-module`,
`smoke-tests-writer`, `plan` and the rest now return exit 0 from `block-forbidden-skills`, and appear
to intent routing with a description of what they do.

Adding a skill now costs an allowlist entry and a description, enforced at check time rather than
discovered when someone invokes it and is refused. That is a small tax on a real failure mode.

This does not decide what a skill's description should *say*, nor check that a skill still works. A
skill can be allow-listed, described, and wrong. That is a review question, not a mechanical one, and
this ADR does not pretend otherwise.

The roster shape is unchanged: `engineering.harness.skills` remains a bare name list. Giving skills
the identity model the specs use — id, owner, version, tags — is a larger change and is not decided
here.
