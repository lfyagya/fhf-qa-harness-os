#!/usr/bin/env node
// Hook self-test — pipes fixture payloads through every hook and asserts exit codes.
// The harness must test itself: a hook with the wrong exit code silently talks to nobody.
// Run: node scripts/harness/test-hooks.mjs   (CI runs it next to check-loader-drift.mjs)
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".claude", "hooks");
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

function expect(name, actual, wanted, extra = "") {
  const ok = typeof wanted === "function" ? wanted(actual) : actual.code === wanted;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures.push(`${name} — got exit ${actual.code} ${extra}\n  stdout: ${actual.stdout.trim()}\n  stderr: ${actual.stderr.trim()}`);
}

function cursorAllows(result) {
  try {
    return result.code === 0 && JSON.parse(result.stdout).permission === "allow";
  } catch {
    return false;
  }
}

// Fixture spec files on disk (validate-cypress-rules reads the file, not the payload)
const tmp = mkdtempSync(path.join(tmpdir(), "hook-test-"));
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

// PreToolUse — blockers (exit 2)
expect("protect-app-source blocks fhf-dashboards/src write",
  run("protect-app-source.mjs", { tool_input: { file_path: "C:/Users/Leapfrog/FHF/fhf-dashboards/src/App.tsx" } }), 2);
expect("protect-app-source allows CypressFHF package write",
  run("protect-app-source.mjs", { tool_input: { file_path: "C:/x/CypressFHF/fhf-dashboards/cypress/tests/a.cy.js" } }), 0);
expect("protect-app-source emits Cursor allow JSON",
  run("protect-app-source.mjs", { input: { path: "C:/x/cypress/tests/a.cy.js" } }, {}, ["--cursor"]), cursorAllows);
expect("protect-app-source blocks ApplyPatch payload",
  run("protect-app-source.mjs", { tool_input: { patch: "*** Update File: C:/x/fhf-dashboards/src/App.tsx\n@@\n-old\n+new" } }), 2);
expect("protect-second-brain blocks stray wiki scaffolding",
  run("protect-second-brain-boundary.mjs", { input: { path: "C:/Users/Leapfrog/FHF/wiki/index.md" } }), 2);
expect("protect-second-brain allows the sibling vault",
  run("protect-second-brain-boundary.mjs", { input: { path: "C:/Users/Leapfrog/FHF/claude-obsidian/wiki/index.md" } }), 0);
expect("protect-second-brain emits Cursor allow JSON",
  run("protect-second-brain-boundary.mjs", { input: { path: "C:/x/cypress/tests/a.cy.js" } }, {}, ["--cursor"]), cursorAllows);
expect("pre-validate blocks cy.wait(number) before write",
  run("pre-validate-cypress-rules.mjs", { tool_input: { file_path: "cypress/tests/a.cy.js", content: "cy.wait(3000);" } }), 2);
expect("pre-validate blocks cy.wait(number) in ApplyPatch payload",
  run("pre-validate-cypress-rules.mjs", { input: { patch: "*** Update File: cypress/tests/a.cy.js\n@@\n-old\n+cy.wait(3000);" } }), 2);
expect("pre-validate blocks mutation in smoke",
  run("pre-validate-cypress-rules.mjs", { tool_input: { file_path: "cypress/tests/smoke/a.cy.js", content: "cy.request({ method: 'POST' }); .post(" } }), 2);
expect("pre-validate emits Cursor allow JSON",
  run("pre-validate-cypress-rules.mjs", { input: { path: "cypress/tests/a.cy.js", content: "cy.apiWait('@a');" } }, {}, ["--cursor"]), cursorAllows);
expect("manual-task-guard blocks force push",
  run("manual-task-guard.mjs", { tool_input: { command: "git push --force origin main" } }), 2);
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

// PostToolUse — validators must exit 2 (exit 1 would be invisible to Claude)
expect("validate-cypress-rules flags bad spec with exit 2",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: badSpec } }), 2);
expect("validate-cypress-rules passes clean spec",
  run("validate-cypress-rules.mjs", { tool_input: { file_path: goodSpec } }), 0);
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
expect("prompt-router doesn't fire Jira hint on meta-discussion that only mentions Jira",
  run("prompt-router.mjs", { prompt: "this harness turns jira tickets into cypress specs — is that the right layer for a compliance linter?" }),
  (r) => r.code === 0 && !r.stdout.includes("Jira ticket → spawn cypress-generator"));
expect("prompt-router silent on plain prompts",
  run("prompt-router.mjs", { prompt: "hello" }),
  (r) => r.code === 0 && r.stdout.trim() === "");

// Stop — sweep exits 0 when there are no repos/specs to check
expect("spec-sweep exits 0 with no git repos in CWD",
  run("spec-sweep-stop-hook.mjs", {}, { CLAUDE_CWD: tmp }), 0);
expect("session-end-reminder always exits 0",
  run("session-end-reminder.mjs", {}), 0);

rmSync(tmp, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${failures.length} hook self-test failure(s):`);
  failures.forEach((f) => console.error("  " + f));
  process.exit(1);
}
console.log("\nAll hook self-tests passed.");
