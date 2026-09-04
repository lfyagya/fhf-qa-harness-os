# ADR-0026 — Engine and Payload Worktree Separation

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-05 |

## Context

ADR-0018 parked the documentation payload on branch `fhf-docs`, whose history is unrelated to
`main`, and kept payload placement on the FHF side. It recorded one cost — onboarding means checking
out an unrelated-history branch — and missed a larger one.

The engine was checked out *at* the workspace root (`<parent>/FHF`) rather than as its sibling. That makes
`paths.consumerRoot: "../FHF"` an identity no-op: `HARNESS_ROOT` and `FHF_ROOT` resolve to the same
directory. The engine main line and the payload branch then compete for one working tree, and only
one can be present at a time. Checking out any engine branch deletes every payload-only file from
disk.

The visible symptom was `check-docs-links.mjs` failing on five `documentation.owners` entries and
four Confluence publication sources — nine paths that were never moved, renamed, or deleted
(`git log --diff-filter=D` is empty for all of them). They were simply on the other branch. Two
further consequences had already landed:

- Commit `7454da2` on `fhf-docs`, "checkpoint before checking out main", swept the entire workspace
  into the payload branch as twelve accidental gitlinks — a workaround for this same collision.
- Five `docs/` paths were tracked on both branches and four had diverged, so `qa-onboarding`,
  `qa-adoption` and `selectors` resolved to the engine copy while Confluence published from the
  payload copy. Nothing detected it.

A stale `/scripts/` line in `.git/info/exclude`, left from the workspace-era checkout, separately
hid every new file under `scripts/` from git. Fourteen engine files existed only as untracked local
copies, including `import-graph-lib.mjs` and `test-import-graph.mjs` — both required by
`engineering.harness.verify.canonical` — and `npmrc.example`, a hard `readFileSync` dependency of
`sync-loader-shims.mjs`. A fresh clone could not run sync at all.

## Decision

The two trees are separated, as ADR-0001 and ADR-0018 always specified, and implemented as two
worktrees of one repository rather than two clones:

- the engine checkout (`<parent>/qa-harness-os`) — the engine, on an engine branch. Authoritative
  `.claude/{hooks,agents,rules,skills}` source.
- the workspace root (`<parent>/FHF`) — the consumer workspace, on `fhf-docs`. Holds the documentation payload,
  the lane repositories, and the generated local-only projection of `.claude/`.

`paths.consumerRoot: "../FHF"` now resolves correctly from the engine root and is unchanged. No
`documentation.owners` entry was repointed and none was deleted.

Artefacts that resolve against `paths.consumerRoot` live on the payload branch. `docs/standards/pr-template-frontend.md`
and `docs/standards/pr-template-backend.md` were engine-branch-only and moved to `fhf-docs`
accordingly; leaving them on the engine branch would have broken two owners the moment the trees
separated.

`fhf-docs` was reset to its remote state to drop `7454da2`'s gitlinks, preserving that commit's one
real documentation edit and retaining the commit as branch `payload-checkpoint-7454da2`.

## Consequences

`engineering.harness.verify.canonical` passes 18/18 from the engine root.

Checking out an engine branch at the workspace root (`<parent>/FHF`) reintroduces every failure above. The
payload workspace stays on `fhf-docs`.

`.git/info/exclude` is shared across worktrees, so its workspace-era rules (`/scripts/`, `/.claude/`,
`/CLAUDE.md`, `/GEMINI.md`, `/.harness/`) still apply in the engine worktree, where they hide *new*
untracked files under those paths. Tracked files are unaffected, so this is a hazard for added
files only — it is what stranded fourteen of them. Not fixed here: the rules are correct for the
payload workspace and wrong for the engine, and separating them needs `extensions.worktreeConfig`
with a per-worktree `core.excludesFile`. Until then, `git add -f` is required for new files under
those paths, and `git status` must not be trusted to show them.

What does not change: payload placement (ADR-0018's decision stands — the payload is not folded
into the engine), `documentation.owners` content, the Confluence page map and its page ids, and the
target state of an organization-owned private payload repository, which this makes no less
necessary.
