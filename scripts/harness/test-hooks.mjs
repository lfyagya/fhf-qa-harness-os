#!/usr/bin/env node
// Hook self-test — pipes fixture payloads through every hook and asserts exit codes.
// The harness must test itself: a hook with the wrong exit code silently talks to nobody.
// Run: node scripts/harness/test-hooks.mjs   (CI runs it next to check-loader-drift.mjs)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { approvalDigest } from "./task-protocol-lib.mjs";
import { loadHarnessConfig } from "../../.claude/hooks/lib/harness-config.mjs";
import { recordCapabilityOutcome } from "../../.claude/hooks/lib/capability-control.mjs";

const HOOKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".claude", "hooks");
const HARNESS_ROOT = path.resolve(HOOKS, "..", "..");
const failures = [];
const isolatedGitEnv = { ...process.env };
for (const key of [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  // Owner opt-in overrides must never reach a spawned guard. These tests assert that a guard
  // DENIES; if the operator happens to have an override exported, every deny case silently
  // returns allow and the suite reports green while testing nothing. Found the moment
  // FHF_ALLOW_HARNESS_EDIT was introduced (2026-09-05); FHF_ALLOW_PROD_DATA had the same
  // latent hole since that guard was written.
  "FHF_ALLOW_HARNESS_EDIT",
  "FHF_ALLOW_PROD_DATA",
]) delete isolatedGitEnv[key];

