# ADR-0029 — Lane-Scoped Rule Projection

| Field | Value |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-09-07 |
| **Supersedes** | Nothing. Amends one sentence of [ADR-0028](0028-lane-scoped-agent-and-skill-projection.md) |

## Context

ADR-0028 scoped **agents** and **skills** per lane and closed with:

> What does not change: hooks and rules still project in full to every consumer — a guard is only
> useful if it is present everywhere it might fire.

That rationale is correct for hooks and does not transfer to rules. A hook is an executable guard:
`validate-cypress-rules.mjs` in the backend repo costs nothing until a matching tool call fires, and
if it never fires it never runs. A rule is prose read into the model's context. It has no trigger
condition. It is either loaded or not, and when it is loaded it is instructions.

The consequence is measurable. Six rules — `api-standards`, `assertions`, `new-module`, `oracle-db`,
`security`, `testing` — are byte-identical in all four checkouts (hash-verified 2026-09-07 across
the FHF root, `front-end-automation-e2e`, `front-end-automation-smoke`, and
`fhf-backend-automation`). All six describe pytest and Oracle architecture. In the two Cypress lanes
they describe an architecture that is not present:

- `api-standards.md` documents `BaseAPIClient`, the 25 client classes under `api/`, and the fixture
  registry in `tests/smoke/conftest.py`. None of those paths exist in either Cypress repository.
- `testing.md` instructs the reader to inherit from `BaseDB`, use `@pytest.mark.order(N)`, and
  always run with `--order-scope=module`. There is no pytest in either Cypress lane.
- `oracle-db.md` and `new-module.md` are entirely about `dao/oracle_dao.py` and `tests/<module>/`.

This is worse than the inert-scaffolding problem ADR-0028 fixed for skills. An unusable skill offers
an action the model cannot perform; the model tries it and fails visibly. An inapplicable *rule*
reads as a live instruction about the repository the agent is actually editing. ADR-0028's own
`purpose` string already names the general failure — "the pytest generators into the Cypress lanes"
— it simply did not extend the fix from the roster to the rules those generators describe.

The attention-budget argument from ADR-0027, which ADR-0028 cites for skills, applies here too,
though the volume is smaller than it first looks: measured 2026-09-07, the five files this ADR
scopes to backend total 355 lines (`api-standards` 109, `assertions` 103, `testing` 60,
`new-module` 59, `oracle-db` 24), with `security` adding 26 more. That is a real cost paid in every
session of a lane that cannot act on any of it, but the stronger argument is correctness, not
volume: these files read as live instructions about the repository being edited.

### The counter-argument, stated fairly

There is a real case for leaving ADR-0028 alone.

1. **Cross-layer work is a first-class workflow here.** `cross-layer-qa.md` requires one Jira family
   to select both lanes, and the `qa-automation-*` agents run in the Cypress lanes. An agent
   planning the backend half of a change unit from the E2E repository benefits from being able to
   read the backend conventions rather than guess them.
2. **Rules are cheap to project** — no install step, no listing budget, no runtime cost.
3. **A guard everywhere is a real principle**, and rules do encode some guard-like content.

ADR-0028 already resolved this exact tension for skills, and the resolution should be reused rather
than reinvented: it kept `cypress-docs` and `cypress-explain` in the backend lane **because they are
read-only**, while removing the ones that can only act against a Cypress checkout. The same test
applies to rules. A rule that tells you *how this repository is built* is lane-specific. A rule that
tells you *how to behave* is cross-cutting.

Point 1 is answered by `backend-test-author`, which is already projected into both Cypress lanes
precisely as the progressive-loading entry point for backend conventions, and by
`backend-automation.md`, which stays everywhere under this proposal. Cross-layer reading is
therefore still served — on demand, rather than by default in every session.

## Decision

Extend `engineering.harness.laneScope` with a `rules` key, using the read-only/architecture split
above.

**Projected to every lane** — behaviour, safety, and routing, none of which name a repository
layout:

