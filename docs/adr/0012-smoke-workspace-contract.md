# ADR-0012 - Smoke Consumer Workspace Contract

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-15 |

## Context

The Smoke repository is intentionally a consumer of the FHF workspace and a separate application
specification repository. The committed projection can contain the policy and executable guards, but
it cannot contain developer checkout paths, product contracts owned by another repository, or
credentials. A fresh clone must therefore stop before Smoke work if those required inputs have not
been supplied.

## Decision

The Smoke projection carries a generated workspace contract, lane marker, setup example, and local
setup command. A QA member supplies an ignored `.harness/workspace.local.json` with:

- `consumerRoot` - the local FHF workspace root;
- `moduleSpecsRoot` - the separate application-specification repository root;
- optional backend, Jira, Confluence, and Cypress Cloud availability flags.

The preflight validates the current Smoke branch (`staging`), local Smoke files and documentation,
the FHF workspace instructions, the `specs/` directory, and every configured module-spec target.
Missing required inputs block shell work, writes, agent spawns, skills, prompt routing, and the full
consumer verifier. Optional integrations produce warnings and never block local Smoke execution.

The generated `change`/projection-only verifier mode checks committed projection portability in CI
without requiring a developer's external workspace. The default verifier performs the complete local
workspace check.

## Consequences

- Team members receive an actionable setup form instead of a silent partial harness.
- `consumerRoot` and module-spec ownership remain explicit without embedding machine paths.
- The Smoke branch keeps its own required documentation and does not preload E2E-only guidance.
- The FHF command center still uses its canonical workspace layout and remains responsible for
  cross-lane evidence and external integrations.
