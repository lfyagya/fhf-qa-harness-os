#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  appendTrace,
  createLoopState,
  updateLoopState,
  writeRuntimeArtifact,
} from "./portable-runtime-state.mjs";

const ROOT = path.resolve(process.env.CLAUDE_PROJECT_DIR ?? process.env.CURSOR_PROJECT_DIR ?? process.cwd());

async function loadConfig() {
  const localLoader = path.join(ROOT, ".claude", "hooks", "lib", "harness-config.mjs");
  if (fs.existsSync(localLoader)) {
    return (await import(pathToFileURL(localLoader).href)).loadHarnessConfig();
  }
  const candidates = [
    process.env.FHF_HARNESS_CONFIG,
    path.join(ROOT, ".claude", "harness.config.json"),
    path.join(ROOT, "config", "qa-control-plane.json"),
  ].filter(Boolean).map((file) => path.resolve(file));
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error(`Harness config not found. Checked: ${candidates.join(", ")}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const config = await loadConfig();
const input = process.argv[2];
if (!input) {
  console.error("Usage: node record-loop-event.mjs '<json>'");
  process.exit(2);
}

let event;
try {
  event = JSON.parse(input);
} catch {
  console.error("Argument is not valid JSON.");
  process.exit(2);
}
if (!event.runId || !event.goal || !event.type) {
  console.error("Required fields: runId, goal, type");
  process.exit(2);
}

const traceTypes = new Set([
  "loop_started",
  "gate_verdict",
  "repair_started",
  "repair_completed",
  "loop_completed",
  "loop_escalated",
  "progress",
  "tool_result",
]);
if (!traceTypes.has(event.type)) {
  console.error(`Unsupported loop event type: ${event.type}`);
  process.exit(2);
}
if (event.repairCycle !== undefined && (!Number.isInteger(event.repairCycle) || event.repairCycle < 0)) {
  console.error("repairCycle must be a non-negative integer");
  process.exit(2);
}
if (event.type === "gate_verdict") {
  if (!["PASS", "PASS_WITH_ACTIONS", "BLOCK"].includes(event.verdict)) {
    console.error("gate_verdict requires verdict PASS, PASS_WITH_ACTIONS, or BLOCK");
    process.exit(2);
  }
  if (typeof event.judgePass !== "boolean") {
    console.error("gate_verdict requires boolean judgePass");
    process.exit(2);
  }
  if (!Number.isFinite(event.judgeScore) || event.judgeScore < 0 || event.judgeScore > 1) {
    console.error("gate_verdict requires judgeScore between 0 and 1");
    process.exit(2);
  }
}

const lane = event.lane ?? "root";
const runtime = config.engineering.context.runtime;
const stateFile = path.resolve(path.join(ROOT, runtime.stateFile));
const traceFile = path.resolve(path.join(ROOT, runtime.traceFile));
const previous = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : null;
if (previous && previous.runId !== event.runId) {
  console.error(`Loop state belongs to ${previous.runId}, not ${event.runId}. Start a new runtime workspace.`);
  process.exit(2);
}
const state = previous
  ? updateLoopState(previous, {
      stepCount: event.stepCount ?? previous.stepCount,
      currentStep: event.currentStep ?? previous.currentStep,
      lastProgressAt: event.progress ? event.stepCount ?? previous.stepCount : previous.lastProgressAt,
      status: event.status ?? previous.status,
      repairCycles: event.repairCycle ?? previous.repairCycles,
      failures: event.failure ? [...previous.failures, event.failure] : previous.failures,
      artifacts: event.artifact ? { ...previous.artifacts, [event.artifact.name]: event.artifact.path } : previous.artifacts,
      verdicts: event.verdict ? [...previous.verdicts, event.verdict] : previous.verdicts,
    }, config)
  : createLoopState({ goal: event.goal, runId: event.runId, lane, config });

writeRuntimeArtifact(stateFile, state);
appendTrace(traceFile, event, config);
console.log(`Recorded ${event.type} for ${event.runId}`);
