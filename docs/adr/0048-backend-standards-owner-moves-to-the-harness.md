# ADR-0048 — The Backend Standards Owner Moves to the Harness

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-24 |
| **Amends** | ADR-0021 (federated backend documentation owner) |
| **Relates to** | ADR-0032 (one central rule set at the workspace root) |

## Context

ADR-0021 (2026-08-26) pointed `documentation.owners.backend-standards` at
`fhf-backend-automation/CLAUDE.md`, because at the time the backend repository held its own
authoring rules and a 225-line `CLAUDE.md`. Two things have changed since.

- **The rules moved.** ADR-0032 put one rule set at the workspace root. `api-standards`,
  `assertions`, `oracle-db`, `testing`, `new-module` and `security` now live in the harness
  `.claude/rules/`, and `backend-automation.md` states that nothing in the backend lane is locally
  authoritative.
- **The file is not in the repository.** The backend's `.gitignore` has listed `CLAUDE.md` on
  `master` and `dev` since 2026-06-07 (SERV-11614, a teammate's framework restructure). The only
  committed copy is on the unmerged `SERV-12270` branch (`6ad151b`, 2026-09-03). It travelled in
  backend PRs #40 and #47, both closed; #47 was closed because it also re-vendored the harness
  `.claude/` tree into the lane, against ADR-0032.

So the owner named a file that a fresh clone does not have, and `check-docs-links.mjs` failed on
every machine whose backend checkout was cut from `master`. Three agents, the backend route and the
`backend-test-author` skill all told readers to open it.

Tracking the file in the backend repository again would override a teammate's deliberate ignore in
a repository the harness does not own. That is a request to the backend team, not something this
plane decides.

## Decision

1. **The harness owns the backend repository guide.** It lives at
   `.claude/skills/backend-test-author/REPOSITORY.md`: setup, local configuration, run commands and
   directory layout, checked against backend `origin/master` on 2026-09-24. It sits in the skill so
   it loads on demand rather than into every session, and the skill reads it first.
2. **`documentation.owners.backend-standards` points at that guide.** The route hint, the
   `qa-automation-debugger` and `qa-automation-gate` agents, and `backend-test-author` point there too.
3. **`productTopology.repositories.fhf-backend-automation.instructions` names `README.md`**, the
   repository's own tracked instructions (installation), instead of the ignored `CLAUDE.md`.
4. **ADR-0021's split of responsibilities stands.** `TESTS.md` owns the contract (what counts as
   backend coverage and evidence); the rules and this guide own how a test is written and run. What
   moves is only where the implementation guide lives.

## Consequences

- `check-docs-links.mjs` no longer depends on how a backend checkout was cut.
- The 2026-09-03 `CLAUDE.md` was not copied across as it stood. It still told authors to put
  `[C<id>]` markers in docstrings, retired by the testing rules on 2026-09-05, and its layout listed
  `tests/repo_invoice/`, since moved under `tests/loss_mitigation/`. The same `[C<id>]` instruction
  is removed from `backend-test-author`.
- Someone who opens the backend repository directly still sees no pointer to the harness. That is
  the asymmetry ADR-0021 named, and it is still the backend team's call.
- The guide can drift from the repository. It says the repository wins, and it carries its
  verification date.
