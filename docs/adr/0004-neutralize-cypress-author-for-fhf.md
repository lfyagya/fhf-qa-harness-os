# ADR-0004 — Neutralize cypress-author's Injected FHF Knowledge

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-07-10 |

## Context

While reviewing the 4-agent redesign from `docs/adr/0003-agent-roster-consolidation.md`, the
owner asked whether the Cypress-shipped `cypress-author`/`cypress-explain`/`cypress-docs` skills
already implement our Config → Commands → Tests architecture. Checking found that
`cypress-author` had an injected `references/author/fhf-rules.md` (plus an "FHF Repo Routing"
table in `subskills/task.md`) that gave it real, working knowledge of our architecture, repo
split, non-negotiables, and command-naming convention — wired via `author-rules.md`'s "You MUST
read fhf-rules.md before anything else; FHF rules override the generic rules below."

This directly contradicted `agent-spawning-gate.md`'s claim that `cypress-author` "doesn't know
FHF's command-first architecture" (that note was stale — someone had already built the opposite).
More importantly, it created a real routing hazard: `cypress-author`'s trigger description is
intentionally broad ("write a test", "add tests" — matches without the word "Cypress"), and
skill-matching happens automatically on description before any agent-tier routing rule is
consulted. A plain "write a test for the servicing dashboard" could get intercepted by
`cypress-author` instead of reaching `cypress-generator` — and having `fhf-rules.md` meant it
would *look* competent doing so (right file layout, right non-negotiables) while silently
skipping everything `cypress-generator` does that `fhf-rules.md` didn't encode: the reuse/
duplication check, source-evidence gathering from `fhf-dashboards`, legacy-file migration,
scenario/AC derivation, and handoff to `cypress-gate`. That's a worse failure mode than
`cypress-author` simply not knowing FHF at all — a confident partial implementation, not an
absence.

## Decision

Move the FHF-awareness from "enough knowledge to author FHF specs" to "just enough knowledge to
recognize FHF work and refuse it":

- `subskills/task.md` — the "FHF Repo Routing" table (previously used to resolve which repo, then
  continue authoring) is now a stop-check ("FHF Repos — Stop, Do Not Continue This Skill"). If
  the task targets either FHF Cypress repo, it tells the user to use `cypress-generator` and
  halts before ever reaching `author.md`.
- `references/author/fhf-rules.md` — deleted. It's unreferenced now that the stop-check lives in
  `task.md`, and keeping it around as a second, redundant place encoding the same architecture
  rules as `cypress-generator.md` is exactly the drift risk this session's earlier dedup pass was
  hunting for elsewhere.
- `references/author/author-rules.md` — the "read fhf-rules.md first" section removed; it's
  reached only for non-FHF projects now, so it goes back to being purely generic Cypress content.
- `.claude/rules/agent-spawning-gate.md` — corrected the stale "doesn't know FHF architecture"
  claim to describe the actual current mechanism (self-stop + redirect), and kept the guidance
  that a user/agent should route to `cypress-generator` directly rather than relying on
  `cypress-author` to fire and redirect.

## Consequences

- `cypress-author` can no longer produce a passable-looking FHF spec that skips
  `cypress-generator`'s reuse check, evidence gathering, and gate handoff — worst case now is it
  tells the user to go to `cypress-generator`, not that it does a partial job itself.
- `cypress-explain` and `cypress-docs` were checked and confirmed to have no FHF-specific
  injection — no change needed there.
- Does NOT change `cypress-generator`, `cypress-gate`, `cypress-debugger`, `cypress-shipper`, or
  any hook — this was scoped entirely to the 3 Cypress-shipped skills' reference files plus the
  one stale line in the routing rule.