function run(hook, payload, env = {}, args = []) {
  const r = spawnSync("node", [path.join(HOOKS, hook), ...args], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 15000,
    env: { ...isolatedGitEnv, ...env },
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function runProbe(hook) {
  const r = spawnSync("node", [path.join(HOOKS, hook)], {
    encoding: "utf8",
    timeout: 15000,
    env: isolatedGitEnv,
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
const invalidConfigPath = path.join(tmp, "invalid-harness.config.json");
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
writeFileSync(invalidConfigPath, "{\n", "utf8");
const smokeRoot = path.join(tmp, "smoke-consumer");
mkdirSync(path.join(smokeRoot, ".harness"), { recursive: true });
writeFileSync(path.join(smokeRoot, ".harness", "lane.json"), JSON.stringify({ lane: "smoke" }));
const smokeConfigPath = path.join(tmp, "smoke-harness.config.json");
const smokeConfig = structuredClone(customConfig);
smokeConfig.paths.lanes.smoke.branch = "";
smokeConfig.workspaceContract.lanes.smoke.requireBranch = false;
smokeConfig.workspaceContract.lanes.smoke.requiredLocalPaths = [];
smokeConfig.workspaceContract.lanes.smoke.requiredWorkspacePaths = [];
smokeConfig.moduleSpecPaths = {};
writeFileSync(smokeConfigPath, JSON.stringify(smokeConfig));
const backendRoot = path.join(tmp, "fhf-backend-automation");
const backendTestDir = path.join(backendRoot, "tests", "api", "users");
mkdirSync(backendTestDir, { recursive: true });
const backendTestPath = path.join(backendTestDir, "test_users.py");
const backendBadTestPath = path.join(backendTestDir, "test_bad.py");
writeFileSync(backendTestPath, [
  "from tests.commons.assertions import assert_status_code",
  "",
  "def test_users(api_client):",
  "    assert_status_code(api_client.get_users(), 200)",
].join("\n"));
writeFileSync(backendBadTestPath, [
  "def test_users(api_client):",
  "    assert api_client.get_users().status_code == 200",
].join("\n"));
const fixtureGitEnv = { ...isolatedGitEnv };
execFileSync("git", ["init", "--quiet", backendRoot], { env: fixtureGitEnv });
const backendHooks = path.join(backendRoot, ".hook-fixture");
mkdirSync(backendHooks, { recursive: true });
execFileSync("git", ["-C", backendRoot, "add", "."], { env: fixtureGitEnv });
execFileSync("git", [
  "-C", backendRoot,
  "-c", `core.hooksPath=${backendHooks}`,
  "-c", "user.name=FHF Harness",
  "-c", "user.email=fhf-harness@example.invalid",
  "commit", "--quiet", "-m", "fixture",
], { env: fixtureGitEnv });
const backendSha = execFileSync("git", ["-C", backendRoot, "rev-parse", "HEAD"], {
  encoding: "utf8",
  env: fixtureGitEnv,
}).trim();
const activeTaskPath = path.join(tmp, "active-task.json");
const activeTask = {
  schema: "fhf-harness/task/v1",
  id: "SERV-12360-agent-contact",
  stage: "implementing",
  ticketFamily: { primary: "SERV-12360", related: ["SERV-12359"] },
  grounding: {
    jira: { issueDigest: "a".repeat(64) },
    acceptanceCriteriaDigest: "b".repeat(64),
    catalogVersion: customConfig.productTopology.catalogVersion,
    repositories: [{
      id: "fhf-backend-automation",
      baseSha: backendSha,
      headSha: backendSha,
      selectedPaths: ["tests/api/users", "api/users"],
    }],
    intentVsBuilt: {
      rows: [{
        id: "ac-agent-contact",
        intent: "Agent contact API returns the selected contract",
        built: "Agent contact API returns the selected contract",
        classification: "same",
      }],
    },
  },
  selection: {
    routeId: "cross-layer-test-generation",
    module: "agent-contact",
    graphNodes: ["jira:SERV-12360", "repo:fhf-backend-automation"],
    sourceBundles: ["full-stack-change"],
    expansionReasons: ["linked backend implementation ticket"],
  },
  plan: {
    changeUnits: [{
      id: "backend-tests",
      repoId: "fhf-backend-automation",
      paths: ["tests/api/users", "api/users"],
      dependsOn: [],
    }],
    impact: { functional: ["agent contact API"], regression: ["agent contact"], smoke: [] },
    tests: [{
      id: "backend-agent-contact",
      runnerId: "backend-api-oracle",
      repoId: "fhf-backend-automation",
      path: "tests/api/users/test_users.py",
      environment: "qa",
      proofMode: "external-execution-evidence",
      honesty: "live",
      acceptanceIds: ["ac-agent-contact"],
    }],
  },
  approval: { required: true, approvedDigest: null, reference: "owner-approved-fixture" },
  evidence: { artifacts: [] },
};
activeTask.approval.approvedDigest = approvalDigest(
  activeTask,
  customConfig.engineering.taskProtocol.approval.boundFields,
);
writeFileSync(activeTaskPath, JSON.stringify(activeTask));
const activeTaskEnv = { FHF_ACTIVE_TASK: activeTaskPath };
const staleTaskPath = path.join(tmp, "stale-task.json");
const staleTask = structuredClone(activeTask);
staleTask.plan.impact.regression.push("changed after approval");
writeFileSync(staleTaskPath, JSON.stringify(staleTask));
const staleTaskEnv = { FHF_ACTIVE_TASK: staleTaskPath };
const wrongRevisionTaskPath = path.join(tmp, "wrong-revision-task.json");
const wrongRevisionTask = structuredClone(activeTask);
wrongRevisionTask.grounding.repositories[0].headSha = "d".repeat(40);
wrongRevisionTask.approval.approvedDigest = approvalDigest(
  wrongRevisionTask,
  customConfig.engineering.taskProtocol.approval.boundFields,
);
writeFileSync(wrongRevisionTaskPath, JSON.stringify(wrongRevisionTask));
const wrongRevisionTaskEnv = { FHF_ACTIVE_TASK: wrongRevisionTaskPath };
const validOverlay = JSON.stringify({
  version: customConfig.engineering.context.runtimeOverlay.version,
  session: {
    routeId: "custom-control",
    reason: "golden route test",
    ticket: "SERV-123",
    module: "insurance",
  },
  context: { readOutput: { maxLines: 60 } },
  loops: { sameFailureLimit: 1 },
});
const specDir = path.join(tmp, "cypress", "tests");
mkdirSync(specDir, { recursive: true });
const badSpec = path.join(specDir, "bad.cy.js");
writeFileSync(badSpec, "describe('x', () => { it('y', () => { cy.wait(5000); }); });");
const goodSpec = path.join(specDir, "good.cy.js");
writeFileSync(goodSpec, [
  "describe('x', { testIsolation: true, tags: SUITE_TAGS.CONTRACTS }, () => {",
  "  before(() => { cy.ensureAuthenticated(); });",
  "  beforeEach(() => { cy.ensureAuthenticated(); });",
  "  it('y', { tags: [TAGS.STATUS.REGRESSION] }, () => { cy.apiWait('@a'); cy.get('.r').should('be.visible'); });",
  "});",
].join("\n"));
const untaggedSpec = path.join(specDir, "untagged.cy.js");
writeFileSync(untaggedSpec, [
  "describe('x', { testIsolation: true }, () => {",
  "  before(() => { cy.ensureAuthenticated(); });",
  "  beforeEach(() => { cy.ensureAuthenticated(); });",
  "  it('y', () => { cy.apiWait('@a'); });",
  "});",
].join("\n"));
// Config-freeze fixtures. A pure re-export barrel declares no object of its own, so the
// freeze check can never be satisfied by one — flagging it made every barrel permanently
// un-editable (verified false positive 2026-08-17 on
// configs/ui/modules/unifi/collections/index.js). The exception must stay narrow: a config
// that declares anything besides re-exports is still required to freeze it.
const uiConfigDir = path.join(tmp, "cypress", "configs", "ui");
mkdirSync(uiConfigDir, { recursive: true });
const barrelConfig = path.join(uiConfigDir, "index.js");
writeFileSync(barrelConfig, [
  "// Contact Log UI Config",
  "export * from './contactLog.ui.js';",
  "",
  "/* Notes UI Config */",
  "export { NOTES_UI } from './notes.ui.js';",
].join("\n"));
const unfrozenConfig = path.join(uiConfigDir, "unfrozen.ui.js");
writeFileSync(unfrozenConfig, [
  "export * from './contactLog.ui.js';",
  "export const LEAKY_UI = { ROW: '[data-cy=\"row\"]' };",
].join("\n"));

const smallRead = path.join(tmp, "small-read.js");
writeFileSync(smallRead, "export const ok = true;\n");
const largeRead = path.join(tmp, "large-read.js");
writeFileSync(largeRead, "export const value = true;\n".repeat(200));

const directInterceptSpec = path.join(specDir, "direct-intercept.cy.js");
writeFileSync(directInterceptSpec, [
  "describe('x', { testIsolation: true, tags: SUITE_TAGS.CONTRACTS }, () => {",
  "  before(() => { cy.ensureAuthenticated(); });",
  "  beforeEach(() => { cy.ensureAuthenticated(); cy.apiIntercept(API.LIST); });",
  "  it('y', { tags: [TAGS.STATUS.REGRESSION] }, () => { cy.apiWait(API.LIST); });",
  "});",
].join("\n"));
const literalRouteSpec = path.join(specDir, "literal-route.cy.js");
writeFileSync(literalRouteSpec, [
  "describe('x', { testIsolation: true, tags: SUITE_TAGS.CONTRACTS }, () => {",
  "  before(() => { cy.ensureAuthenticated(); });",
  "  beforeEach(() => { cy.ensureAuthenticated(); cy.visit('/funding/dashboard'); });",
  "  it('y', { tags: [TAGS.STATUS.REGRESSION] }, () => { cy.apiWait(API.LIST); });",
  "});",
].join("\n"));
const smokeSpecDir = path.join(tmp, "cypress", "tests", "fhf-dashboard", "smoke");
mkdirSync(smokeSpecDir, { recursive: true });
const smokeLoadSpec = path.join(smokeSpecDir, "load.cy.js");
writeFileSync(smokeLoadSpec, [
  "describe('x', { testIsolation: true, tags: SUITE_TAGS.CONTRACTS }, () => {",
  "  before(() => { cy.ensureAuthenticated(); });",
  "  beforeEach(() => { cy.ensureAuthenticated(); });",
  "  it('y', { tags: [TAGS.STATUS.CRITICAL] }, () => { cy.apiWait('@a'); cy.get('.r').should('be.visible'); });",
  "});",
].join("\n"));
const smokeOverCapSpec = path.join(smokeSpecDir, "over-cap.cy.js");
writeFileSync(smokeOverCapSpec, [
  "describe('a', { testIsolation: true, tags: SUITE_TAGS.CONTRACTS }, () => {",
  "  before(() => { cy.ensureAuthenticated(); });",
  "  beforeEach(() => { cy.ensureAuthenticated(); });",
  "  it('b', { tags: [TAGS.STATUS.CRITICAL] }, () => { cy.apiWait('@a'); });",
  "  it('c', { tags: [TAGS.STATUS.CRITICAL] }, () => { cy.apiWait('@a'); });",
  "  it('d', { tags: [TAGS.STATUS.CRITICAL] }, () => { cy.apiWait('@a'); });",
  "  it('e', { tags: [TAGS.STATUS.CRITICAL] }, () => { cy.apiWait('@a'); });",
  "});",
].join("\n"));
const smokeQuarantineSpec = path.join(smokeSpecDir, "quarantine.cy.js");
writeFileSync(smokeQuarantineSpec, [
  "describe('x', { testIsolation: true, tags: SUITE_TAGS.CONTRACTS }, () => {",
  "  before(() => { cy.ensureAuthenticated(); });",
  "  beforeEach(() => { cy.ensureAuthenticated(); });",
  "  it('y', { tags: [TAGS.STATUS.QUARANTINE] }, () => { cy.apiWait('@a'); });",
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
expect("context read guard allows a metadata-less Cursor probe",
  runProbe("context-read-guard.mjs"), cursorAllows);
expect("protect-app-source blocks fhf-dashboards/src write",
  run("protect-app-source.mjs", { tool_input: { file_path: "C:/work/FHF/fhf-dashboards/src/App.tsx" } }), 2);
expect("protect-app-source allows CypressFHF package write",
  run("protect-app-source.mjs", { tool_input: { file_path: "C:/x/CypressFHF/fhf-dashboards/cypress/tests/a.cy.js" } }), 0);
expect("protect-app-source leaves backend automation to its scoped boundary",
  run("protect-app-source.mjs", { tool_input: { file_path: backendTestPath } }), 0);
expect("protect-automation-scope blocks backend writes without an active task",
  run("protect-automation-scope.mjs", { cwd: backendRoot, tool_input: { file_path: backendTestPath } }), 2);
expect("protect-automation-scope allows a selected backend test path",
  run("protect-automation-scope.mjs", { cwd: backendRoot, tool_input: { file_path: backendTestPath } }, activeTaskEnv), 0);
expect("protect-automation-scope blocks stale task approval",
  run("protect-automation-scope.mjs", { cwd: backendRoot, tool_input: { file_path: backendTestPath } }, staleTaskEnv), 2);
expect("protect-automation-scope blocks a changed backend repository revision",
  run("protect-automation-scope.mjs", { cwd: backendRoot, tool_input: { file_path: backendTestPath } }, wrongRevisionTaskEnv), 2);
expect("protect-automation-scope blocks an unplanned backend path",
  run("protect-automation-scope.mjs", {
    cwd: backendRoot,
    tool_input: { file_path: path.join(backendRoot, "tests", "api", "contracts", "test_contracts.py") },
  }, activeTaskEnv), 2);
expect("protect-automation-scope blocks backend credentials",
  run("protect-automation-scope.mjs", {
    cwd: backendRoot,
    tool_input: { file_path: path.join(backendRoot, "tests", ".env") },
  }, activeTaskEnv), 2);
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
  run("protect-prod-data.mjs", { tool_name: "Read", tool_input: { file_path: "front-end-automation-smoke/cypress/screenshots/failure.png" } }), 2);
expect("protect-prod-data allows JUnit timing evidence",
  run("protect-prod-data.mjs", { tool_name: "Read", tool_input: { file_path: "front-end-automation-smoke/reports/junit/results.xml" } }), 0);
expect("protect-prod-data allows explicit owner opt-in",
  run("protect-prod-data.mjs", { tool_name: "Read", tool_input: { file_path: "front-end-automation-smoke/cypress/screenshots/failure.png" } }, { FHF_ALLOW_PROD_DATA: "1" }), 0);
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
    cwd: "C:/work/front-end-automation-e2e/CypressFHF/fhf-dashboards",
    tool_input: {
      working_directory: "C:/work/front-end-automation-e2e/CypressFHF/fhf-dashboards",
      command: "cy-cloud replay timeline --testId abc --commands --network --logs",
    },
  }, { FHF_LANE: "e2e" }), 0);
expect("protect-prod-data still blocks Test Replay under smoke package cwd",
  run("protect-prod-data.mjs", {
    tool_name: "Bash",
    cwd: "C:/work/front-end-automation-smoke/CypressFHF/fhf-dashboards",
    tool_input: {
      working_directory: "C:/work/front-end-automation-smoke/CypressFHF/fhf-dashboards",
      command: "cy-cloud replay timeline --testId abc --commands --network --logs",
    },
  }, { FHF_LANE: "smoke" }), 2);

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
    cwd: backendRoot,
    tool_input: { working_directory: backendRoot, command: "pytest tests/api/users/test_users.py" },
  }), 2);
