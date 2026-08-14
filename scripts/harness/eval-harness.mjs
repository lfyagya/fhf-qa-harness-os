#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  cohensKappa,
  passHatK,
  repairConvergenceRate,
  spearmanRho,
  wilsonInterval,
} from "./evals/reliability.mjs";
import { readTraceFile, repairOutcomesFromTrace } from "./evals/runtime-evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG_PATH = path.join(ROOT, "config", "qa-control-plane.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const evaluation = config.engineering.context.evaluation;
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, evaluation.goldenRoutes), "utf8"));
const failures = [];
const args = process.argv.slice(2);

function routeFromOutput(stdout) {
  const match = stdout.match(/\[router:([^\]]+)\]/);
  return match?.[1] ?? null;
}

function runRouter(prompt, env = {}) {
  return spawnSync(process.execPath, [path.join(ROOT, ".claude", "hooks", "prompt-router.mjs")], {
    cwd: ROOT,
    input: JSON.stringify({ prompt, cwd: ROOT }),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

function traceOptions() {
  return args.flatMap((value, index) => value === "--trace"
    ? String(args[index + 1] ?? "").split(",")
    : []).filter(Boolean).map((file) => path.resolve(file));
}

function configuredTraceFiles() {
  const explicit = traceOptions();
  if (explicit.length > 0) return explicit;
  const consumerRoot = path.resolve(ROOT, config.paths.consumerRoot);
  const roots = [ROOT, consumerRoot];
  for (const lane of Object.values(config.paths.lanes ?? {})) {
    roots.push(path.resolve(consumerRoot, lane.root));
  }
  return [...new Set(roots.map((root) => path.resolve(root, config.engineering.context.runtime.traceFile)))].filter((file) => fs.existsSync(file));
}

function traceEvidence() {
  const files = configuredTraceFiles();
  const events = [];
  const errors = [];
  for (const file of files) {
    const parsed = readTraceFile(file);
    events.push(...parsed.events);
    errors.push(...parsed.errors);
  }
  return { files, events, errors };
}

let routePasses = 0;
for (const testCase of golden.cases) {
  const result = runRouter(testCase.prompt);
  const route = routeFromOutput(result.stdout);
  const expected = testCase.expectedRoute;
  const agentMatches = !testCase.expectedAgent || result.stdout.includes(testCase.expectedAgent);
  const passed = result.status === 0 && route === expected && agentMatches;
  if (passed) routePasses += 1;
  console.log(`${passed ? "PASS" : "FAIL"} route ${testCase.id}: ${route ?? "none"} (expected ${expected})`);
  check(passed, `${testCase.id}: expected ${expected}/${testCase.expectedAgent ?? "inline"}, got ${route ?? "none"}`);
}

const routeAccuracy = golden.cases.length ? routePasses / golden.cases.length : 0;
check(routeAccuracy >= evaluation.thresholds.routeAccuracy, `route accuracy ${routeAccuracy} is below ${evaluation.thresholds.routeAccuracy}`);

const runtimeEvidence = traceEvidence();
runtimeEvidence.errors.forEach((error) => failures.push(error));
const repairOutcomes = repairOutcomesFromTrace(runtimeEvidence.events);
const repairRate = repairOutcomes.length ? repairConvergenceRate(repairOutcomes) : null;
const repairPasses = repairOutcomes.filter((outcome) => outcome.converged).length;
const repairReliability = repairOutcomes.length >= 2 ? passHatK(repairOutcomes.length, repairPasses, 2) : null;
const repairInterval = repairOutcomes.length ? wilsonInterval(repairPasses, repairOutcomes.length) : null;
if (repairRate === null) {
  console.log("INFO repair convergence is awaiting real loop-trace evidence");
} else {
  check(repairRate >= evaluation.thresholds.minimumRepairConvergence, `repair convergence ${repairRate} is below ${evaluation.thresholds.minimumRepairConvergence}`);
}

const overlay = JSON.stringify({
  version: config.engineering.context.runtimeOverlay.version,
  session: { routeId: "qa-control-plane", reason: "golden override" },
});
const override = runRouter("ordinary prompt", { FHF_HARNESS_OVERLAY: overlay });
check(override.status === 0 && routeFromOutput(override.stdout) === "qa-control-plane", "route override did not take effect");
const invalid = runRouter("ordinary prompt", {
  FHF_HARNESS_OVERLAY: JSON.stringify({ version: 1, engineering: { harness: {} } }),
});
check(invalid.status === 0 && invalid.stdout.includes("Harness config unavailable"), "invalid overlay was not rejected");

const calibration = JSON.parse(fs.readFileSync(path.join(ROOT, evaluation.calibrationCases), "utf8"));
if (calibration.cases.length === 0) {
  console.log("INFO gate calibration is awaiting recorded gate verdicts and human labels");
} else {
  const invalidMachineLabels = calibration.cases.filter((item) =>
    typeof item.judgePass !== "boolean" ||
    !Number.isFinite(item.judgeScore) ||
    item.judgeScore < 0 ||
    item.judgeScore > 1
  );
  if (invalidMachineLabels.length > 0) {
    check(false, `gate calibration has ${invalidMachineLabels.length} invalid machine label(s)`);
  }
  const unlabeled = calibration.cases.filter((item) =>
    typeof item.humanPass !== "boolean" ||
    !Number.isFinite(item.humanScore) ||
    typeof item.humanReviewer !== "string" ||
    item.humanReviewer.length === 0 ||
    typeof item.humanRationale !== "string" ||
    item.humanRationale.length === 0
  );
  if (invalidMachineLabels.length > 0) {
    // Do not compute agreement from malformed machine judgments.
  } else if (unlabeled.length > 0) {
    check(false, `gate calibration has ${unlabeled.length} unlabeled case(s); run calibrate-gate label before measuring agreement`);
  } else {
    const judgePass = calibration.cases.map((item) => item.judgePass);
    const humanPass = calibration.cases.map((item) => item.humanPass);
    const kappa = cohensKappa(judgePass, humanPass);
    const rho = spearmanRho(calibration.cases.map((item) => item.judgeScore), calibration.cases.map((item) => item.humanScore));
    check(kappa >= evaluation.thresholds.minimumCalibrationKappa, `gate kappa ${kappa} is below ${evaluation.thresholds.minimumCalibrationKappa}`);
    check(rho >= evaluation.thresholds.minimumCalibrationRho, `gate rho ${rho} is below ${evaluation.thresholds.minimumCalibrationRho}`);
    console.log(`Gate calibration: kappa=${kappa.toFixed(3)}, rho=${rho.toFixed(3)}`);
  }
}

console.log(`Route accuracy: ${(routeAccuracy * 100).toFixed(1)}%`);
console.log(
  repairRate === null
    ? "Repair convergence: unavailable; no real repair traces found"
    : `Repair convergence: ${(repairRate * 100).toFixed(1)}%; pass^2=${repairReliability === null ? "n/a" : repairReliability.toFixed(3)}; Wilson=${repairInterval.low.toFixed(3)}-${repairInterval.high.toFixed(3)}`,
);
if (failures.length) {
  console.error("Harness evaluation failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("Harness evaluation passed.");
