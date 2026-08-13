#!/usr/bin/env node
// Hook self-test — pipes fixture payloads through every hook and asserts exit codes.
// The harness must test itself: a hook with the wrong exit code silently talks to nobody.
// Run: node scripts/harness/test-hooks.mjs   (CI runs it next to check-loader-drift.mjs)
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".claude", "hooks");
const HARNESS_ROOT = path.resolve(HOOKS, "..", "..");
const failures = [];

function run(hook, payload, env = {}, args = []) {
  const r = spawnSync("node", [path.join(HOOKS, hook), ...args], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, ...env },
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function runProbe(hook) {
  const r = spawnSync("node", [path.join(HOOKS, hook)], {
    encoding: "utf8",
    timeout: 15000,
    env: process.env,
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function expect(name, actual, wanted, extra = "") {
  const ok = typeof wanted === "function" ? wanted(actual) : actual.code === wanted;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures.push(`${name} — got exit ${actual.code} ${extra}\n  stdout: ${actual.stdout.trim()}\n  stderr: ${actual.stderr.trim()}`);
}

function cursorAllows(result) {
  try {
    const output = JSON.parse(result.stdout);
    return result.code === 0 &&
      output.hookSpecificOutput?.hookEventName === "PreToolUse" &&
      output.hookSpecificOutput?.permissionDecision === "allow";
  } catch {
    return false;
  }
}

function cursorEmitsNeutral(result) {
  try {
    const output = JSON.parse(result.stdout);
    return result.code === 0 && Object.keys(output).length === 0;
  } catch {
    return false;
  }
}

// Fixture spec files on disk (validate-cypress-rules reads the file, not the payload)
const tmp = mkdtempSync(path.join(tmpdir(), "hook-test-"));
const customConfigPath = path.join(tmp, "harness.config.json");
const customConfig = JSON.parse(
  readFileSync(path.join(HARNESS_ROOT, "config", "qa-control-plane.json"), "utf8"),
);
customConfig.engineering.context.routes = [
  {
    id: "custom-control",
    priority: 100,
    match: "\\bcustom control signal\\b",
    hint: "configured-control-route",
  },
];
customConfig.engineering.harness.forbiddenAgents.push("custom-agent");
customConfig.engineering.harness.skills.push("custom-skill");
customConfig.engineering.loops.sameFailureLimit = 2;
customConfig.engineering.memory.handoffFile = "handoff.json";
customConfig.connectors.cypressCloud.cli.guard.inlineCredentialPatterns = [
  "custom-cloud-secret",
];
customConfig.connectors.cypressCloud.cli.guard.productionSensitivePatterns = [
  "custom-cloud-replay",
];
writeFileSync(customConfigPath, JSON.stringify(customConfig));
const specDir = path.join(tmp, "cypress", "tests");
mkdirSync(specDir, { recursive: true });
const badSpec = path.join(specDir, "bad.cy.js");
writeFileSync(badSpec, "describe('x', () => { it('y', () => { cy.wait(5000); }); });");
const goodSpec = path.join(specDir, "good.cy.js");
writeFileSync(goodSpec, [
  "describe('x', { testIsolation: true }, () => {",
  "  before(() => { cy.ensureAuthenticated(); });",
  "  beforeEach(() => { cy.ensureAuthenticated(); });",
  "  it('y', () => { cy.apiWait('@a'); });",
  "});",
].join("\n"));
const smallRead = path.join(tmp, "small-read.js");
writeFileSync(smallRead, "export const ok = true;\n");
const largeRead = path.join(tmp, "large-read.js");
writeFileSync(largeRead, "export const value = true;\n".repeat(200));

const directInterceptSpec = path.join(specDir, "direct-intercept.cy.js");
writeFileSync(directInterceptSpec, [
  "describe('x', { testIsolation: true }, () => {",
  "  before(() => { cy.ensureAuthenticated(); });",
  "  beforeEach(() => { cy.ensureAuthenticated(); cy.apiIntercept(API.LIST); });",
  "  it('y', () => { cy.apiWait(API.LIST); });",
  "});",
].join("\n"));
const literalRouteSpec = path.join(specDir, "literal-route.cy.js");
writeFileSync(literalRouteSpec, [
  "describe('x', { testIsolation: true }, () => {",
  "  before(() => { cy.ensureAuthenticated(); });",
  "  beforeEach(() => { cy.ensureAuthenticated(); cy.visit('/funding/dashboard'); });",
  "  it('y', () => { cy.apiWait(API.LIST); });",
  "});",
].join("\n"));

// PreToolUse - blockers (exit 2)
expect("context read guard blocks unbounded large reads",
  run("context-read-guard.mjs", { tool_name: "Read", tool_input: { file_path: largeRead } }), 2);
expect("context read guard allows bounded reads",
  run("context-read-guard.mjs", { tool_name: "Read", tool_input: { file_path: largeRead, limit: 120 } }), 0);
expect("context read guard allows small reads",
  run("context-read-guard.mjs", { tool_name: "Read", tool_input: { file_path: smallRead } }), 0);
expect("context read guard emits runtime-neutral JSON",
  run("context-read-guard.mjs", {
    hook_event_name: "preToolUse",
    tool_name: "Read",
    input: { path: largeRead, limit: 120 },
  }), cursorAllows);
expect("protect-app-source blocks fhf-dashboards/src write",
  run("protect-app-source.mjs", { tool_input: { file_path: "C:/Users/Leapfrog/FHF/fhf-dashboards/src/App.tsx" } }), 2);
expect("protect-app-source allows CypressFHF package write",
  run("protect-app-source.mjs", { tool_input: { file_path: "C:/x/CypressFHF/fhf-dashboards/cypress/tests/a.cy.js" } }), 0);
expect("protect-app-source blocks external backend writes",
  run("protect-app-source.mjs", { tool_input: { file_path: "C:/Users/Leapfrog/FHF/fhf-backend-automation/tests/api/test_users.py" } }), 2);
expect("protect-app-source emits runtime-neutral JSON",
  run("protect-app-source.mjs", {
    hook_event_name: "preToolUse",
    cursor_version: "1.7.2",
    input: { path: "C:/x/cypress/tests/a.cy.js" },
  }), cursorAllows);
expect("protect-app-source blocks ApplyPatch payload",
  run("protect-app-source.mjs", { tool_input: { patch: "*** Update File: C:/x/fhf-dashboards/src/App.tsx\n@@\n-old\n+new" } }), 2);
expect("protect-app-source blocks Codex apply_patch payload",
  run("protect-app-source.mjs", { hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { command: "*** Update File: C:/x/fhf-dashboards/src/App.tsx\n@@\n-old\n+new" } }), 2);
expect("protect-second-brain blocks stray wiki scaffolding",
  run("protect-second-brain-boundary.mjs", {
    cwd: "C:/work/project",
    input: { path: "C:/work/project/wiki/index.md" },
  }), 2);
expect("protect-second-brain allows the sibling vault",
  run("protect-second-brain-boundary.mjs", {
    cwd: "C:/work/project",
    input: { path: "C:/work/claude-obsidian/wiki/index.md" },
  }), 0);
expect("protect-second-brain emits runtime-neutral JSON",
  run("protect-second-brain-boundary.mjs", {
    hook_event_name: "preToolUse",
    cursor_version: "1.7.2",
    input: { path: "C:/x/cypress/tests/a.cy.js" },
  }), cursorAllows);
expect("pre-validate blocks cy.wait(number) before write",
  run("pre-validate-cypress-rules.mjs", { tool_input: { file_path: "cypress/tests/a.cy.js", content: "cy.wait(3000);" } }), 2);
expect("pre-validate blocks cy.wait(number) in ApplyPatch payload",
  run("pre-validate-cypress-rules.mjs", { input: { patch: "*** Update File: cypress/tests/a.cy.js\n@@\n-old\n+cy.wait(3000);" } }), 2);
expect("pre-validate blocks mutation in smoke",
  run("pre-validate-cypress-rules.mjs", { tool_input: { file_path: "cypress/tests/smoke/a.cy.js", content: "cy.request({ method: 'POST' }); .post(" } }), 2);
expect("pre-validate emits runtime-neutral JSON",
  run("pre-validate-cypress-rules.mjs", {
    hook_event_name: "preToolUse",
    cursor_version: "1.7.2",
    input: { path: "cypress/tests/a.cy.js", content: "cy.apiWait('@a');" },
  }), cursorAllows);
expect("protect-prod-data blocks a production screenshot",
  run("protect-prod-data.mjs", { tool_name: "Read", tool_input: { file_path: "ProdSmokeExecution/front-end-automation/cypress/screenshots/failure.png" } }), 2);
expect("protect-prod-data allows JUnit timing evidence",
  run("protect-prod-data.mjs", { tool_name: "Read", tool_input: { file_path: "ProdSmokeExecution/front-end-automation/reports/junit/results.xml" } }), 0);
expect("protect-prod-data allows explicit owner opt-in",
  run("protect-prod-data.mjs", { tool_name: "Read", tool_input: { file_path: "ProdSmokeExecution/front-end-automation/cypress/screenshots/failure.png" } }, { FHF_ALLOW_PROD_DATA: "1" }), 0);
expect("protect-prod-data emits runtime-neutral JSON",
  run("protect-prod-data.mjs", {
    hook_event_name: "preToolUse",
    cursor_version: "1.7.2",
    name: "read",
    input: { path: "docs/README.md" },
  }), cursorAllows);
expect("protect-prod-data blocks Cloud CLI Test Replay in production contexts",
  run("protect-prod-data.mjs", { tool_name: "Bash", tool_input: { command: "cy-cloud replay timeline --testId abc --commands --network --logs" } }), 2);
expect("protect-prod-data blocks Cloud CLI failure screenshot downloads",
  run("protect-prod-data.mjs", { tool_name: "Bash", tool_input: { command: "npx @cypress/cloud test get --testId abc --screenshot ./screenshots" } }), 2);

expect("protect-prod-data allows E2E Test Replay when FHF_LANE=e2e is prefixed",
  run("protect-prod-data.mjs", {
    tool_name: "Bash",
    tool_input: { command: "FHF_LANE=e2e cy-cloud replay timeline --testId abc --commands --network --logs" },
  }), 0);
expect("protect-prod-data allows E2E Test Replay from E2E package cwd",
  run("protect-prod-data.mjs", {
    tool_name: "Bash",
    cwd: "C:/work/AG Frontend Automation/front-end-automation/CypressFHF/fhf-dashboards",
    tool_input: {
      working_directory: "C:/work/AG Frontend Automation/front-end-automation/CypressFHF/fhf-dashboards",
      command: "cy-cloud replay timeline --testId abc --commands --network --logs",
    },
  }), 0);
expect("protect-prod-data still blocks Test Replay under smoke package cwd",
  run("protect-prod-data.mjs", {
    tool_name: "Bash",
    cwd: "C:/work/ProdSmokeExecution/front-end-automation/CypressFHF/fhf-dashboards",
    tool_input: {
      working_directory: "C:/work/ProdSmokeExecution/front-end-automation/CypressFHF/fhf-dashboards",
      command: "cy-cloud replay timeline --testId abc --commands --network --logs",
    },
  }), 2);

expect("protect-prod-data allows Cloud CLI metadata",
  run("protect-prod-data.mjs", { tool_name: "Bash", tool_input: { command: "cy-cloud test list --projectId abc --runNumber 1 --status failed" } }), 0);
expect("protect-prod-data allows no-network Cloud CLI schemas",
  run("protect-prod-data.mjs", { tool_name: "Bash", tool_input: { command: "cy-cloud replay timeline --schema" } }), 0);
expect("protect-prod-data does not let schema flags bypass chained replay",
  run("protect-prod-data.mjs", { tool_name: "Bash", tool_input: { command: "cy-cloud replay timeline --schema; cy-cloud replay timeline --testId abc" } }), 2);
expect("protect-prod-data consumes central Cloud CLI policy",
  run("protect-prod-data.mjs", { tool_name: "Bash", tool_input: { command: "custom-cloud-replay" } }, {
    FHF_HARNESS_CONFIG: customConfigPath,
  }), 2);
expect("manual-task-guard blocks force push",
  run("manual-task-guard.mjs", { tool_input: { command: "git push --force origin main" } }), 2);
expect("manual-task-guard blocks shell writes to application source",
  run("manual-task-guard.mjs", {
    tool_input: {
      command: "Set-Content 'C:/work/fhf-dashboards/src/App.tsx' 'changed'",
    },
  }), 2);
expect("manual-task-guard blocks shell writes to the external backend",
  run("manual-task-guard.mjs", {
    tool_input: {
      command: "Set-Content 'C:/work/fhf-backend-automation/tests/api/test_users.py' 'changed'",
    },
  }), 2);
expect("manual-task-guard blocks backend git commits from its working directory",
  run("manual-task-guard.mjs", {
    cwd: "C:/work/fhf-backend-automation",
    tool_input: { working_directory: "C:/work/fhf-backend-automation", command: "git commit -m change" },
  }), 2);
expect("manual-task-guard blocks backend dependency installs",
  run("manual-task-guard.mjs", {
    cwd: "C:/work/fhf-backend-automation",
    tool_input: { working_directory: "C:/work/fhf-backend-automation", command: "pip install -r requirements.txt" },
  }), 2);
expect("manual-task-guard blocks backend test runs",
  run("manual-task-guard.mjs", {
    cwd: "C:/work/fhf-backend-automation",
    tool_input: { working_directory: "C:/work/fhf-backend-automation", command: "pytest tests/api" },
  }), 2);
expect("manual-task-guard allows read-only backend searches",
  run("manual-task-guard.mjs", {
    tool_input: { command: "rg oracle C:/work/fhf-backend-automation" },
  }), 0);
expect("manual-task-guard allows read-only source searches",
  run("manual-task-guard.mjs", {
    tool_input: { command: "rg data-cy C:/work/fhf-dashboards/src" },
  }), 0);
expect("manual-task-guard blocks inline Cloud CLI tokens",
  run("manual-task-guard.mjs", { tool_input: { command: "cy-cloud login --token secret" } }), 2);
expect("manual-task-guard blocks shell-assigned Cloud CLI tokens",
  run("manual-task-guard.mjs", { tool_input: { command: "$env:CYPRESS_CLOUD_TOKEN = 'secret'; cy-cloud run list" } }), 2);
expect("manual-task-guard allows Cloud CLI OAuth status",
  run("manual-task-guard.mjs", { tool_input: { command: "cy-cloud status" } }), 0);
expect("manual-task-guard emits runtime-neutral JSON",
  run("manual-task-guard.mjs", {
    hook_event_name: "preToolUse",
    cursor_version: "1.7.2",
    tool_input: { command: "git status" },
  }), cursorAllows);
for (const hook of [
  "manual-task-guard.mjs",
  "protect-app-source.mjs",
  "protect-second-brain-boundary.mjs",
  "pre-validate-cypress-rules.mjs",
  "protect-prod-data.mjs",
]) {
  expect(`${hook} allows a metadata-less Cursor probe`, runProbe(hook), cursorAllows);
}
expect("shared nested response allows metadata-light Cursor payloads",
  run("manual-task-guard.mjs", {
    hook_event_name: "PreToolUse",
    tool_input: { command: "git status" },
  }), cursorAllows);
expect("shared nested response allows Claude payloads",
  run("manual-task-guard.mjs", {
    hook_event_name: "PreToolUse",
    session_id: "claude-session",
    transcript_path: "C:/tmp/claude-transcript.jsonl",
    tool_input: { command: "git status" },
  }), cursorAllows);
expect("manual-task-guard consumes central Cloud CLI credential policy",
  run("manual-task-guard.mjs", { tool_input: { command: "custom-cloud-secret" } }, {
    FHF_HARNESS_CONFIG: customConfigPath,
  }), 2);
expect("manual-task-guard allows git status",
  run("manual-task-guard.mjs", { tool_input: { command: "git status" } }), 0);
expect("block-generic-agents blocks general-purpose",
  run("block-generic-agents.mjs", { tool_input: { subagent_type: "general-purpose" } }), 2);
expect("block-generic-agents allows cypress-generator",
  run("block-generic-agents.mjs", { tool_input: { subagent_type: "cypress-generator" } }), 0);
expect("block-generic-agents blocks retired agent names",
  run("block-generic-agents.mjs", { tool_input: { subagent_type: "cypress-runner" } }), 2);
expect("block-generic-agents denies a Cursor-matched subagent",
  run("block-generic-agents.mjs", {}, {}, ["--deny-matched-subagent"]), 2);
expect("block-generic-agents warns (not BLOCKED) on a forbidden agent_type via SubagentStart",
  run("block-generic-agents.mjs", { hook_event_name: "SubagentStart", agent_type: "general-purpose" }),
  (r) => r.code === 2 && r.stderr.includes("WARNING") && !r.stderr.includes("BLOCKED"));
expect("block-generic-agents allows an approved agent_type via SubagentStart",
  run("block-generic-agents.mjs", { hook_event_name: "SubagentStart", agent_type: "cypress-generator" }), 0);
expect("block-generic-agents consumes the central roster",
  run("block-generic-agents.mjs", { tool_input: { subagent_type: "custom-agent" } }, {
    FHF_HARNESS_CONFIG: customConfigPath,
  }), 2);
expect("block-forbidden-skills blocks a skill absent from the allowlist",
  run("block-forbidden-skills.mjs", { tool_input: { skill: "cypress-author" } }), 2);
expect("block-forbidden-skills allows an allowlisted skill",
  run("block-forbidden-skills.mjs", { tool_input: { skill: "cypress-explain" } }), 0);
expect("block-forbidden-skills matches skill names case-insensitively",
  run("block-forbidden-skills.mjs", { tool_input: { skill: "Cypress-Docs" } }), 0);
expect("block-forbidden-skills noops on a payload without a skill",
  run("block-forbidden-skills.mjs", { tool_input: { file_path: "cypress/tests/a.cy.js" } }), 0);
expect("block-forbidden-skills allows a metadata-less probe",
  runProbe("block-forbidden-skills.mjs"), 0);
expect("block-forbidden-skills consumes the central skill roster",
  run("block-forbidden-skills.mjs", { tool_input: { skill: "custom-skill" } }, {
    FHF_HARNESS_CONFIG: customConfigPath,
  }), 0);

// PostToolUse — validators must exit 2 (exit 1 would be invisible to Claude)
expect("validate-cypress-rules flags bad spec with exit 2",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: badSpec } }), 2);
expect("validate-cypress-rules passes clean spec",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: goodSpec } }), 0);
expect("validate-cypress-rules blocks raw intercepts in specs",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: directInterceptSpec } }), 2);
expect("validate-cypress-rules blocks literal routes in specs",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: literalRouteSpec } }), 2);
expect("scenario-content-guard flags missing fields with exit 2",
  run("scenario-content-guard.mjs", { tool_input: { file_path: "cypress/configs/scenarios/x.scenarios.js", content: "export const scenarios = [{}]" } }), 2);
