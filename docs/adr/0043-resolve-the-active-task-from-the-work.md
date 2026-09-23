# ADR-0043 — Resolve the Active Task From the Work, Not From the Shell

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-23 |
| **Relates to** | ADR-0017 (task-scoped backend automation), ADR-0039 (one task, one approved manifest) |
| **Amends** | `engineering.taskProtocol.activeManifestEnv` (now an override), `engineering.taskProtocol.activeTask`, `engineering.harness.governance.protectedPaths`, `engineering.taskProtocol.approval.boundFields` |

## Context

ADR-0017 and ADR-0039 made every automation write and run depend on one approved task manifest.
The only way a guard found that manifest was `FHF_ACTIVE_TASK`, an absolute path exported into
the environment the hooks inherit.

That selector was the wrong shape for the work:

- **It is per process, not per task.** The desktop app snapshots its environment at launch, so
  switching tasks meant editing a Windows variable and fully quitting the app. A new session did
  not pick it up.
- **It is static.** On 2026-09-23 five manifests were open at once in `.harness/tasks/`
  (SERV-12563 implementing; 12567, 12584, 12645, 12669 planned). One exported path cannot follow
  a session that moves between them.
- **It only knows Jira.** `ticketFamily.primary` had to be `SERV-n`, so work with no ticket had
  no manifest shape at all.

`manifestPath` already declares where manifests live: `.harness/tasks/<task-id>.json`. What was
missing was a way to say which one the current work is.

## Decision

**The active task is resolved from the work the prompt names.** One resolver in
`task-protocol-lib.mjs` (projected everywhere the guards run) serves every reader: the scope and
gate hooks, `backend-task-runner`, `record-loop-event`, and `doctor`. Resolution order:

1. `FHF_ACTIVE_TASK`, if set. It is still an explicit override for CI and tests.
2. The focus in `.harness/tasks/.focus.json`, which the prompt router writes.

**The prompt router maps each prompt to a manifest and records the focus.** It never blocks:

- A `SERV-n` key selects the open manifest whose `ticketFamily.primary` matches. Failing that, it
  selects the single open manifest that lists the key in `ticketFamily.related`. Manifests are
  matched by content, not file name, because existing names vary
  (`SERV-12563.json` holds id `SERV-12563-funding-coordinator-full-chain`).
- With no key, the prompt is matched against manifest titles by shared terms
  (`activeTask.titleMatch`: at least 3 shared terms covering 60% of the title).
- A key with no manifest clears the focus and names the path the manifest belongs at
  (`.harness/tasks/SERV-n.json`). Automation writes then refuse with that ticket named.
- A prompt with no task signal ("yes", "continue") leaves the focus alone.

**When no task is selected, the guard searches first and asks only if the search fails.** A
refusal that just says "no active task" is a dead end, so an automation write or run with no focus
runs its own search, in order:

1. the prompt focus;
2. the one open manifest whose `grounding.repositories` and `plan.changeUnits` both select the
   path being written (or whose `plan.tests` names the test being run);
3. a `SERV-n` key in the target repository's branch name (backend on `SERV-12669` selects
   `SERV-12669.json`).

If the search finds one manifest, it becomes the focus (`source: path` or `branch`) and the
normal approval and scope checks apply to it. If the search finds none, or more than one, the
refusal is a question for the owner (`TASK NEEDED`). It lists what was searched and offers three
answers: the Jira key, an existing manifest file name (the open ones are listed), or, for work
outside Jira, a keyword or title. The agent asks it as one question and must not guess, create,
or switch a task itself. The focus is marked `awaiting`, so the router matches the next reply
leniently: a file name selects that manifest, and a bare keyword selects the one manifest whose
title or id contains every keyword. An unmatched reply names the file to create and clears the
awaiting mark, so the question is asked once per attempt rather than on every prompt.

The write itself still does not pass without a task. There is no manifest to scope it against,
and allowing it would undo ADR-0039. What changes is that the refusal carries the search and the
question, instead of telling the owner to export an environment variable.

**Local tasks are first-class.** A manifest with `ticketFamily.source: "local"` needs a `title`
and `grounding.intent.digest` (the sha256 of the recorded intent) in place of
`grounding.jira.issueDigest`. Its canonical path is the title slug:
`.harness/tasks/<title-slug>.json`. `grounding.intent` joins the approval-bound fields.
Canonical JSON drops absent keys, so every existing approval digest is unchanged. This was
verified against all seven manifests on disk when the change landed.

**Selecting a task stays a human act.** The focus is written only by the router hook, from the
owner's prompt. `.harness/tasks/.focus.json` is a governance-protected path, so an agent Write,
Edit, or shell redirect to it is refused. `task-protocol.mjs focus --ticket|--title|--clear` is
the manual override and refuses to run from an agent session, the same way `approve` does. The
focus stores a file name inside the task directory, never a path, so it cannot point elsewhere.

**A prompt-selected task gates only automation writes.** `enforce-task-gates` still gates every
write for an explicit `FHF_ACTIVE_TASK`. For a focus-selected task it gates only writes inside an
`automationSource` repository, so mentioning a ticket in passing does not freeze unrelated work.
`protect-automation-scope` is unchanged. Every automation write still needs a current,
human-approved manifest that selects its path.

## Consequences

- No environment variable, restart, or per-task shell step. Naming the ticket or title is the
  selection.
- `task-protocol.mjs` gains `list` (which manifests exist and which is active), `path` (where a
  ticket's or title's manifest belongs), and `focus`. `doctor` pointed at a `list` command that did
  not exist; it now does.
- The resolver reads the project directory (`CLAUDE_PROJECT_DIR`, then the payload `cwd`). The
  hook tests strip the inherited project directory so a test prompt that names a ticket cannot
  rewrite the operator's real focus.
- An external-backend session (a session opened directly in `fhf-backend-automation`) records no
  focus, just as it records no handoff. The env override still selects a task there.

## What this does not decide

It does not relax any gate. Backend `commit` and `push` stay refused unconditionally by
`authorizeAutomationRun`. Approval stays human-only, and a manifest still has to select every
path it writes. It only changes how a guard finds the manifest it checks.