`session-rules`, `agent-spawning-gate`, `backend-automation` (the boundary and the pointer to the
progressive loader), `cross-layer-qa`, `failure-classification`, `jira-integration`,
`prod-data-handling`, `source-map`, `ai-pilot`.

**Cypress lanes only** (`e2e`, `smoke`) — these describe the Cypress architecture:

`assertion-precision`, `ui-config-hierarchy`, `studio-ai-policy`.

**Backend lane only** — these describe the pytest and Oracle architecture:

`api-standards`, `assertions`, `new-module`, `oracle-db`, `testing`.

`root` and `baseline` stay `"all"`, unchanged from ADR-0028: the FHF workspace is an aggregation
point and the baseline is the clone-ready superset.

### Two judgement calls flagged rather than buried

- **`security.md`** is listed nowhere above because it is currently two documents in one file. Its
  principles ("never print or log a secret", "never commit a credentials file") are cross-cutting.
  Its concrete table is entirely backend — `tests/.env`, `config/config.ini`,
  `config/example_config.ini`. Projecting it everywhere ships backend paths to the Cypress lanes;
  scoping it to backend removes a genuine safety rule from the lanes that hold
  `cypress.env.json` and the Cypress Cloud record keys. **Recommendation:** generalise the file
  first — a shared principles section plus a per-lane sensitive-file table — then project it to all
  lanes. Until that split exists, keep it in all lanes; an over-broad safety rule is the right
  failure direction.
- **`ai-pilot.md`** is placed in the cross-cutting set, but its "Cypress-only implementation"
  section names Config → Commands → Tests. The rest of it — pilot entry criteria, proposal-only
  automation, guardrail-finding handling — is general policy that backend work should also follow.
  Placed where it is because dropping it from backend would remove the proposal-only rule, which is
  the more expensive loss.

## Enforcement

Two places must agree. This is one fewer than ADR-0028 needed, because rules have no roster in
`harness.config.json`, so `harnessConfigTextForLane()` requires no change.

1. `copySubfolderSync()` in `sync-loader-shims.mjs:238`. The current line hard-codes the two scoped
   kinds and passes `null` for everything else, which is what makes rules unfiltered:

   ```js
   const allow = laneAllows(lane, sub === "agents" ? "agents" : sub === "skills" ? "skills" : null);
   ```

   Rules become scoped by letting `sub` itself select the list — `laneAllows(lane, sub)` — with
   `hooks` deliberately absent from every lane's scope so it continues to project in full. Its
   existing prune branch then removes a rule a lane no longer receives, with no further change.
2. `dirsMatch()` in `check-loader-drift.mjs` derives `kind` the same hard-coded way
   (`check-loader-drift.mjs:97`). Without the matching change every lane would report the other
   lanes' rules as missing — the identical failure ADR-0028 records for agents and skills.

`engineering.harness.verify.canonical` must still pass 18/18 afterwards.

## Consequences

Each Cypress lane drops five rule files, 355 lines. The backend lane drops three
(`ui-config-hierarchy` 122, `assertion-precision` 31, `studio-ai-policy` 30 — 183 lines). The FHF
root and the baseline are unchanged.

Adding a rule now requires deciding which lanes receive it — the same cost ADR-0028 introduced for
agents and skills, and the same failure mode: a rule absent from every lane's list reaches only the
root and the baseline, which is a quiet way to ship a rule nowhere. The lane lists are the place to
look when a rule does not appear in a consumer.

**Hooks keep projecting in full.** ADR-0028's sentence is amended only for rules. The guard argument
holds for executable guards and this ADR does not weaken it.

One risk worth naming: a cross-layer agent in a Cypress lane that previously had `api-standards.md`
in context by accident will now have to load `backend-test-author` deliberately. If that turns out
to degrade cross-layer output, the cheapest correction is adding the backend rules back to the
Cypress lanes' lists — a config change, not a code change. That reversibility is why the split
belongs in `laneScope` rather than in the sync logic.
