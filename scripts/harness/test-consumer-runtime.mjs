import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  HARNESS_CONFIG_TEXT,
  PORTABLE_RUNTIME_STATE_TEXT,
  RECORD_LOOP_EVENT_TEXT,
} from "./loader-templates.mjs";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fhf-consumer-runtime-"));

try {
  const harnessDir = path.join(temp, ".harness");
  const claudeDir = path.join(temp, ".claude");
  fs.mkdirSync(harnessDir, { recursive: true });
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(harnessDir, "portable-runtime-state.mjs"), PORTABLE_RUNTIME_STATE_TEXT, "utf8");
  fs.writeFileSync(path.join(harnessDir, "record-loop-event.mjs"), RECORD_LOOP_EVENT_TEXT, "utf8");
  fs.writeFileSync(path.join(claudeDir, "harness.config.json"), HARNESS_CONFIG_TEXT, "utf8");

  const recorder = path.join(harnessDir, "record-loop-event.mjs");
  const started = spawnSync(process.execPath, [recorder, JSON.stringify({
    runId: "consumer-run",
    goal: "consumer recorder contract",
    type: "loop_started",
    lane: "e2e",
    repairCycle: 0,
    status: "in_progress",
  })], { cwd: temp, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: temp } });
  assert.equal(started.status, 0, started.stderr);

  const verdict = spawnSync(process.execPath, [recorder, JSON.stringify({
    runId: "consumer-run",
    goal: "consumer recorder contract",
    type: "gate_verdict",
    lane: "e2e",
    repairCycle: 0,
    verdict: "PASS",
    judgePass: true,
    judgeScore: 1,
    status: "completed",
  })], { cwd: temp, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: temp } });
  assert.equal(verdict.status, 0, verdict.stderr);

  const state = JSON.parse(fs.readFileSync(path.join(temp, "cypress", "handoff", "loop-state.json"), "utf8"));
  const trace = fs.readFileSync(path.join(temp, "cypress", "handoff", "loop-trace.jsonl"), "utf8").trim().split(/\r?\n/);
  assert.equal(state.runId, "consumer-run");
  assert.equal(trace.length, 2);
  assert.equal(JSON.parse(trace[1]).schema, "fhf-harness/trace/v1");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log("consumer runtime recorder tests passed");
