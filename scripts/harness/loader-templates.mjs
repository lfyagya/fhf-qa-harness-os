// Single source of truth for sub-repo loader shim content.
// sync-loader-shims.mjs writes these; check-loader-drift.mjs verifies against these.
// Never duplicate this content in either script.

// ponytail: absolute paths, not "../../" — sub-repos are no longer 2 levels under the
// hooks' home directory now that hooks live in a sibling repo (fhf-harness-os), not
// nested inside FHF. Matches the absolute-path convention already used in settings.json.
const HARNESS_HOOKS = "C:/Users/Leapfrog/fhf-harness-os/.claude/hooks";

export const CURSOR_HOOKS = {
  version: 1,
  hooks: {
    beforeSubmitPrompt: [
      {
        command: `node ${HARNESS_HOOKS}/prompt-router.mjs`,
        matcher: "UserPromptSubmit",
        failClosed: false,
      },
    ],
    preToolUse: [
      {
        command: `node ${HARNESS_HOOKS}/protect-app-source.mjs`,
        matcher: "Write|StrReplace|Edit|ApplyPatch|write|str_replace|apply_patch",
        failClosed: true,
      },
      {
        command: `node ${HARNESS_HOOKS}/protect-second-brain-boundary.mjs`,
        matcher: "Write|StrReplace|Edit|ApplyPatch|write|str_replace|apply_patch",
        failClosed: true,
      },
      {
        command: `node ${HARNESS_HOOKS}/pre-validate-cypress-rules.mjs`,
        matcher: "Write|StrReplace|Edit|ApplyPatch|write|str_replace|apply_patch",
        failClosed: true,
      },
    ],
    beforeShellExecution: [
      {
        command: `node ${HARNESS_HOOKS}/manual-task-guard.mjs`,
        failClosed: false,
      },
    ],
    subagentStart: [
      {
        command: `node ${HARNESS_HOOKS}/block-generic-agents.mjs --deny-matched-subagent`,
        matcher: "generalPurpose|general-purpose|explore|Explore|documentation-writer|test-execution-planner|cypress-bug-hunter|cypress-cloud-investigator|cypress-e2e-automation|cypress-explorer|cypress-performance-auditor|cypress-runner|cypress-test-automation|cypress-ui-coverage-analyst|pr-creator|pre-merge-qa-gate|qa-ticket-router|spec-generation-loop|test-design-reviewer",
        failClosed: true,
      },
    ],
    postToolUse: [
      {
        command: `node ${HARNESS_HOOKS}/validate-cypress-rules.mjs`,
        matcher: "Write|StrReplace|write|str_replace|apply_patch|ApplyPatch",
      },
      {
        command: `node ${HARNESS_HOOKS}/scenario-file-guard.mjs`,
        matcher: "Write|StrReplace|write|str_replace|apply_patch|ApplyPatch",
      },
      {
        command: `node ${HARNESS_HOOKS}/scenario-content-guard.mjs`,
        matcher: "Write|StrReplace|write|str_replace|apply_patch|ApplyPatch",
      },
      {
        command: `node ${HARNESS_HOOKS}/artifact-duplication-guard.mjs`,
        matcher: "Write|StrReplace|write|str_replace|apply_patch|ApplyPatch",
      },
      {
        command: `node ${HARNESS_HOOKS}/coverage-strategy-guard.mjs`,
        matcher: "Write|StrReplace|write|str_replace|apply_patch|ApplyPatch",
      },
      {
        command: `node ${HARNESS_HOOKS}/sync-reminder.mjs`,
        matcher: "Write|StrReplace|write|str_replace|apply_patch|ApplyPatch",
      },
    ],
    stop: [
      {
        command: `node ${HARNESS_HOOKS}/session-end-reminder.mjs`,
        failClosed: false,
      },
      {
        command: `node ${HARNESS_HOOKS}/spec-sweep-stop-hook.mjs`,
        failClosed: false,
      },
    ],
  },
};

