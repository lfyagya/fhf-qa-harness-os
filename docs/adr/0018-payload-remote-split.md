# ADR-0018 - Payload Remote Split

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-26 |

## Context

ADR-0001 split this engine from its payload and placed FHF's documentation, coverage evidence, and
automation backlog on the payload side, where they remain. It did not say where the payload is
*versioned*, and the answer turned out to be nowhere.

The FHF workspace had no git remote. `/docs/` was listed in its `.git/info/exclude`, so three of the
twenty-five documentation files were tracked and the rest existed as a single uncommitted copy on one
machine. This is not a peripheral tree: `documentation.owners` names FHF-relative paths for ten of its
eleven owners, and `documentation.publishing.confluence.sourceRepository` is `FHF`. The declared
documentation source repository was unversioned and unbacked, and
`docs/evidence/regression-effort/README.md` already records two sprint records nearly lost to
`git clean -fdx`.

The workspace itself cannot be the answer. FHF is a workspace, not a project: its children are
independently remoted repositories with their own access rules. A workspace is reproduced from a
manifest — `workspaceContract` plus `.harness/workspace.local.json` — not versioned as a unit.

## Decision

Payload placement is unchanged: documentation stays on the FHF side, as ADR-0001 accepted. The payload
gains a remote of its own.

Interim state, in place now. FHF's documentation history is pushed to
`git@github.com:lfyagya/qa-harness-os.git` as branch `fhf-docs`, whose history is unrelated to `main`
and is never merged into it. This borrows the engine's remote as storage without placing payload in the
engine: `main` stays engine-only, so this repository remains FHF-agnostic scaffolding. `fhf-docs` is a
parking spot, not a home.

Mechanically, in the FHF consumer: `/docs/` was removed from `.git/info/exclude` and the remaining 22
files committed; `.gitattributes` pins `eol=lf`, because `core.autocrlf=true` with no attributes file
makes a second clone report every file as modified. `.gitignore` stays excluded — it is harness-managed
local scaffolding, and the runtime evidence it protects is only generated inside a configured
workspace. Generated evidence, including `docs/evidence/coverage-computed.json`, stays ignored and
regenerable.

Target state. An organization-owned private repository holds the documentation payload, and the FHF
remote is renamed to it. Private is a requirement, not a preference: the tree names internal hostnames,
Cypress Cloud project identifiers, and commit SHAs.

Two alternatives were considered and rejected. Folding `FHF/docs` into this repository reverses
ADR-0001's payload clause and destroys the FHF-agnostic property that motivated the relocation.
Relocating the tree into `front-end-automation-e2e` breaks `documentation.owners`, the publisher's
`sourceRepository`, and every relative link the tree resolves today.

## Consequences

`documentation.owners`, the Confluence publisher's source resolution, relative links, and
`check-docs-links.mjs` all continue to work unchanged, because no document moved.

The interim state has one real cost: onboarding a contributor to the payload means cloning the engine
and checking out an unrelated-history branch of it. That is acceptable as a parking spot and is the
reason the target state matters — a backend QA joining the workflow should not receive that as a first
instruction.

Confluence remains a generated projection of this Markdown, per
`documentation.publishing.confluence.authority`. Registering an additional page is a configuration
change plus an approval-gated publish run; it is not part of this decision.

**What does NOT change:** hook topology, the agent roster, skill routing, lane contracts, engine
content, and ADR-0001's engine/payload boundary. The FHF workspace itself remains unversioned by
design and reproducible through `node .harness/setup.mjs`.

**Open:** the organization-owned repository is an owner decision and is not taken here. Until it
exists, `fhf-docs` is a backup rather than a home.