expect("manual-task-guard allows the exact selected backend pytest path",
  run("manual-task-guard.mjs", {
    cwd: backendRoot,
    tool_input: { working_directory: backendRoot, command: "python -m pytest tests/api/users/test_users.py" },
  }, activeTaskEnv), 0);
expect("manual-task-guard blocks a broader backend pytest selection",
  run("manual-task-guard.mjs", {
    cwd: backendRoot,
    tool_input: { working_directory: backendRoot, command: "pytest tests/api" },
  }, activeTaskEnv), 2);
expect("manual-task-guard blocks a production backend pytest command",
  run("manual-task-guard.mjs", {
    cwd: backendRoot,
    tool_input: { working_directory: backendRoot, command: "pytest tests/api/users/test_users.py --environment production" },
  }, activeTaskEnv), 2);
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
  "protect-automation-scope.mjs",
  "protect-second-brain-boundary.mjs",
  "pre-validate-cypress-rules.mjs",
  "protect-prod-data.mjs",
  "context-read-guard.mjs",
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
expect("block-generic-agents allows qa-automation-generator",
  run("block-generic-agents.mjs", { tool_input: { subagent_type: "qa-automation-generator" } }), 0);
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
expect("prompt-router applies a validated session overlay",
  run("prompt-router.mjs", { prompt: "ordinary prompt" }, {
    FHF_HARNESS_CONFIG: customConfigPath,
    FHF_HARNESS_OVERLAY: validOverlay,
  }),
  (r) => r.code === 0 && r.stdout.includes("[router:custom-control]") && r.stdout.includes("SERV-123"));
