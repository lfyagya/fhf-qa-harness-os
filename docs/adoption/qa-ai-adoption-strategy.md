# QA AI Adoption — Program, Workshop, and Sync Cadence

**Source of truth:** `FHF/docs/adoption/qa-ai-adoption-strategy.md`. Edited there and published here. **Companion:** [QA Harness — Onboarding and Usage](https://firsthelpfinancial.atlassian.net/wiki/spaces/TE/pages/4472799241) covers the how-to; this page covers the why, the sequence, and the reporting. Named owners and attendees are added once confirmed.

## 1. Objective

Move QA effort from repetitive manual execution toward AI-assisted authoring and automated validation, without losing test quality in the process. In concrete terms: every manual QA uses Cursor or Claude on real work, and new test coverage is authored alongside development rather than after it.

Throughput is expected to dip while people learn. That dip is planned, not a failure signal; treat the first two weeks per person as training cost.

## 2. Success metric

Not yet agreed. The metric was not closed in the planning discussion, and no progress should be reported against a metric the group has not set.

Once agreed, record it here as: the measure, its current baseline, the target, the date, and who reads it. One primary metric only. Supporting indicators belong in section 6.

## 3. Why the harness rather than unconstrained AI assistance

Unconstrained AI assistance on a financial-services QA codebase fails in specific, predictable ways: it invents selectors, asserts against production data, edits application source, and retries a broken test until it passes for the wrong reason. The harness makes those outcomes impossible rather than discouraged, because the guardrails are runtime hooks rather than documentation.

This is also the adoption argument for a cautious manual QA: the guardrails prevent production impact, so experimentation is safe.

## 4. Rollout sequence

Ordered so that each stage produces the evidence the next one requires.

| Stage | Activity | Complete when |
| --- | --- | --- |
| 1. Workshop | One-hour session with the full QA team; live demonstration, everyone leaves with a working setup | Every attendee has run `node .harness/verify.mjs` successfully |
| 2. Guided first task | Each QA takes one real, low-risk ticket through the full loop with support available | Each person has one agent-authored spec reviewed by a gate |
| 3. Unassisted use | Normal ticket work, AI-assisted by default; questions go to a shared channel rather than to one person | Questions shift from setup problems to testing problems |
| 4. Parallel authoring | Test suites authored alongside development, from the spec, before the build lands | At least one sprint where coverage ships with the feature |
| 5. Backend parity | Backend automation adopts the same workflow patterns | Task manifests and gates are routine rather than exceptional |

Stages 1 to 3 cover the workshop and approximately the following month. Stages 4 and 5 are standing work reported in the bi-weekly sync.

## 5. Workshop run sheet

One hour, full QA team, led by QA automation with a short segment from the engineering AI workflow owner.

**Prerequisites, circulated the working day before.** Unprepared attendees consume roughly a third of the session.

* All four checkouts cloned: `front-end-automation-e2e`, `front-end-automation-smoke`, `fhf-backend-automation`, `FHF`
* Cursor or Claude Code installed and signed in
* Node available on PATH
* No credentials gathered; the harness never asks for any

| Time | Segment | Content |
| --- | --- | --- |
| 0:00–0:05 | Why | The dip is expected. Nothing done in this session can reach production |
| 0:05–0:15 | Live demonstration | One real ticket end to end: route, generate, gate, PR. No slides |
| 0:15–0:30 | Hands-on setup | Everyone runs `setup.mjs` then `verify.mjs`. Nobody leaves this segment failing |
| 0:30–0:45 | Hands-on task | Everyone requests one test in the E2E lane and reads the result |
| 0:45–0:55 | Guardrails | Deliberately trip a hook by attempting to edit application source; show that the refusal is the system working |
| 0:55–1:00 | Next steps | Each person names the ticket they will take through stage 2, and where to ask questions |

**Leave-behind:** the onboarding page and one named low-risk ticket per attendee.

**Demonstration safety:** demonstrate in the E2E lane against Dev/QA. Do not demonstrate in the Smoke lane; a live production checkout in front of an audience teaches the wrong habit.

## 6. Bi-weekly adoption sync

QA and engineering leads, every two weeks, initially through October. Standing agenda, 30 minutes:

1. Adoption: who used AI-assisted workflows on real tickets since the last session, and who did not
2. Coverage: specs authored, gate verdicts, and what shipped alongside development
3. Friction: the primary blocker each person hit. This is the input that changes the harness
4. Primary metric against baseline, once section 2 is agreed
5. One decision per session, if any

Supporting indicators, tracked deliberately as indicators rather than targets to avoid gaming:

* Number of QAs with a passing `verify.mjs` in the last two weeks
* Ratio of gate PASS to BLOCK verdicts, and whether BLOCKs are corrected or circumvented
* Whether shared-channel questions concern setup or testing

Friction items become harness work: configuration, routing, worktree setup, and reusable skills. The onboarding target is that a new QA requires the workshop and nothing further.

## 7. Coordination

| Area | Scope |
| --- | --- |
| Engineering AI workflow | Align this page's structure and depth with the existing Frontend and Backend AI adoption documentation so the three read as one set |
| QA practice | Wider QA rollout: spec-driven development, parallel test-suite authoring, and coverage targets per module |
| Leadership reporting | Progress reported into the bi-weekly sync against the primary metric |

## 8. Risks

| Risk | Handling |
| --- | --- |
| People try it once, hit a refusal, and quietly stop | Stage 2 is supported rather than solo. Guardrails are taught in the workshop, not discovered alone |
| Productivity dip interpreted as tool failure | Named as expected in section 1 and at the start of the workshop |
| AI-authored tests that pass without testing anything | Every spec passes through a gate. Gate verdicts are a tracked indicator, not a formality |
| Adoption reported by tool-open rate rather than shipped work | The metric concerns real tickets and shipped coverage, never seat-licence counts |

## 9. Meeting logistics

Calendar invitations are sent from Outlook; this page records the agreed content only.

| Meeting | Attendees | Timing |
| --- | --- | --- |
| QA AI adoption workshop | Full QA team; engineering AI workflow owner | Monday, 10:00–11:00 Nepal time |
| QA AI adoption sync | QA and engineering leads | Every two weeks, 30 minutes, initially through October; slot confirmed with US participants before the first invitation |
