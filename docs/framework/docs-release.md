# Documentation release note

Revision id: `docs-2026-09-22`
Date: 2026-09-22

What changed in the engine doc spine at this revision. One note per revision, overwritten by the
next one — not a table of contents, not a second copy of any page, and never accumulated into a
series. Reached from the revision stamp at the top of [`../../CLAUDE.md`](../../CLAUDE.md).

Reader path for the spine itself: `ONBOARDING.md` → `CLAUDE.md` →
[`harness-engineering.md`](harness-engineering.md) → [`repository-routing.md`](repository-routing.md)
→ [`qa-control-plane.md`](qa-control-plane.md) → [`../governance.md`](../governance.md) → the cited ADR.

| Path | Kind | What changed |
|---|---|---|
| `ONBOARDING.md` | updated | Setup-only spine; sync projects the workspace root only (lanes get no `.claude/`); ends at `CLAUDE.md`. Operator commands are `node`/`git` on Linux, macOS, and Windows; env opt-in and gate inspection list POSIX, PowerShell, and cmd (ADR-0051). |
| `CLAUDE.md` | updated | Slim router to the engine role and hand-off to `harness-engineering.md`; revision stamp links here. |
| `docs/framework/harness-engineering.md` | updated | System overview and the single home for current gate and sync behavior; reader path connectors → harness → loops → task protocol. Removed the Context engineering, Memory engineering, and Graph engineering sections and collapsed eval/calibration duplication; `engineering.context`/`engineering.memory` keep one pointer naming the two keys that still bind an agent. Change protocol now carries the engine operating facts: `verify-canonical.mjs`, `core.hooksPath`, sync targets and their env overrides, and the hook rationale ratchet. |
| `docs/framework/harness-engineering.md` | updated | New **Hooks, agents, and skills** section: what each roster is, who invokes it, the five hook classes with members and firing phases, the seven agents with when/why, the skills grouped by purpose with the `skillLanes` restriction, and the path one prompt takes through all three. Points at the generated `.claude/rules/agent-spawning-gate.md` as the runtime copy. |
| `docs/adr/0041-hook-ordering-classes.md` | updated | Accepted; **As accepted** records the three reordered lists, the no-verdict-change argument, and the resulting per-tool class sequences. |
| `docs/framework/repository-routing.md` | updated | Ticket source selection spine; read-next to QA control plane. Removed the Context engineering mindmap branch, execution-envelope taxonomy, and Obsidian retrieval paragraph. |
| `docs/framework/qa-control-plane.md` | updated | Intake and command center; links the gate sequence instead of restating it; read-next to governance. Removed the Obsidian/memory restatement. |
| `docs/governance.md` | updated | When an ADR is required; read-next to the cited ADR with 0001 as the process example. |
| `docs/adr/0016-task-scoped-sdlc-protocol.md` | updated | Amendment pointers to ADR-0036 and ADR-0039. |
| `docs/adr/0018-payload-remote-split.md` | updated | Open target-state closed by ADR-0035 — no new repository; this remote is home. |
| `docs/adr/0051-shell-agnostic-operator-commands.md` | new | Operator commands, owner opt-in, and read-intent classification are the same in POSIX, PowerShell, and cmd. Protected files land through `0051-apply.mjs`. |
| `docs/framework/docs-release.md` | new | This note. |

Every page above carries the `docs-2026-09-22` stamp.

The hook-ordering work (ADR-0041, `check-hook-order.mjs`, `hookPhaseOrder` in
`loader-templates.mjs`, and the three reordered hook lists) ships as its own commit, with the
roster section and the ADR amendment above. `check-hook-order.mjs` passes and is in
`engineering.harness.verify.canonical`.

ADR-0043 (active task resolved from the ticket or title the prompt names) ships as its own
commit. It updates the active-task wording in `CLAUDE.md`, `harness-engineering.md`,
`qa-control-plane.md`, `repository-routing.md`, and the two generated rules. The earlier ADRs that
name `FHF_ACTIVE_TASK` stay as written; ADR-0043 amends them. ADR-0044 (every prompt is a task;
an unticketed prompt is a quick task with one owner confirm) follows it and supersedes ADR-0043's
silent path/branch selection.