expect("prompt-router rejects an overlay that changes topology",
  run("prompt-router.mjs", { prompt: "ordinary prompt" }, {
    FHF_HARNESS_CONFIG: customConfigPath,
    FHF_HARNESS_OVERLAY: JSON.stringify({ version: 1, harness: { agents: [] } }),
  }),
  (r) => r.code === 2 && r.stderr.includes("WORKSPACE BLOCKED") && r.stderr.includes("section is not allowed"));
expect("prompt-router blocks malformed harness config with repair guidance",
  run("prompt-router.mjs", { prompt: "ordinary prompt" }, {
    FHF_HARNESS_CONFIG: invalidConfigPath,
  }),
  (r) => r.code === 2 && r.stderr.includes("Harness configuration is unavailable or invalid") && r.stderr.includes("Harness config is invalid"));
expect("prompt-router blocks ticket grounding and requests Jira OAuth access",
  run("prompt-router.mjs", { prompt: "work SERV-11887" }, { FHF_JIRA_MCP: "false", CLAUDE_CWD: tmp }),
  (r) => r.code === 2 && r.stderr.includes("CAPABILITY BLOCKED") && r.stderr.includes("OAuth") && r.stderr.includes("sanitized ticket export"));
expect("prompt-router blocks a declared connector until a live ticket read is recorded",
  run("prompt-router.mjs", { prompt: "work SERV-11887" }, { FHF_JIRA_MCP: "true", CLAUDE_CWD: tmp }),
  (r) => r.code === 2 && r.stderr.includes("no observed probe result") && r.stderr.includes("ticket contents remain outside runtime state"));
