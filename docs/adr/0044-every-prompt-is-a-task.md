# ADR-0044 — Every Prompt Is a Task; Unticketed Prompts Are Quick Tasks

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-23 |
| **Relates to** | ADR-0039 (one task, one approved manifest), ADR-0043 (resolve the active task from the work) |
| **Amends** | ADR-0043 (path and branch search become suggestions), `engineering.taskProtocol.activeTask.quick`, `engineering.harness.hooks.postAsk`, `engineering.harness.governance.protectedPaths` |

## Context

After ADR-0039 and ADR-0043, "task" meant one thing: a Jira family grounded into a manifest with
a frozen graph slice, an intent-vs-built classification, and six ordered human gates. Changing one
selector, adding one test, or updating one configuration value had to pay that full price, or be
refused.

The owner's working model is different: every prompt is a task. Most are small. The ceremony
should scale with the change. It should not assume every change is a Jira family.

The owner decided three things on 2026-09-23:

1. A quick task needs **one confirm per task** from the owner.
2. The full protocol applies **only when a SERV ticket is named**. There is no size ceiling.
3. A quick task **may run backend pytest for its own files** (Dev/QA).

## Decision

**Tiers.** A prompt that names a SERV ticket, a manifest file, or a manifest title selects a
*full* task, and everything in ADR-0039 and ADR-0043 applies unchanged. Any other instruction is a
*quick* task. Replies such as "yes" and "continue" are not new tasks.

**A quick task is the prompt.** The router records the instruction as the session's
`lastInstruction`. At the first automation write, the guard creates the record
`.harness/tasks/quick/<slug>-<digest8>.json` (intent text and digest, touched paths) and refuses
once with `QUICK TASK CONFIRM`. The refusal tells the agent to ask the owner one question
("Quick task: <title>", Yes / No).

**Confirmation comes from the owner, not the agent.** It is recorded in one of two ways:

- `record-task-answer.mjs`, a new `PostToolUse` hook on `AskUserQuestion`, reads the answer the
  tool returned. The agent cannot produce that event without showing the question to the owner.
- A typed affirmative reply to the prompt router, for tools with no question UI (Cursor).

The confirm lives in the governance-protected focus file, keyed to the instruction's digest. The
quick-task directory is protected too, so editing a record cannot authorize a write or widen what
may run. A new instruction is a new task and needs a new confirm.

**What a confirmed quick task may do:**

- Write inside the lane's `allowedWriteRoots` minus `deniedWritePatterns`. These are the same
  bounds a full task has before its manifest narrows them.
- Run pytest only on test files it wrote, or that its prompt named.
- Nothing else changes: application source stays read-only, production smoke stays GET-only, and
  credentials, dependency changes, commit, and push stay refused.

**No gates for a quick task.** `enforce-task-gates` sees no full task and does not gate.

**Full tasks are named, never inferred.** ADR-0043's search, which picked the one manifest covering
the target path, or the manifest named in the branch, no longer selects a full task silently. Its
hit appears in the quick-task confirm as a note ("SERV-n also covers this; name it instead"). The
owner decides.

**One session, one job.** The focus records the session that set it. A later session starts with
no inherited task, so a full task from yesterday does not quietly govern today's small prompts.

**Route hints.** Route hints that begin "create or refresh the task manifest" describe the full
tier. For an unticketed instruction, the router adds a `[task] tier=quick` line saying so. The
routes themselves are unchanged.

## Consequences

- Small work costs one confirm, with no Jira, no manifest authoring, and no gates.
- There is no size ceiling, by the owner's choice. A large change made without naming a ticket is a
  quick task. The owner accepts that trade and can name a ticket at any point to get the full
  protocol.
- The confirm is per instruction, so a sequence of small prompts asks once per prompt that reaches
  automation code.
- Tools without a question UI rely on the typed reply. The only affirmatives accepted are short,
  explicit ones (`yes`, `ok`, `go ahead`, …).

## What this does not decide

It does not change a full task's gates, the backend runner's evidence contract, or any boundary
outside the automation repositories. Writes outside those repositories never needed a task and
still do not.
