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
import { resolveActiveTask } from "./task-protocol-lib.mjs";

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

function activeExecutionBudget() {
  const policy = config.engineering?.taskProtocol?.executionBudget;
  const manifestFile = resolveActiveTask({ root: ROOT, config }).file;
  if (!manifestFile) return null;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.resolve(manifestFile), "utf8"));
  } catch (error) {
    throw new Error(`Cannot read active task manifest for execution budget: ${error.message}`);
  }
  const budget = manifest.plan?.executionBudget;
  if (!budget || typeof budget !== "object" || Array.isArray(budget)) {
    throw new Error(`${policy?.manifestPath ?? "plan.executionBudget"} is required for an active task`);
  }
  for (const field of policy?.requiredFields ?? []) {
    const value = budget[field];
    const ceiling = policy?.hardCeilings?.[field];
    if (!Number.isInteger(value) || value < 1 || !Number.isInteger(ceiling) || value > ceiling) {
      throw new Error(`Active task execution budget ${field} is invalid or exceeds its hard ceiling`);
    }
  }
  return budget;
}

function budgetExceeded(state) {
  const budget = state.executionBudget;
  if (!budget) return null;
  if (state.recordedToolResults > budget.maxRecordedToolResults) {
    return { field: "maxRecordedToolResults", limit: budget.maxRecordedToolResults, actual: state.recordedToolResults };
  }
  if (state.retryableFailures > budget.maxRetryableFailures) {
    return { field: "maxRetryableFailures", limit: budget.maxRetryableFailures, actual: state.retryableFailures };
  }
  const startedAt = Date.parse(state.createdAt);
  const elapsedMinutes = Number.isFinite(startedAt) ? (Date.now() - startedAt) / 60000 : null;
  if (elapsedMinutes !== null && elapsedMinutes > budget.maxWallClockMinutes) {
    return { field: "maxWallClockMinutes", limit: budget.maxWallClockMinutes, actual: elapsedMinutes };
  }
  return null;
}

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

// One generic phase pair rather than a started/completed pair per agent: the
// phase is data in a validated field, so adding a roster agent does not widen
// this allowlist. Deliberately NOT reusing repair_started/repair_completed for
// non-repair work — repairOutcomesFromTrace derives repair convergence from
// those two types, so labelling a first-pass generation a repair would corrupt
// the metric the instrumentation exists to make trustworthy.
const traceTypes = new Set([
  "loop_started",
  "gate_verdict",
  "repair_started",
  "repair_completed",
  "phase_started",
  "phase_completed",
  "loop_completed",
  "loop_escalated",
  "progress",
  "tool_result",
]);
if (!traceTypes.has(event.type)) {
  console.error(`Unsupported loop event type: ${event.type}`);
  process.exit(2);
}
const configuredPhases = config.engineering?.loops?.phases ?? [];
if (event.type === "phase_started" || event.type === "phase_completed") {
  if (!configuredPhases.includes(event.phase)) {
    console.error(`${event.type} requires phase from: ${configuredPhases.join(", ") || "engineering.loops.phases"}`);
    process.exit(2);
  }
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
const executionBudget = activeExecutionBudget();
if (previous && previous.runId !== event.runId) {
  console.error(`Loop state belongs to ${previous.runId}, not ${event.runId}. Start a new runtime workspace.`);
  process.exit(2);
}
if (previous && JSON.stringify(previous.executionBudget ?? null) !== JSON.stringify(executionBudget)) {
  console.error("Active task execution budget differs from the persisted loop state.");
  process.exit(2);
}
const retryableFailure = Boolean(event.failure && typeof event.failure === "object" && event.failure.retryable === true);
let state = previous
  ? updateLoopState(previous, {
      stepCount: event.stepCount ?? previous.stepCount,
      currentStep: event.currentStep ?? previous.currentStep,
      lastProgressAt: event.progress ? event.stepCount ?? previous.stepCount : previous.lastProgressAt,
      status: event.status ?? previous.status,
      repairCycles: event.repairCycle ?? previous.repairCycles,
      failures: event.failure ? [...previous.failures, event.failure] : previous.failures,
      artifacts: event.artifact ? { ...previous.artifacts, [event.artifact.name]: event.artifact.path } : previous.artifacts,
      verdicts: event.verdict ? [...previous.verdicts, event.verdict] : previous.verdicts,
      recordedToolResults: previous.recordedToolResults + (event.type === "tool_result" ? 1 : 0),
      retryableFailures: previous.retryableFailures + (retryableFailure ? 1 : 0),
    }, config)
  : createLoopState({ goal: event.goal, runId: event.runId, lane, config, executionBudget });

if (!previous && (event.type === "tool_result" || retryableFailure)) {
  state = updateLoopState(state, {
    recordedToolResults: state.recordedToolResults + (event.type === "tool_result" ? 1 : 0),
    retryableFailures: state.retryableFailures + (retryableFailure ? 1 : 0),
  }, config);
}

const exceeded = budgetExceeded(state);
if (exceeded) {
  state = updateLoopState(state, {
    status: "blocked",
    failures: [...state.failures, { category: "budget", ...exceeded }],
  }, config);
  writeRuntimeArtifact(stateFile, state);
  appendTrace(traceFile, { ...event, executionBudget: state.executionBudget }, config);
  appendTrace(traceFile, {
    runId: event.runId,
    goal: event.goal,
    lane,
    type: "budget_exceeded",
    status: "blocked",
    executionBudget: state.executionBudget,
    exceeded,
  }, config);
  console.error(`Execution budget exceeded: ${exceeded.field} (${exceeded.actual}/${exceeded.limit})`);
  process.exit(1);
}

writeRuntimeArtifact(stateFile, state);
appendTrace(traceFile, { ...event, executionBudget: state.executionBudget }, config);

// Memory at phase boundaries. The PreCompact/SessionEnd checkpoint fires after
// compaction has already discarded the within-session channel, so a completion
// event is the moment actually worth capturing. Resolved by probe, matching
// loadConfig above, so the projected .harness/ copy works from its own root.
// A memory failure must never cost the trace write, hence the try/catch and the
// ordering after writeRuntimeArtifact/appendTrace.
const COMPLETION_TYPES = new Set(["phase_completed", "repair_completed", "loop_completed"]);
if (COMPLETION_TYPES.has(event.type)) {
  const memory = config.engineering?.memory;
  const lib = path.join(ROOT, ".claude", "hooks", "lib", "memory-state.mjs");
  if (memory?.handoffFile && fs.existsSync(lib)) {
    try {
      const { extractFacts, mergeHandoff } = await import(pathToFileURL(lib).href);
      const observed = [
        event.goal,
        event.findings,
        event.currentStep,
        ...(Array.isArray(event.artifacts) ? event.artifacts : []),
        event.artifact?.path,
      ].filter(Boolean).join("\n");
      mergeHandoff({ cwd: ROOT }, memory, {
        checkpointAt: new Date().toISOString(),
        checkpointReason: `${event.type}:${event.phase ?? "loop"}`,
        runId: event.runId,
        lane,
        status: state.status,
        repairCycles: state.repairCycles,
        facts: extractFacts(observed, memory),
      });
    } catch (error) {
      console.error(`Phase checkpoint skipped: ${error.message}`);
    }
  }
}
console.log(`Recorded ${event.type} for ${event.runId}`);