expect("coverage-strategy-guard flags visit-before-intercept with exit 2",
  run("coverage-strategy-guard.mjs", { tool_input: { file_path: "cypress/tests/a.cy.js", content: "cy.visit('/x'); cy.intercept('GET','/api');" } }), 2);

// UserPromptSubmit — router must exit 0 and speak on stdout (context channel)
expect("prompt-router flags drift on stdout, exit 0",
  run("prompt-router.mjs", { prompt: "also can you fix the filter test" }),
  (r) => r.code === 0 && r.stdout.includes("[router]"));
expect("prompt-router hints lane for new test prompts",
  run("prompt-router.mjs", { prompt: "write a new smoke test for insurance" }),
  (r) => r.code === 0 && r.stdout.includes("cypress-generator"));
expect("prompt-router injects one owner for documentation work",
  run("prompt-router.mjs", { prompt: "remove duplicate documentation and context noise" }),
  (r) => r.code === 0 && r.stdout.includes("docs/README.md") && r.stdout.includes("documentation.owners"));
expect("prompt-router prioritizes test creation over generic documentation",
  run("prompt-router.mjs", { prompt: "write a new test and document the scenario" }),
  (r) => r.code === 0 && r.stdout.includes("[router:new-test]") && !r.stdout.includes("[router:documentation]"));
