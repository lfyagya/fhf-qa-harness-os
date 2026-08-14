import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseTraceLines, repairOutcomesFromTrace } from "./evals/runtime-evidence.mjs";
import { serializeTrace } from "./runtime-state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "qa-control-plane.json"), "utf8"));

function trace(event) {
  return serializeTrace(event, config);
}

const events = [
  trace({ runId: "repair-pass", goal: "repair a failing spec", type: "gate_verdict", repairCycle: 0, verdict: "BLOCK", judgePass: false, judgeScore: 0.25, status: "in_progress" }),
  trace({ runId: "repair-pass", goal: "repair a failing spec", type: "repair_started", repairCycle: 1, status: "in_progress" }),
  trace({ runId: "repair-pass", goal: "repair a failing spec", type: "repair_completed", repairCycle: 1, progress: true, status: "in_progress" }),
  trace({ runId: "repair-pass", goal: "repair a failing spec", type: "gate_verdict", repairCycle: 1, verdict: "PASS", judgePass: true, judgeScore: 1, status: "completed" }),
  trace({ runId: "repair-escalated", goal: "repair an unsafe spec", type: "gate_verdict", repairCycle: 0, verdict: "BLOCK", judgePass: false, judgeScore: 0.1, status: "in_progress" }),
  trace({ runId: "repair-escalated", goal: "repair an unsafe spec", type: "repair_started", repairCycle: 1, status: "in_progress" }),
  trace({ runId: "repair-escalated", goal: "repair an unsafe spec", type: "loop_escalated", repairCycle: 1, status: "escalated" }),
];

const parsed = parseTraceLines(events.map((event) => JSON.stringify(event)).join("\n"), "fixture-trace");
assert.deepEqual(parsed.errors, []);
const outcomes = repairOutcomesFromTrace(parsed.events);
assert.equal(outcomes.length, 2);
assert.equal(outcomes.find((outcome) => outcome.runId === "repair-pass").converged, true);
assert.equal(outcomes.find((outcome) => outcome.runId === "repair-escalated").converged, false);
assert.equal(outcomes.find((outcome) => outcome.runId === "repair-pass").repairCycles, 1);

const malformed = parseTraceLines("{bad json}\n", "broken-trace");
assert.equal(malformed.events.length, 0);
assert.equal(malformed.errors.length, 1);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fhf-evidence-eval-"));
try {
  const file = path.join(temp, "loop-trace.jsonl");
  fs.writeFileSync(file, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  assert.equal(fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).length, events.length);
  const evaluation = spawnSync(process.execPath, [path.join(ROOT, "scripts", "harness", "eval-harness.mjs"), "--trace", file], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(evaluation.status, 1);
  assert.equal(`${evaluation.stdout}\n${evaluation.stderr}`.includes("Repair convergence: 50.0%"), true);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log("evaluation evidence tests passed");