expect("prompt-router blocks an unconfigured Smoke workspace",
  run("prompt-router.mjs", { cwd: smokeRoot, prompt: "write a new smoke test" }, {
    FHF_HARNESS_CONFIG: smokeConfigPath,
  }),
  (r) => r.code === 2 && r.stderr.includes("WORKSPACE BLOCKED"));
expect("prompt-router exposes setup guidance for a setup prompt",
  run("prompt-router.mjs", { cwd: smokeRoot, prompt: "run the workspace setup" }, {
    FHF_HARNESS_CONFIG: smokeConfigPath,
  }),
  (r) => r.code === 0 && r.stdout.includes("WORKSPACE BLOCKED"));
expect("manual-task-guard blocks an unconfigured Smoke workspace",
  run("manual-task-guard.mjs", { cwd: smokeRoot, tool_input: { command: "git status" } }, {
    FHF_HARNESS_CONFIG: smokeConfigPath,
  }),
  (r) => r.code === 2 && r.stderr.includes("WORKSPACE BLOCKED"));
expect("manual-task-guard allows the Smoke setup command before configuration",
  run("manual-task-guard.mjs", { cwd: smokeRoot, tool_input: { command: "node .harness/setup.mjs" } }, {
    FHF_HARNESS_CONFIG: smokeConfigPath,
  }), 0);