export function parentCopilotInstructions() {
  return `# Copilot Instructions — FHF Parent Workspace

Canonical shared harness policy:
- \`C:\\Users\\Leapfrog\\FHF\\AGENTS.md\`
- \`C:\\Users\\Leapfrog\\FHF\\CLAUDE.md\`

This workspace contains two test lanes. Route E2E / functional / regression work to
\`AG Frontend Automation/front-end-automation\` and production smoke work to
\`ProdSmokeExecution/front-end-automation\`. Smoke is GET-only and must never mutate production.

Follow the lane repository's \`.github/copilot-instructions.md\` before changing tests.
`;
}

export function parentGeminiInstructions() {
  return `# Gemini Instructions — FHF Parent Workspace

Canonical shared harness policy:
- \`C:\\Users\\Leapfrog\\FHF\\AGENTS.md\`
- \`C:\\Users\\Leapfrog\\FHF\\CLAUDE.md\`

This workspace contains two test lanes. Route E2E / functional / regression work to
\`AG Frontend Automation/front-end-automation\` and production smoke work to
\`ProdSmokeExecution/front-end-automation\`. Smoke is GET-only and must never mutate production.

Follow the lane repository's \`GEMINI.md\` before changing tests.
`;
}

export function docsReadme(lane) {
  if (lane === "e2e") {
    return `# Docs Overlay — E2E Repo

Single point of contact for shared harness documentation:
- \`C:\\Users\\Leapfrog\\FHF\\AGENTS.md\`

All shared architecture, workflow, framework, and governance docs are maintained in parent \`FHF/docs\`.
This repo-local \`docs/\` exists only as a pointer entry point.

E2E lane scope reminder:
- Environment: Dev/QA
- Mutations: allowed with cleanup
- Baseline branch: \`dev\`
`;
  }

  return `# Docs Overlay — Smoke Repo

Single point of contact for shared harness documentation:
- \`C:\\Users\\Leapfrog\\FHF\\AGENTS.md\`

All shared architecture, workflow, framework, and governance docs are maintained in parent \`FHF/docs\`.
This repo-local \`docs/\` exists only as a pointer entry point.

Smoke lane scope reminder:
- Environment: Production
- Mutations: forbidden (GET-only)
- Baseline branch: \`staging\`
`;
}

export function rootReadme(lane) {
  if (lane === "e2e") {
    return `# FHF E2E Repo Overlay

This repository is a thin E2E lane overlay.

Canonical shared documentation lives in parent \`FHF\`:
- \`C:\\Users\\Leapfrog\\FHF\\AGENTS.md\`
- \`C:\\Users\\Leapfrog\\FHF\\docs\\framework\\TESTS.md\`
- \`C:\\Users\\Leapfrog\\FHF\\docs\\modules\\README.md\`

E2E lane deltas for this repo:
- Environment: Dev and QA
- Mutations: Allowed (with cleanup)
- Baseline branch: \`dev\`
- Never run E2E against production

Local package scope:
- Root package: \`CypressFHF/fhf-dashboards/\`
- E2E specs: \`CypressFHF/fhf-dashboards/cypress/tests/fhf-dashboard/e2e/\`

For AI/tooling entry and lane-specific overlays, use:
- \`AGENTS.md\`
- \`CLAUDE.md\`
- \`docs/README.md\`
`;
  }

  return `# FHF Smoke Repo Overlay

This repository is a thin smoke-lane overlay.

Canonical shared documentation lives in parent \`FHF\`:
- \`C:\\Users\\Leapfrog\\FHF\\AGENTS.md\`
- \`C:\\Users\\Leapfrog\\FHF\\docs\\framework\\TESTS.md\`
- \`C:\\Users\\Leapfrog\\FHF\\docs\\modules\\README.md\`

Smoke lane deltas for this repo:
- Environment: Production
- Mutations: Forbidden (GET-only)
- Baseline branch: \`staging\`

Local package scope:
- Root package: \`CypressFHF/fhf-dashboards/\`
- Smoke specs: \`CypressFHF/fhf-dashboards/cypress/tests/fhf-dashboard/smoke/\`

For AI/tooling entry and lane-specific overlays, use:
- \`AGENTS.md\`
- \`CLAUDE.md\`
- \`docs/README.md\`
`;
}

