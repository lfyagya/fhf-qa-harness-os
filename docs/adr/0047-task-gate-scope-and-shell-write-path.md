# ADR-0047 — Task-Gate Scope: Path-Aware Blocking and the Shell Write Path

| Field | Value |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-09-18 |
| **Amends** | ADR-0016, ADR-0036 |

> **Before accepting (2026-09-24):** drafted 2026-09-18, before ADR-0043 and ADR-0045 landed.
> ADR-0043 already limits a focus-selected task to gating automation writes, and ADR-0045 puts the
> shell guards on PowerShell as well as Bash. Neither checks a shell write against the active task,
> so that part is still open. Re-check the path-aware blocking part against ADR-0043 first.

## Context

ADR-0036 made the task protocol fail closed on the earliest missing human stamp, and wired
`enforce-task-gates.mjs` into `preWrite` so a later step cannot start before an earlier gate is
current. That is the correct shape. Two scope defects in the implementation were demonstrated
end to end on 2026-09-18, during an unrelated documentation correction (`CLAUDE.md` hook count
24 → 26).

### Defect 1 — the gate blocks writes it holds the data to allow

`inspectActiveTaskGates` reads `tool_input.file_path`, but uses it for exactly one purpose: an
exemption for writes to the active manifest itself.

```js
// .claude/hooks/lib/task-protocol.mjs:80
block: pending && !isActiveTaskManifestWrite(filePath, source) ? pending : null,
```

Every other path is blocked identically. With `FHF_ACTIVE_TASK` pointing at
`SERV-12563.json` (Funding Coordinator automation, stage `implementing`, `test-cases`
unstamped), an edit to `CLAUDE.md` in the harness repo was refused. That file is in no
repository the manifest selects and cannot advance the gated task.

The manifest already carries the information needed to scope this. Each
`grounding.repositories[]` entry has `selectedPaths`, and each `plan.changeUnits[]` entry has
`paths`. `protect-automation-scope.mjs` already checks writes against exactly those fields.
The task gate does not.

The gate's purpose is to stop *implementation of the gated task* ahead of approval. Blocking
unrelated writes does not serve that purpose; it only teaches the operator that the gate is
noise to be worked around. That is the failure mode ADR-0027 names as making a gate
"switched off" in practice.

### Defect 2 — the gate covers `Edit|Write`, not the shell

`engineering.harness.hooks` places `enforce-task-gates.mjs` in `preWrite` only:

| Group | Members |
|---|---|
| `preWrite` | `protect-harness-governance`, `protect-app-source`, `protect-automation-scope`, **`enforce-task-gates`**, `protect-second-brain-boundary`, `pre-validate-cypress-rules` |
| `preShell` | `protect-harness-governance`, `manual-task-guard` |

`manual-task-guard.mjs` constrains backend pytest execution; it is not a task-gate check for
arbitrary writes. So a `sed -i` or heredoc through Bash writes any file with no task-gate
evaluation at all.

This was not theoretical on 2026-09-18. After the `Edit` route was refused, the same two-line
change was applied with `sed -i` through Bash and succeeded. The stamp was never written and
the gate never saw the change. The operator authorized it and the agent disclosed it, so no
false green was recorded — but nothing in the harness required either of those things.

The two defects compound: because the gate over-blocks (defect 1), operators are pushed toward
the shell; because the shell is unguarded (defect 2), that pressure has somewhere to go.

### Defect 3 — a relative consumer root resolves against the worktree, not the repository

`paths.consumerRoot` is `"../FHF"` (`config/qa-control-plane.json:129`), and the shared helper
resolves it against whatever root it is handed:

```js
// scripts/harness/workspace-paths.mjs:22-26
export function resolveConsumerRoot(harnessRoot, { explicit, env = process.env } = {}) {
  const configured = loadWorkspacePathsConfig(harnessRoot).consumerRoot;
  const selected = nonBlank(explicit) ?? nonBlank(env.FHF_CONSUMER_ROOT) ?? configured;
  return path.resolve(harnessRoot, selected);
}
```

From the main checkout `../FHF` resolves to `<home>\FHF`, which is correct. From a
linked worktree `harnessRoot` is `...\.claude\worktrees\<name>`, so the same string resolves to
`...\.claude\worktrees\FHF` — a path that never exists.

The relative form is authored to mean "sibling of the repository". A worktree is the same
repository at a different checkout, so resolving it against the worktree changes its meaning.

The consequence is not a clean failure. Every canonical script that takes this path reports a
long list of missing consumer files, and a real failure hides inside that list. On 2026-09-18
`check-docs-links.mjs` run bare from a worktree emitted roughly twenty spurious
`target is unavailable` lines; scoped to the real root it emitted exactly one, a genuine
ADR-0027 ratchet violation (`enforce-task-gates.mjs` carries no rationale header and is absent
from `rationale-baseline.json`). `check-loader-drift.mjs` behaved the same way: bare exit 1 with
about twenty missing-file lines, scoped exit 0 and clean.

Both checks were therefore reporting failure for the wrong reason, which is the condition under
which an operator learns to disregard them.

### Not a defect