expect("context read guard applies a lower overlay budget",
  run("context-read-guard.mjs", { tool_name: "Read", tool_input: { file_path: largeRead, limit: 80 } }, {
    FHF_HARNESS_CONFIG: customConfigPath,
    FHF_HARNESS_OVERLAY: validOverlay,
  }), 2);
expect("block-forbidden-skills blocks a skill absent from the allowlist",
  run("block-forbidden-skills.mjs", { tool_input: { skill: "cypress-cloud-cli" } }), 2);
expect("block-forbidden-skills allows an allowlisted skill",
  run("block-forbidden-skills.mjs", { tool_input: { skill: "cypress-explain" } }), 0);
expect("block-forbidden-skills allows backend-test-author",
  run("block-forbidden-skills.mjs", { tool_input: { skill: "backend-test-author" } }), 0);
expect("block-forbidden-skills allows cypress-tap",
  run("block-forbidden-skills.mjs", { tool_input: { skill: "cypress-tap" } }), 0);
expect("block-forbidden-skills allows cypress-author",
  run("block-forbidden-skills.mjs", { tool_input: { skill: "cypress-author" } }), 0);
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

// -- falseGreen enforcement: the four declared booleans now bite -----------------------
// Before this, qualityAssurance.falseGreen declared the policy and nothing enforced it.
// Density needs the whole file, so this is the post-write validator, not pre-validate.
const fgHead = "describe(" + JSON.stringify("x") + ", { testIsolation: true }, () => { beforeEach(() => cy.ensureAuthenticated());";
const noAssertSpec = path.join(specDir, "no-assert.cy.js");
writeFileSync(noAssertSpec, fgHead + " it(" + JSON.stringify("a") + ", () => { cy.visit(" + JSON.stringify("/x") + "); }); });");
expect("validate-cypress-rules flags an it() block with no assertion",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: noAssertSpec } }), 2);
const skipSpec = path.join(specDir, "skipped.cy.js");
writeFileSync(skipSpec, fgHead + " it.skip(" + JSON.stringify("a") + ", () => { cy.get(" + JSON.stringify(".r") + ").should(" + JSON.stringify("exist") + "); }); });");
expect("validate-cypress-rules flags a skipped suite",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: skipSpec } }), 2);
const onlySpec = path.join(specDir, "only.cy.js");
writeFileSync(onlySpec, fgHead + " it.only(" + JSON.stringify("a") + ", () => { cy.get(" + JSON.stringify(".r") + ").should(" + JSON.stringify("exist") + "); }); });");
expect("validate-cypress-rules flags .only",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: onlySpec } }), 2);
const swallowSpec = path.join(specDir, "swallow.cy.js");
writeFileSync(swallowSpec, fgHead + " it(" + JSON.stringify("a") + ", () => { try { cy.get(" + JSON.stringify(".r") + ").should(" + JSON.stringify("exist") + "); } catch (e) {} }); });");
expect("validate-cypress-rules flags an empty catch block",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: swallowSpec } }), 2);
const goodFgSpec = path.join(specDir, "good-fg.cy.js");
writeFileSync(goodFgSpec, fgHead + " it(" + JSON.stringify("a") + ", () => { cy.get(" + JSON.stringify(".r") + ").should(" + JSON.stringify("be.visible") + "); }); });");
// An asserting spec raises no false-green violation. Asserted on the message rather than the
// exit code: this fixture still trips the pre-existing tag-taxonomy rules, which is unrelated.
expect("validate-cypress-rules raises no false-green violation for an asserting spec",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: goodFgSpec } }),
  (r) => !/no assertion|below the configured|skipped suite|empty catch/.test(r.stderr));