export function architectureOverlay(lane) {
  if (lane === "e2e") {
    return `# E2E Architecture Overlay

This file is an E2E lane pointer only.

Canonical architecture lives in parent \`FHF\`:
- \`C:\\Users\\Leapfrog\\FHF\\ARCHITECTURE.md\`
- \`C:\\Users\\Leapfrog\\FHF\\docs\\framework\\TESTS.md\`

E2E-specific architectural constraints:
- Dev/QA environments only
- Mutations allowed with cleanup discipline
- Command-first test layering: Config -> Commands -> Tests
- Never execute E2E mutation suites against production

Implementation location in this repo:
- \`CypressFHF/fhf-dashboards/cypress/tests/fhf-dashboard/e2e/\`

If a shared architecture rule changes, update parent canonical docs first.
`;
  }

  return `# Smoke Architecture Overlay

This file is a lane-specific pointer only.

Canonical architecture lives in parent \`FHF\`:
- \`C:\\Users\\Leapfrog\\FHF\\ARCHITECTURE.md\`
- \`C:\\Users\\Leapfrog\\FHF\\docs\\framework\\TESTS.md\`

Smoke-specific architectural constraints:
- Production-only validation lane
- Read-only assertions (no POST/PUT/PATCH/DELETE)
- Command-first test layering: Config -> Commands -> Tests

Implementation location in this repo:
- \`CypressFHF/fhf-dashboards/cypress/tests/fhf-dashboard/smoke/\`

If a shared architecture rule changes, update parent canonical docs first.
`;
}

export function contributingOverlay(lane) {
  if (lane === "e2e") {
    return `# Contributing (E2E Overlay)

This repository follows parent canonical contribution standards.

Start with parent docs:
- \`C:\\Users\\Leapfrog\\FHF\\docs\\framework\\TESTS.md\`

E2E-lane mandatory deltas:
- Dev/QA only (never production)
- Mutations allowed only with explicit cleanup
- No hardcoded selectors/endpoints/credentials
- No \`cy.wait(number)\`; use \`cy.apiWait()\` or visibility assertions
- \`cy.ensureAuthenticated()\` in both \`before()\` and \`beforeEach()\`
- \`testIsolation: true\` on every describe block

Lane map and tool entry points:
- \`AGENTS.md\`
- \`CLAUDE.md\`
`;
  }

  return `# Contributing (Smoke Overlay)

This repository follows parent canonical contribution standards.

Start with parent docs:
- \`C:\\Users\\Leapfrog\\FHF\\docs\\framework\\TESTS.md\`

Smoke-lane mandatory deltas:
- Production lane only
- Read-only tests only (GET-only; no POST/PUT/PATCH/DELETE)
- No hardcoded selectors/endpoints/credentials
- No \`cy.wait(number)\`; use \`cy.apiWait()\` or visibility assertions
- \`cy.ensureAuthenticated()\` in both \`before()\` and \`beforeEach()\`
- \`testIsolation: true\` on every describe block

Lane map and tool entry points:
- \`AGENTS.md\`
- \`CLAUDE.md\`
`;
}

