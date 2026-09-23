import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  HARNESS_CONFIG_TEXT,
  PORTABLE_RUNTIME_STATE_TEXT,
  RECORD_LOOP_EVENT_TEXT,
  TASK_PROTOCOL_LIB_TEXT,
} from "./loader-templates.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fhf-consumer-runtime-"));

try {
  const harnessDir = path.join(temp, ".harness");
  const claudeDir = path.join(temp, ".claude");
  fs.mkdirSync(harnessDir, { recursive: true });
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(harnessDir, "portable-runtime-state.mjs"), PORTABLE_RUNTIME_STATE_TEXT, "utf8");
  fs.writeFileSync(path.join(harnessDir, "record-loop-event.mjs"), RECORD_LOOP_EVENT_TEXT, "utf8");
  fs.writeFileSync(path.join(harnessDir, "task-protocol-lib.mjs"), TASK_PROTOCOL_LIB_TEXT, "utf8");
  fs.writeFileSync(path.join(claudeDir, "harness.config.json"), HARNESS_CONFIG_TEXT, "utf8");
  const taskDir = path.join(harnessDir, "tasks");
  fs.mkdirSync(taskDir, { recursive: true });
  const taskFile = path.join(taskDir, "consumer-run.json");
  fs.writeFileSync(taskFile, JSON.stringify({
    plan: { executionBudget: { maxWallClockMinutes: 60, maxRecordedToolResults: 1, maxRetryableFailures: 1 } },
  }), "utf8");

  const recorder = path.join(harnessDir, "record-loop-event.mjs");
  const started = spawnSync(process.execPath, [recorder, JSON.stringify({
    runId: "consumer-run",
    goal: "consumer recorder contract",
    type: "loop_started",
    lane: "e2e",
    repairCycle: 0,
    status: "in_progress",
  })], { cwd: temp, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: temp, FHF_ACTIVE_TASK: taskFile } });
  assert.equal(started.status, 0, started.stderr);

  const firstToolResult = spawnSync(process.execPath, [recorder, JSON.stringify({
    runId: "consumer-run",
    goal: "consumer recorder contract",
    type: "tool_result",
    lane: "e2e",
    repairCycle: 0,
    tool: "test-runner",
    status: "in_progress",
  })], { cwd: temp, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: temp, FHF_ACTIVE_TASK: taskFile } });
  assert.equal(firstToolResult.status, 0, firstToolResult.stderr);

  const budgetExceeded = spawnSync(process.execPath, [recorder, JSON.stringify({
    runId: "consumer-run",
    goal: "consumer recorder contract",
    type: "tool_result",
    lane: "e2e",
    repairCycle: 0,
    tool: "test-runner",
    status: "in_progress",
  })], { cwd: temp, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: temp, FHF_ACTIVE_TASK: taskFile } });
  assert.equal(budgetExceeded.status, 1, budgetExceeded.stderr);

  const state = JSON.parse(fs.readFileSync(path.join(temp, "cypress", "handoff", "loop-state.json"), "utf8"));
  const trace = fs.readFileSync(path.join(temp, "cypress", "handoff", "loop-trace.jsonl"), "utf8").trim().split(/\r?\n/);
  assert.equal(state.runId, "consumer-run");
  assert.equal(state.executionBudget.maxRecordedToolResults, 1);
  assert.equal(state.status, "blocked");
  assert.equal(state.recordedToolResults, 2);
  assert.equal(trace.length, 4);
  assert.equal(JSON.parse(trace[0]).executionBudget.maxRecordedToolResults, 1);
  assert.equal(JSON.parse(trace[2]).schema, "fhf-harness/trace/v1");
  assert.equal(JSON.parse(trace[3]).type, "budget_exceeded");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

// Phase events and the phase-boundary memory checkpoint. Separate workspace: the
// run above deliberately exhausts its budget and ends "blocked", which would
// reject any further event.
const phaseTemp = fs.mkdtempSync(path.join(os.tmpdir(), "fhf-phase-runtime-"));
try {
  const harnessDir = path.join(phaseTemp, ".harness");
  const libDir = path.join(phaseTemp, ".claude", "hooks", "lib");
  fs.mkdirSync(harnessDir, { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });
  fs.writeFileSync(path.join(harnessDir, "portable-runtime-state.mjs"), PORTABLE_RUNTIME_STATE_TEXT, "utf8");
  fs.writeFileSync(path.join(harnessDir, "record-loop-event.mjs"), RECORD_LOOP_EVENT_TEXT, "utf8");
  fs.writeFileSync(path.join(harnessDir, "task-protocol-lib.mjs"), TASK_PROTOCOL_LIB_TEXT, "utf8");
  fs.writeFileSync(path.join(phaseTemp, ".claude", "harness.config.json"), HARNESS_CONFIG_TEXT, "utf8");
  // The recorder resolves the memory library by probe, so the real canonical
  // files are copied in rather than stubbed.
  const canonicalLib = path.join(ROOT, ".claude", "hooks", "lib");
  for (const file of ["memory-state.mjs", "harness-config.mjs"]) {
    fs.copyFileSync(path.join(canonicalLib, file), path.join(libDir, file));
  }

  const recorder = path.join(harnessDir, "record-loop-event.mjs");
  const record = (event) => spawnSync(process.execPath, [recorder, JSON.stringify(event)], {
    cwd: phaseTemp,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: phaseTemp },
  });

  const base = { runId: "phase-run", goal: "phase instrumentation contract", lane: "e2e" };
  assert.equal(record({ ...base, type: "loop_started", repairCycle: 0, status: "in_progress" }).status, 0);

  const unknownPhase = record({ ...base, type: "phase_started", phase: "not-a-phase", status: "in_progress" });
  assert.equal(unknownPhase.status, 2, "an unconfigured phase must be rejected");
  assert.match(unknownPhase.stderr, /requires phase from/);

  assert.equal(record({ ...base, type: "phase_started", phase: "generation", status: "in_progress" }).status, 0);
  const completed = record({
    ...base,
    type: "phase_completed",
    phase: "generation",
    progress: true,
    status: "in_progress",
    findings: "SERV-12053 covered by cypress/tests/titles/remarketing-titles.cy.js using [data-cy=\"loan-number\"]",
    artifacts: ["docs/evidence/coverage-computed.json"],
  });
  assert.equal(completed.status, 0, completed.stderr);

  const handoff = JSON.parse(fs.readFileSync(path.join(phaseTemp, "cypress", "handoff", "session-latest.json"), "utf8"));
  assert.equal(handoff.runId, "phase-run");
  assert.equal(handoff.checkpointReason, "phase_completed:generation");
  // Facts come from the configured extractors, so a phase boundary preserves the
  // identifiers a later session would otherwise have to rediscover.
  assert.deepEqual(handoff.facts["ticket-ids"], ["SERV-12053"]);
  assert.ok(handoff.facts.selectors?.length, "selectors must survive the phase checkpoint");
  assert.ok(handoff.facts["evidence-paths"]?.length, "evidence paths must survive the phase checkpoint");

  const phaseTrace = fs.readFileSync(path.join(phaseTemp, "cypress", "handoff", "loop-trace.jsonl"), "utf8")
    .trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.deepEqual(phaseTrace.map((event) => event.type), ["loop_started", "phase_started", "phase_completed"]);
  assert.equal(phaseTrace.at(-1).phase, "generation");
} finally {
  fs.rmSync(phaseTemp, { recursive: true, force: true });
}

console.log("consumer runtime recorder tests passed");