expect("validate-cypress-rules passes clean spec",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: goodSpec } }), 0);
expect("validate-cypress-rules enforces the configured tag taxonomy",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: untaggedSpec } }), 2);
expect("validate-cypress-rules blocks raw intercepts in specs",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: directInterceptSpec } }), 2);
expect("validate-cypress-rules blocks literal routes in specs",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: literalRouteSpec } }), 2);
expect("validate-cypress-rules exempts a pure re-export barrel from the freeze rule",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: barrelConfig } }), 0);
expect("validate-cypress-rules still requires freeze when a barrel also declares an object",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: unfrozenConfig } }), 2);
expect("validate-cypress-rules allows a smoke spec at the critical cap",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: smokeLoadSpec } }), 0);
expect("validate-cypress-rules blocks more than three @critical tags on a smoke spec",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: smokeOverCapSpec } }), 2);
expect("validate-cypress-rules blocks quarantine without a ticket and date",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: smokeQuarantineSpec } }), 2);
expect("scenario-content-guard flags missing fields with exit 2",
  run("scenario-content-guard.mjs", { tool_input: { file_path: "cypress/configs/scenarios/x.scenarios.js", content: "export const scenarios = [{}]" } }), 2);
expect("coverage-strategy-guard flags visit-before-intercept with exit 2",
  run("coverage-strategy-guard.mjs", { tool_input: { file_path: "cypress/tests/a.cy.js", content: "cy.visit('/x'); cy.intercept('GET','/api');" } }), 2);
expect("validate-backend-automation passes a selected helper-based pytest test",
  run("validate-backend-automation.mjs", {
    cwd: backendRoot,
    tool_input: { file_path: backendTestPath },
  }, activeTaskEnv), 0);
expect("validate-backend-automation blocks raw assert in backend tests",
  run("validate-backend-automation.mjs", {
    cwd: backendRoot,
    tool_input: { file_path: backendBadTestPath },
  }, activeTaskEnv), 2);

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
expect("prompt-router routes backend automation generation to the cross-layer specialist",
  run("prompt-router.mjs", {
    cwd: backendRoot,
    prompt: "write a new test for the backend API",
  }),
  (r) => r.code === 0 && r.stdout.includes("[router:backend-test]") && r.stdout.includes("qa-automation-generator"));
expect("prompt-router routes combined frontend and backend generation to one specialist",
  run("prompt-router.mjs", {
    prompt: "generate frontend Cypress and backend API pytest automation for this ticket",
  }),
  (r) => r.code === 0 && r.stdout.includes("[router:cross-layer-test-generation]") && r.stdout.includes("qa-automation-generator"));