expect("prompt-router does not route external backend work to Cypress agents",
  run("prompt-router.mjs", {
    cwd: "C:/work/fhf-backend-automation",
    prompt: "write a new test for the backend API",
  }),
  cursorEmitsNeutral);
const externalBackendHandoff = path.join(tmp, "fhf-backend-automation", "cypress", "handoff", "session-latest.json");
expect("prompt-router does not write a handoff in the external backend",
  run("prompt-router.mjs", {
    cwd: path.join(tmp, "fhf-backend-automation"),
    prompt: "Work SERV-12345 using /api/backend",
  }),
  (r) => r.code === 0 && !existsSync(externalBackendHandoff));
expect("prompt-router routes planning to one ledger",
  run("prompt-router.mjs", { prompt: "what is the current capacity and priority?" }),
  (r) => r.code === 0 && r.stdout.includes("effort-breakdown-by-module-and-subdashboard.md"));
expect("prompt-router prioritizes current test presence over broad coverage reporting",
  run("prompt-router.mjs", { prompt: "show current coverage and test presence" }),
  (r) => r.code === 0 && r.stdout.includes("[router:coverage-presence]"));
expect("prompt-router loads deep test docs only on demand",
  run("prompt-router.mjs", { prompt: "how should this API alias and intercept work?" }),
  (r) => r.code === 0 && r.stdout.includes("api-layer-guide.md"));
