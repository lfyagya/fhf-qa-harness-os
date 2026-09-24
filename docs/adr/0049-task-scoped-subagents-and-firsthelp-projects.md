# ADR-0049 — Task-Scoped Generic Subagents and FirstHelp Project Keys

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-24 |
| **Relates to** | ADR-0043 (resolve the active task from the work), ADR-0044 (every prompt is a task) |
| **Amends** | ADR-0043 and ADR-0044 (SERV-only full-task identity), `engineering.harness.genericAgents`, `engineering.harness.forbiddenAgents`, `atlassian.projectKeys` |

## Context

`general-purpose` and `explore` were on `forbiddenAgents`, and Cursor's subagent hook
passed `--deny-matched-subagent`, so those agents exited 2 before any task scope was
read. `generalPurpose` was not mapped to `general-purpose`.

A full task was only `SERV-n`. FirstHelp infrastructure work is GEARS, loan work is
LOS, and Spark dealer work is SDX. The services sprint and `atlassian.projectKey`
stay SERV. NLOS is a different project and must not match LOS.

ADR-0043 and ADR-0044 still decide how a task is selected: env override, then focus,
then a quick task when no ticket, file, or title is named. This ADR does not bring
back a search that creates `sprint-task.json`.

## Decision

1. `genericAgents` (`general-purpose`, `explore`) may start. Spellings such as
   `generalPurpose` and `Explore` live in `engineering.harness.agentTypeAliases`
   and every adapter expands that one map. The same hook states the active task
   (focus file, ticket, or quick-task title) and exits 0. With no task yet it still
   exits 0 and says the subagent stays inside the one session task. It does not
   create or switch a task. Writes and pytest stay on the existing task gates.
   Names in `forbiddenAgents` stay blocked. On SubagentStart a retired name is a
   WARNING. There is no unconditional `--deny-matched-subagent` deny.

Codex stays instruction-only. `AGENTS.md` is generated from this same control plane, including the ticket keys and the generic-agent rule. Claude and Cursor run the same hook script.

2. `atlassian.projectKeys` is SERV, GEARS, LOS, and SDX. Those keys select a full
   task the same way SERV does. `projectKey` and `currentSprintJql` stay SERV.
   A key matches only on a word boundary, longest key first, so NLOS-10 is not LOS.
   SALES is not a task id. There is no SPARK key; Spark dealer work is SDX.

## Consequences

A generic subagent can start during intake or a quick-task confirm. Automation writes
still wait for the selected path, the owner confirm on a quick task, and a
non-production environment. The services sprint snapshot still accepts only SERV.
Parked rows and Cypress skip or quarantine notes may cite SERV, GEARS, LOS, or SDX.

## What this does not decide

It does not change the focus resolver, quick-task confirm, or parallel Cypress and
pytest lanes (ADR-0046). It does not add a second hook list for lane repos.