const externalBackendHandoff = path.join(tmp, "fhf-backend-automation", "cypress", "handoff", "session-latest.json");
expect("prompt-router does not write a handoff in the external backend",
  run("prompt-router.mjs", {
    cwd: path.join(tmp, "fhf-backend-automation"),
    prompt: "Work the selected API using /api/backend",
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

recordCapabilityOutcome({ id: "jira-ticket-read", subject: "SERV-12345", root: tmp, config: loadHarnessConfig(), outcome: "ready" });
const memoryPrompt = run("prompt-router.mjs", {
  session_id: "memory-session",
  prompt: "Work SERV-12345 in insurance.cy.js using [data-cy=\"save-button\"] and /api/insurance; keep docs/evidence/run.json",
}, { CLAUDE_CWD: tmp, FHF_JIRA_MCP: "true" });
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


// ── protect-harness-governance: the gates are not agent-writable ──────────────────────
// Regression for the hole this hook was written to close: before it, all four Edit|Write
// guards returned 0 for every one of these paths.
expect("governance guard blocks a control-plane write",
  run("protect-harness-governance.mjs", { tool_input: { file_path: `${HARNESS_ROOT}/config/qa-control-plane.json` } }), 2);
expect("governance guard blocks a hook-source write",
  run("protect-harness-governance.mjs", { tool_input: { file_path: `${HARNESS_ROOT}/.claude/hooks/validate-cypress-rules.mjs` } }), 2);
expect("governance guard blocks a generated-settings write",
  run("protect-harness-governance.mjs", { tool_input: { file_path: `${HARNESS_ROOT}/.claude/settings.json` } }), 2);
expect("governance guard blocks a consumer projection write too",
  run("protect-harness-governance.mjs", { tool_input: { file_path: "C:/x/front-end-automation-smoke/.claude/hooks/failure-loop-guard.mjs" } }), 2);
expect("governance guard allows an ordinary spec write",
  run("protect-harness-governance.mjs", { tool_input: { file_path: "C:/x/CypressFHF/fhf-dashboards/cypress/tests/a.cy.js" } }), 0);
expect("governance guard allows a rules write (prompt layer, not a gate)",
  run("protect-harness-governance.mjs", { tool_input: { file_path: `${HARNESS_ROOT}/.claude/rules/assertions.md` } }), 0);
expect("governance guard yields to the owner opt-in",
  run("protect-harness-governance.mjs",
    { tool_input: { file_path: `${HARNESS_ROOT}/config/qa-control-plane.json` } },
    { FHF_ALLOW_HARNESS_EDIT: "1" }), 0);
expect("governance guard blocks an in-place shell rewrite of a gate",
  run("protect-harness-governance.mjs",
    { tool_name: "Bash", tool_input: { command: "sed -i s/0.8/0.1/ config/qa-control-plane.json" } }), 2);
expect("governance guard blocks a redirect over a gate",
  run("protect-harness-governance.mjs",
    { tool_name: "Bash", tool_input: { command: "echo {} > .claude/settings.json" } }), 2);
expect("governance guard blocks an interpreter pointed at a gate",
  run("protect-harness-governance.mjs",
    { tool_name: "Bash", tool_input: { command: "node -e \"require('fs').writeFileSync('config/qa-control-plane.json','{}')\"" } }), 2);
expect("governance guard allows reading a gate",
  run("protect-harness-governance.mjs",
    { tool_name: "Bash", tool_input: { command: "cat config/qa-control-plane.json" } }), 0);
expect("governance guard accepts the inline shell opt-in",
  run("protect-harness-governance.mjs",
    { tool_name: "Bash", tool_input: { command: "FHF_ALLOW_HARNESS_EDIT=1 sed -i s/a/b/ config/qa-control-plane.json" } }), 0);

// ── verify-subagent-citations: a summary must cite locations that exist ────────────────
expect("citation verifier blocks an unresolvable file",
  run("verify-subagent-citations.mjs",
    { cwd: HARNESS_ROOT, tool_response: "Fixed it in scripts/harness/does-not-exist.mjs:12 as described." }), 2);
expect("citation verifier blocks a line past end of file",
  run("verify-subagent-citations.mjs",
    { cwd: HARNESS_ROOT, tool_response: "See config/qa-control-plane.json:9999999 for the threshold." }), 2);
expect("citation verifier allows a citation that resolves",
  run("verify-subagent-citations.mjs",
    { cwd: HARNESS_ROOT, tool_response: "The list is in config/qa-control-plane.json:1 and it is correct." }), 0);
expect("citation verifier allows prose with no citations",
  run("verify-subagent-citations.mjs",
    { cwd: HARNESS_ROOT, tool_response: "I reviewed the branch and found nothing to change." }), 0);
expect("citation verifier ignores a timestamp",
  run("verify-subagent-citations.mjs",
    { cwd: HARNESS_ROOT, tool_response: "The run started at 10:30 and finished at 11:05." }), 0);
expect("citation verifier ignores a ticket reference",
  run("verify-subagent-citations.mjs",
    { cwd: HARNESS_ROOT, tool_response: "Tracked as SERV-12053:1 in the backlog." }), 0);
expect("citation verifier allows an unrecognised payload shape",
  run("verify-subagent-citations.mjs", { cwd: HARNESS_ROOT, unexpected_field: "nope" }), 0);

rmSync(tmp, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${failures.length} hook self-test failure(s):`);
  failures.forEach((f) => console.error("  " + f));
  process.exit(1);
}
console.log("\nAll hook self-tests passed.");