expect("prompt-router doesn't fire Jira hint on meta-discussion that only mentions Jira",
  run("prompt-router.mjs", { prompt: "this harness turns jira tickets into cypress specs — is that the right layer for a compliance linter?" }),
  (r) => r.code === 0 && !r.stdout.includes("Jira ticket → spawn cypress-generator"));
expect("prompt-router emits neutral JSON on plain prompts",
  run("prompt-router.mjs", { prompt: "hello" }),
  cursorEmitsNeutral);
expect("prompt-router consumes the central route table",
  run("prompt-router.mjs", { prompt: "custom control signal" }, {
    FHF_HARNESS_CONFIG: customConfigPath,
  }),
  (r) => r.code === 0 && r.stdout.includes("configured-control-route"));
expect("prompt-router emits the shared Claude/Cursor context format",
  run("prompt-router.mjs", {
    hook_event_name: "beforeSubmitPrompt",
    cursor_version: "1.7.2",
    prompt: "write a new smoke test",
  }),
  (r) => {
    try {
      const output = JSON.parse(r.stdout);
      return r.code === 0 &&
        output.hookSpecificOutput?.hookEventName === "UserPromptSubmit" &&
        output.hookSpecificOutput?.additionalContext.includes("New test");
    } catch {
      return false;
    }
  });

