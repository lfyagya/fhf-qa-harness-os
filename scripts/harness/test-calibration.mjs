import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { serializeTrace } from "./runtime-state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "qa-control-plane.json"), "utf8"));
const script = path.join(ROOT, "scripts", "harness", "calibrate-gate.mjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fhf-calibration-"));

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

try {
  const trace = path.join(temp, "loop-trace.jsonl");
  const output = path.join(temp, "gate-calibration.json");
  const event = serializeTrace({
    runId: "calibration-run",
    goal: "calibrate a gate verdict",
    type: "gate_verdict",
    repairCycle: 0,
    verdict: "BLOCK",
    judgePass: false,
    judgeScore: 0.25,
    status: "in_progress",
  }, config);
  fs.writeFileSync(trace, `${JSON.stringify(event)}\n`, "utf8");

  const collected = run(["collect", "--trace", trace, "--output", output]);
  assert.equal(collected.status, 0, collected.stderr);
  const pending = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(pending.status, "needs-human-labels");
  assert.equal(pending.cases.length, 1);
  assert.equal(pending.cases[0].humanPass, null);

  const id = pending.cases[0].id;
  const labeled = run([
    "label",
    "--file", output,
    "--id", id,
    "--human-pass", "fail",
    "--human-score", "0",
    "--reviewer", "test-reviewer",
    "--rationale", "Fixture intentionally represents a blocking result.",
  ]);
  assert.equal(labeled.status, 0, labeled.stderr);
  const complete = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(complete.status, "calibrated");
  assert.equal(complete.cases[0].humanPass, false);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log("calibration workflow tests passed");
