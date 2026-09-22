# ADR-0041 — Subagents run inside one task, and FirstHelp tickets are not only SERV

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-22 |

## Context

`general-purpose` and `explore` were on `forbiddenAgents`, so a spawn exited 2. Cursor sends those types as `generalPurpose` and `Explore`. The denial treated the alias as the same agent and then blocked it. Retired roster names were on that same list.

Task identity accepted only `SERV-`. Infrastructure work is on **GEARS** (`GEARS: SharedTech`). LOS work is on **LOS** (`Loan Team Scrum`). Spark has no `SPARK` key; the live project is **SDX** (`Spark Dealer Experience`). Confirmed on `firsthelpfinancial.atlassian.net` on 2026-09-22. New LOS keys (`NLOS`, `NLOSF`, `NLOSI`, `NLCP`, `NLDX`) exist and stay off the allowlist until a task uses them.

## Decision

1. `engineering.harness.genericAgents` (`general-purpose`, `explore`) may start. The hook reads `agent_type` or `subagent_type`, maps `generalPurpose` to `general-purpose` and `Explore` to `explore`, states the one sprint task (ticket, file, selected paths), and exits 0. Writes and pytest still wait for that task's selected path and a non-production environment. `forbiddenAgents` keeps the retired names and still exits 2. On `SubagentStart` a retired name is a warning, because that event cannot stop the spawn. The specialist budget stays one writer: `cypress-generator` or `qa-automation-generator`. A task-scoped subagent does not replace that writer and does not open a second task.
2. `atlassian.projectKey` stays `SERV` for the services sprint query. `atlassian.projectKeys` is the task-identity allowlist: SERV, GEARS, LOS, SDX. The sprint-task gate, task-protocol primary and `parkedOn`, Jira ticket extraction, the `ticket-ids` fact, and Cypress quarantine or skip references use that list. A key that merely contains `LOS`, such as `NLOS-10`, is not `LOS`. The SERV sprint snapshot still rejects non-SERV issue keys.

## Consequences

A subagent can start while the task is still intake. The scope line names the task. A product write outside the recorded paths is still blocked. A SALES ticket is not a task id. Adding a project is a `projectKeys` edit plus the `ticket-ids` match, not a new hook.