const memoryPrompt = run("prompt-router.mjs", {
  session_id: "memory-session",
  prompt: "Work SERV-12345 in insurance.cy.js using [data-cy=\"save-button\"] and /api/insurance; keep docs/evidence/run.json",
}, { CLAUDE_CWD: tmp });
expect("prompt-router persists only configured exact facts", memoryPrompt, (r) => {
  try {
    const handoff = JSON.parse(readFileSync(path.join(tmp, "cypress", "handoff", "session-latest.json"), "utf8"));
    return r.code === 0 &&
      handoff.facts["ticket-ids"].includes("SERV-12345") &&
      handoff.facts.selectors.includes("[data-cy=\"save-button\"]") &&
      handoff.facts.endpoints.includes("/api/insurance");
  } catch {
    return false;
  }
});
expect("session-context restores fresh exact facts for Cursor",
  run("session-context.mjs", {
    hook_event_name: "sessionStart",
    cursor_version: "1.7.2",
    conversation_id: "memory-session",
    workspace_roots: [tmp],
  }, { CLAUDE_CWD: tmp }),
  (r) => {
    try {
      const output = JSON.parse(r.stdout);
      return output.hookSpecificOutput?.hookEventName === "SessionStart" &&
        output.hookSpecificOutput?.additionalContext.includes("SERV-12345");
    } catch {
      return false;
    }
  });