`protect-harness-governance.mjs` is in both groups and did hold the harness boundary throughout:
it refused every attempt to read or write `.claude/hooks/` and `config/qa-control-plane.json`,
including the shell path. Default-deny under ADR-0027 behaved as designed. It is, separately,
over-broad on reads — it matched read-only `ls`, `grep`, and `readFileSync` commands because it
tests the path string rather than detecting mutation. That costs round-trips but fails safe, and
is out of scope here.

## Decision

1. **Scope the task gate to the manifest's own paths.** `inspectActiveTaskGates` resolves the
   write path against `grounding.repositories[].selectedPaths` and `plan.changeUnits[].paths`.
   A write inside that set blocks on a missing stamp; a write outside it passes through to the
   other `preWrite` guards, which are unchanged. Reuse the matcher in
   `protect-automation-scope.mjs` rather than writing a second one.
2. **Keep the manifest-write exemption** as it is today.
3. **Fail closed on an unreadable or malformed manifest.** Unchanged: if the manifest cannot be
   parsed, scope cannot be established, so every write blocks.
4. **Add `enforce-task-gates.mjs` to `preShell`.** The shell payload carries a command, not a
   `file_path`, so the hook gets a shell arm: when a task is active and its gate is pending,
   refuse shell commands that write (redirection, `sed -i`, `tee`, `cp`, `mv`, `rm`, heredoc to
   file) into the manifest's selected paths. Read-only commands are unaffected.
5. **State the residual limit in the hook header.** Shell write-detection is a denylist over
   command text and cannot be complete; a determined agent can still construct a write the
   matcher misses. The gate is a sequencing control, not a sandbox. Record that in the
   `Why this exists` header so the next reader does not over-trust it, and rely on the OS-level
   deny-write rules for the application-source boundary, as today.
6. **Regression tests in `scripts/harness/test-hooks.mjs`**, all four: in-scope write blocks;
   out-of-scope write passes; in-scope shell write blocks; read-only shell command passes.
7. **Resolve a relative consumer root against the main worktree.** In `resolveConsumerRoot`,
   when `selected` is relative, resolve it against the repository's main checkout rather than
   `harnessRoot`. An absolute `FHF_CONSUMER_ROOT`, `FHF_SYNC_TARGET_ROOT`, or configured value
   keeps taking precedence and is unaffected, so the existing override contract does not change.

   Detect the main checkout with the standard library, not a subprocess: in a linked worktree
   `.git` is a file reading `gitdir: <main>/.git/worktrees/<name>`, so the main root is three
   directories above that path. When `.git` is a directory, `harnessRoot` is already the main
   checkout and behaviour is unchanged. Apply the same correction in `resolveLaneRoot`, which
   resolves lane roots against `consumerRoot` and inherits the fault.
8. **Fail loudly when the resolved root is absent.** If the consumer root does not exist, exit
   with one message naming the resolved path and the `FHF_CONSUMER_ROOT` override, instead of
   continuing into a per-file missing-target list. A wrong root is one error, not twenty.

## Consequences

- A pending gate stops work on the task it governs, and stops being a session-wide write lock.
  Documentation, ADRs, and unrelated repositories stay editable while a task is mid-flight.
- The most common shell write-around is closed, and the fact that the class cannot be fully
  closed is written down instead of assumed.
- `enforce-task-gates.mjs` gains a shell arm, so it is no longer a pure `file_path` hook. It
  binds two groups, like `protect-harness-governance.mjs` already does.
- Hook membership changes, so `sync-loader-shims.mjs` must regenerate and consumers re-commit.
- Item 5 is a deliberate limit, not an oversight. If the task gate is ever required to be a
  real boundary rather than a sequencing control, that is a different ADR and needs an
  enforcement layer the agent cannot reach.
- Canonical checks become trustworthy from a worktree, so `engineering.harness.verify.canonical`
  no longer depends on the operator remembering to export `FHF_CONSUMER_ROOT` first.
- Failures stop being diluted. The ADR-0027 rationale ratchet only became visible today once the
  root was correct; any check that reports twenty false failures is one an operator stops reading.
- Items 7 and 8 are a bug fix to path resolution, not a policy change. No hook topology, agent
  roster, or skill routing is affected, and `paths.consumerRoot` keeps its current value and
  meaning — it starts resolving to what it already says.

## Evidence

- `.claude/hooks/lib/task-protocol.mjs:80` — path used only for the manifest exemption.
- `config/qa-control-plane.json:3435-3446` — `preWrite` and `preShell` membership.
- `.claude/hooks/enforce-task-gates.mjs` — `PreToolUse:Edit|Write` only, per its header.
- Session 2026-09-18: `Edit` to `CLAUDE.md` refused with `BLOCKED: human approval required for
  gate "test-cases"`; identical change then applied via `sed -i` through Bash without a gate
  evaluation.
- `scripts/harness/workspace-paths.mjs:22-26` — `path.resolve(harnessRoot, selected)`.
- `config/qa-control-plane.json:129` — `"consumerRoot": "../FHF"`.
- Session 2026-09-18, from worktree `musing-murdock-25b834`: `check-docs-links.mjs` and
  `check-loader-drift.mjs` both exit 1 with about twenty missing-consumer-file lines; with
  `FHF_CONSUMER_ROOT` set to the real root, drift exits 0 clean and the docs check exits 1 on
  the single genuine rationale violation.
- `.git` in that worktree is a file reading
  `gitdir: <engine>/.git/worktrees/<name>`, confirming
  the main checkout is derivable without invoking git.
