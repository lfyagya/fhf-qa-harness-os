# ADR-0035 — The Payload Home Is the Engine Remote's `fhf-docs` Branch

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-16 |
| **Supersedes** | ADR-0018's target-state and `Open` clauses. Its placement, storage and never-merge decisions stand. |

## Context

ADR-0018 gave the payload a remote by pushing FHF's documentation history to
`git@github.com:lfyagya/fhf-qa-harness-os.git` as branch `fhf-docs`, whose history is unrelated to
`main`. It called that arrangement interim — "a parking spot, not a home" — and named an
organization-owned private repository as the target state, left open as an owner decision.

That decision is taken here: **no new repository.** The existing remote is the home.

The arrangement has held and grown since 2026-08-26. Verified 2026-09-16:

```
$ git -C ~/FHF rev-list --left-right --count fhf-docs...harness-os/fhf-docs
0       0
```

- 46 tracked payload files, up from the 22 ADR-0018 committed.
- 11 of the 14 `documentation.owners` entries resolve to FHF-relative payload paths. The other three
  point at the specs repo, `front-end-automation-e2e`, and `fhf-backend-automation`.
- `.gitattributes` pins `eol=lf`, so a second clone does not report every file as modified.
- The branch carries an allowlist `.gitignore`: generated evidence (`/docs/evidence/*.json`),
  the demo tree, and named drafts stay ignored and regenerable, so a stray `git add -A` on the
  payload branch cannot absorb the workspace around it.

What ADR-0018 wanted from an organization-owned repository was durable, private, non-personal
hosting. The existing remote is private and durable. It is not non-personal, and creating a second
repository is not what makes it so — transferring ownership of this one would. Standing up a new
repository to solve an account-ownership problem adds a migration, a remote rename, and a second
place for the payload to live, and leaves the account question exactly where it was.

## Decision

1. **`fhf-docs` on `lfyagya/fhf-qa-harness-os` is the payload home.** Not interim, not a backup.
   Documentation, coverage evidence, planning, and standards are versioned there.

2. **`main` stays engine-only and `fhf-docs` is never merged into it.** Unchanged from ADR-0018 and
   ADR-0001. The engine remains FHF-agnostic scaffolding; the payload borrows the remote as storage
   without entering the engine's history. Retained from ADR-0026: never check out an engine branch
   in the FHF workspace, and never check out `fhf-docs` in the engine clone.

3. **Payload access is repository-scoped, and that is accepted.** GitHub grants read access per
   repository, not per branch. A contributor given the payload is also given the engine on `main`.
   This is a consequence of choosing the shared remote, not an oversight, and it is not to be
   worked around with a partial clone or a sparse checkout.

4. **The onboarding path is documented, not improvised.** ADR-0018 recorded that reaching the
   payload means cloning the engine and checking out an unrelated-history branch, and accepted that
   only because it was temporary. It is now permanent, so it is written down where a contributor
   finds it before they need it — `docs/README.md` on the payload branch, and the workspace
   `CLAUDE.md`.

## Consequences

`documentation.owners`, the Confluence publisher's `sourceRepository`, relative links, and
`check-docs-links.mjs` continue to work unchanged, because nothing moves. No migration, no remote
rename, no re-pointing of the 11 FHF-relative owners.

Two costs are accepted rather than solved, and are recorded here so they are not rediscovered as
defects:

- **Account ownership.** The payload lives under a personal account. Offboarding or loss of that
  account takes the payload and the engine together. The mitigation available today is a second
  clone of the branch on another machine, not a second repository.
- **Access coupling.** Granting payload access grants engine access. If a contributor should have
  the documentation but not the harness internals, this arrangement cannot express that, and the
  request should reopen the hosting question rather than be satisfied by a workaround.

The alternatives ADR-0018 rejected stay rejected, and for its reasons: folding `docs/` into the
engine's own history reverses ADR-0001's payload clause, and relocating the tree into
`front-end-automation-e2e` breaks `documentation.owners`, the publisher's source resolution, and
every relative link.

**What does NOT change:** hook topology, the agent roster, skill routing, lane contracts, the
engine/payload boundary from ADR-0001, the worktree separation from ADR-0026, gate self-governance
from ADR-0027, and Confluence remaining a generated projection of this Markdown. The FHF workspace
itself stays unversioned by design and reproducible through `node .harness/setup.mjs`.

**Open:** transferring `lfyagya/fhf-qa-harness-os` to an organization account. This ADR removes it
as a prerequisite for the payload having a home; it does not resolve it. Taking it later is a remote
rename on two clones and needs no change to this decision.