expect("memory checkpoint survives pre-compaction",
  run("memory-checkpoint.mjs", {
    hook_event_name: "preCompact",
    cursor_version: "1.7.2",
    conversation_id: "memory-session",
    workspace_roots: [tmp],
  }, { CLAUDE_CWD: tmp }),
  (r) => {
    try {
      const handoff = JSON.parse(readFileSync(path.join(tmp, "cypress", "handoff", "session-latest.json"), "utf8"));
      return r.code === 0 && Boolean(handoff.checkpointAt);
    } catch {
      return false;
    }
  });

// Stop — sweep exits 0 when there are no repos/specs to check
expect("spec-sweep exits 0 with no git repos in CWD",
  run("spec-sweep-stop-hook.mjs", {}, { CLAUDE_CWD: tmp }), 0);
expect("spec-sweep does not write retry state in the external backend",
  run("spec-sweep-stop-hook.mjs", {}, { CLAUDE_CWD: path.join(tmp, "fhf-backend-automation") }),
  (r) => r.code === 0 && !existsSync(path.join(tmp, "fhf-backend-automation", ".claude", "hooks", ".sweep-retries")));
const failurePayload = {
  hook_event_name: "postToolUseFailure",
  cursor_version: "1.7.2",
  conversation_id: `failure-${path.basename(tmp)}`,
  tool_name: "Shell",
  error_message: "same deterministic failure",
  failure_type: "error",
};
expect("failure loop records first failure",
  run("failure-loop-guard.mjs", failurePayload, {
    FHF_HARNESS_CONFIG: customConfigPath,
  }), cursorEmitsNeutral);