export function copilotInstructions(lane) {
  const laneBlock =
    lane === "e2e"
      ? `## Lane

- Type: E2E / functional / regression
- Environment: Dev and QA
- Mutations: Allowed
- Baseline branch: \`dev\`

---

## Non-Negotiables

- Use command-first architecture: Config -> Commands -> Tests.
- Never use \`cy.wait(number)\`.
- Never hardcode selectors, endpoints, routes, credentials, or secrets.
- Always call \`cy.ensureAuthenticated()\` in both \`before()\` and \`beforeEach()\`.
- Always register intercepts before \`cy.visit()\`.
- Always use \`cy.apiWait()\` before API-dependent assertions.
- Always keep \`testIsolation: true\`.
- Never run mutation tests on production.
- Never use real customer data.

---

## Paths

- Package root: \`CypressFHF/fhf-dashboards/\`
- E2E specs: \`CypressFHF/fhf-dashboards/cypress/tests/fhf-dashboard/e2e/\``
      : `## Lane

- Type: Smoke / availability / auth / structure
- Environment: Production
- Mutations: Forbidden (GET-only)
- Baseline branch: \`staging\`

---

## Non-Negotiables

- Use command-first architecture: Config -> Commands -> Tests.
- Never use \`cy.wait(number)\`.
- Never hardcode selectors, endpoints, routes, credentials, or secrets.
- Always call \`cy.ensureAuthenticated()\` in both \`before()\` and \`beforeEach()\`.
- Always register intercepts before \`cy.visit()\`.
- Always use \`cy.apiWait()\` before API-dependent assertions.
- Always keep \`testIsolation: true\`.
- Never use POST/PUT/PATCH/DELETE in smoke.
- Never assert volatile data values in smoke.
- Deterministic production failures are incidents, not test-fix work.

---

## Paths

- Package root: \`CypressFHF/fhf-dashboards/\`
- Smoke specs: \`CypressFHF/fhf-dashboards/cypress/tests/fhf-dashboard/smoke/\``;

  return `# Copilot Instructions — ${lane === "e2e" ? "E2E" : "Smoke"} Overlay

Single source of shared harness policy:
- \`C:\\Users\\Leapfrog\\FHF\\AGENTS.md\`

This file contains only ${lane === "e2e" ? "E2E" : "smoke"} lane deltas.

---

${laneBlock}
`;
}

// Gemini CLI reads GEMINI.md at the project root, same role CLAUDE.md plays for Claude Code.
// Same "thin overlay, canonical source elsewhere" shape as copilotInstructions — never restate
// the non-negotiables independently here, mirror them from the same laneBlock content.
export function geminiInstructions(lane) {
  const laneBlock =
    lane === "e2e"
      ? `## Lane

- Type: E2E / functional / regression
- Environment: Dev and QA
- Mutations: Allowed
- Baseline branch: \`dev\`

---

## Non-Negotiables

- Use command-first architecture: Config -> Commands -> Tests.
- Never use \`cy.wait(number)\`.
- Never hardcode selectors, endpoints, routes, credentials, or secrets.
- Always call \`cy.ensureAuthenticated()\` in both \`before()\` and \`beforeEach()\`.
- Always register intercepts before \`cy.visit()\`.
- Always use \`cy.apiWait()\` before API-dependent assertions.
- Always keep \`testIsolation: true\`.
- Never run mutation tests on production.
- Never use real customer data.

---

## Paths

- Package root: \`CypressFHF/fhf-dashboards/\`
- E2E specs: \`CypressFHF/fhf-dashboards/cypress/tests/fhf-dashboard/e2e/\``
      : `## Lane

- Type: Smoke / availability / auth / structure
- Environment: Production
- Mutations: Forbidden (GET-only)
- Baseline branch: \`staging\`

---

## Non-Negotiables

- Use command-first architecture: Config -> Commands -> Tests.
- Never use \`cy.wait(number)\`.
- Never hardcode selectors, endpoints, routes, credentials, or secrets.
- Always call \`cy.ensureAuthenticated()\` in both \`before()\` and \`beforeEach()\`.
- Always register intercepts before \`cy.visit()\`.
- Always use \`cy.apiWait()\` before API-dependent assertions.
- Always keep \`testIsolation: true\`.
- Never use POST/PUT/PATCH/DELETE in smoke.
- Never assert volatile data values in smoke.
- Deterministic production failures are incidents, not test-fix work.

---

## Paths

- Package root: \`CypressFHF/fhf-dashboards/\`
- Smoke specs: \`CypressFHF/fhf-dashboards/cypress/tests/fhf-dashboard/smoke/\``;

  return `# Gemini Instructions — ${lane === "e2e" ? "E2E" : "Smoke"} Overlay

Single source of shared harness policy:
- \`C:\\Users\\Leapfrog\\FHF\\AGENTS.md\`

This file contains only ${lane === "e2e" ? "E2E" : "smoke"} lane deltas.

---

${laneBlock}
`;
}
