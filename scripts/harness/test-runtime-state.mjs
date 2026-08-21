import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendTrace,
  createLoopState,
  serializeTrace,
  updateLoopState,
  writeRuntimeArtifact,
} from "./runtime-state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "qa-control-plane.json"), "utf8"));
const overlay = {
  version: config.engineering.context.runtimeOverlay.version,
  session: { ticket: "SERV-123", reason: "runtime test" },
  loops: { sameFailureLimit: 1 },
};
const effective = structuredClone(config);
effective.runtimeOverlay = overlay;
effective.engineering.loops.sameFailureLimit = 1;

const executionBudget = { maxWallClockMinutes: 60, maxRecordedToolResults: 30, maxRetryableFailures: 2 };
const state = createLoopState({ goal: "verify runtime contracts", runId: "run-1", lane: "e2e", config: effective, executionBudget });
assert.equal(state.schema, "fhf-harness/loop-state/v1");
assert.equal(state.overlay.session.ticket, "SERV-123");
assert.equal(state.baseConfigFingerprint.startsWith("sha256:"), true);
assert.deepEqual(state.executionBudget, executionBudget);
assert.equal(state.recordedToolResults, 0);
const progressed = updateLoopState(state, { stepCount: 1, lastProgressAt: 1, currentStep: "verify" }, effective);
assert.equal(progressed.lastProgressAt, 1);
assert.throws(() => updateLoopState(progressed, { repairCycles: progressed.budgets.gateRepairLimit + 1 }, effective));

const trace = serializeTrace({
  runId: "run-1",
  type: "tool_result",
  message: "token=secret@example.com",
}, effective);
assert.equal(trace.message, "[REDACTED]");
assert.equal(trace.configFingerprint.startsWith("sha256:"), true);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fhf-runtime-state-"));
try {
  const stateFile = path.join(temp, "loop-state.json");
  const traceFile = path.join(temp, "loop-trace.jsonl");
  writeRuntimeArtifact(stateFile, progressed);
  appendTrace(traceFile, { runId: "run-1", type: "progress", progress: true }, effective);
  assert.equal(JSON.parse(fs.readFileSync(stateFile, "utf8")).runId, "run-1");
  assert.equal(fs.readFileSync(traceFile, "utf8").trim().split(/\r?\n/).length, 1);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log("runtime state tests passed");