expect("failure loop reaches configured limit",
  run("failure-loop-guard.mjs", failurePayload, {
    FHF_HARNESS_CONFIG: customConfigPath,
  }),
  (r) => {
    try {
      const output = JSON.parse(r.stdout);
      return r.code === 0 &&
        output.hookSpecificOutput?.hookEventName === "PostToolUseFailure" &&
        output.hookSpecificOutput?.additionalContext.includes("limit reached");
    } catch {
      return false;
    }
  });
expect("stop hook issues one configured escalation follow-up",
  run("session-end-reminder.mjs", {
    hook_event_name: "stop",
    cursor_version: "1.7.2",
    conversation_id: failurePayload.conversation_id,
  }, { FHF_HARNESS_CONFIG: customConfigPath }),
  (r) => {
    try {
      const output = JSON.parse(r.stdout);
      return r.code === 0 &&
        output.decision === "block" &&
        output.reason.includes("configured limit");
    } catch {
      return false;
    }
  });
expect("stop hook does not repeat an issued escalation",
  run("session-end-reminder.mjs", {
    hook_event_name: "stop",
    cursor_version: "1.7.2",
    conversation_id: failurePayload.conversation_id,
  }, { FHF_HARNESS_CONFIG: customConfigPath }), cursorEmitsNeutral);

rmSync(tmp, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${failures.length} hook self-test failure(s):`);
  failures.forEach((f) => console.error("  " + f));
  process.exit(1);
}
console.log("\nAll hook self-tests passed.");
