# ADR-0033 — Declared Linkage Ratchet for Business Rules

| Field | Value |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-09-16 |
| **Extends** | ADR-0027 decision 4 (a hook must record the assumption it encodes) |

## Context

`build-knowledge-index.mjs` already joins the product specs to automation, API endpoints and Oracle
objects, and it refuses to infer an edge from name similarity — it counts only what a spec or a test
declares. Run on 2026-09-16 it reported:

| Edge | Declared | Total |
|---|---|---|
| Business rule → `traces:` | 0 | 611 |
| Business rule → any test | 9 | 611 |
| API endpoint → named in a spec | 0 | 234 |
| DB table/view → named in a spec | 8 | 356 |
| Test file → cites a spec or rule | 6 | 322 |

The index says it precisely: those rules are not untested, they are **unaccounted for** — no
machine-checkable path runs from the rule to a test, an endpoint, or a table.

This was checked for an extractor bug before being accepted as real. It is not one. The 75-spec
corpus names 22 schema-qualified tables in total, of which 4 exist in `db_schema.py`; only 15 of 59
module specs carry `data_population_rules` at all. The declarations are genuinely absent.

The consequence is a routing problem, not a reporting one. Asked to work a ticket, the model has no
declared path from a rule to the code that implements or verifies it, so it falls back on the thing
it can always do — match a familiar-looking module or file name — and proceeds with confidence. A
joiner that guessed the same way would report a comfortable percentage and route work to the wrong
module; reporting 0% is the honest answer and the reason the gap is visible at all.

Backfilling 611 rules is a real programme and cannot be a precondition for anything.

## Decision

1. **New rules must declare their edge; old ones need not.** `validate-spec-linkage.mjs` runs on
   `PostToolUse:Edit|Write`. When a written spec under `specs/` contains `business_rules:`, every
   rule that declares no non-empty `traces:` list blocks the write — unless its id is in
   `.claude/hooks/linkage-baseline.json`.

2. **The baseline is a ratchet, not an amnesty.** It was generated from the corpus as it stood
   (608 unique ids across 617 occurrences) and may only shrink. A rule that gains `traces:` while
   still listed produces a warning naming the id, so the entry is removed rather than left to
   silence the gate forever. Nothing is ever added.

3. **One parser, two callers.** The `traces:` shape moved to `.claude/hooks/lib/spec-linkage.mjs`,
   imported by both the reporter and the gate. A gate re-implementing the shape would drift from the
   reporter the first time either changed, and the two would disagree about what "traced" means
   while both looked green. The index's output is unchanged by the move — still 611 rules, 0 traced.

4. **A broken baseline does not block authors.** If `linkage-baseline.json` is missing or invalid the
   gate reports it on stderr and allows the write. A corrupt harness file is a harness defect; making
   it fail an author's edit would trade one problem for a worse one.

## Consequences

The gap can no longer grow: a rule added today carries its edge, and coverage against the product
spec becomes computable for new work immediately rather than after a 611-rule backfill.

Seven self-tests cover the block, the traced-passes case, the baselined-passes case, the
baseline-should-shrink warning, the two ignore paths, and the metadata-less probe. `18/18` canonical
scripts pass.

The gate fired on its own author before it was accepted: `check-docs-links` rejected
`validate-spec-linkage.mjs` for carrying no "Why this exists" header, which is ADR-0027 decision 4
working as designed on the hook that implements this one.

Scope is deliberately narrow. This requires a rule to say where it is verified; it does not check
that the named test, endpoint or table exists, nor that the test actually asserts the rule. Those are
real follow-ups, and both need the declarations to exist first. Endpoints (0 of 234) and tables
(8 of 356) are not gated here either — the same ratchet can extend to them once rule tracing is
established and the authoring cost is understood.

What does not change: the 608 baselined rules, the index's refusal to infer edges, and every existing
gate.
