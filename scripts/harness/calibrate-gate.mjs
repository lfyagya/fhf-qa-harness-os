#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readTraceFile } from "./evals/runtime-evidence.mjs";
import { withFileLock, writeBundleAtomic } from "./evidence-export-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "qa-control-plane.json"), "utf8"));
const DEFAULT_FILE = path.join(ROOT, CONFIG.engineering.context.evaluation.calibrationCases);
const args = process.argv.slice(2);
const command = args[0] ?? "status";

function option(name, { required = false } = {}) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (required && (!value || value.startsWith("--"))) throw new Error(`${name} is required`);
  return value;
}

function options(name) {
  return args.flatMap((value, index) => value === name ? String(args[index + 1] ?? "").split(",") : []).filter(Boolean);
}

function readJson(file) {
  if (!fs.existsSync(file)) return { version: 1, status: "needs-runtime-traces", cases: [] };
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(value.cases)) throw new Error(`${file} must contain a cases array`);
  return value;
}

function writeJson(file, value) {
  withFileLock(file, () => {
    writeBundleAtomic([{ file, content: `${JSON.stringify(value, null, 2)}\n` }]);
  });
}

function portableSource(file) {
  const relative = path.relative(ROOT, path.resolve(file)).replaceAll(path.sep, "/");
  return relative.startsWith("../") ? `external/${path.basename(file)}` : relative;
}

function statusFor(cases) {
  if (cases.length === 0) return "needs-runtime-traces";
  return cases.every((item) =>
    typeof item.humanPass === "boolean" &&
    Number.isFinite(item.humanScore) &&
    typeof item.humanReviewer === "string" &&
    item.humanReviewer.length > 0 &&
    typeof item.humanRationale === "string" &&
    item.humanRationale.length > 0
  ) ? "calibrated" : "needs-human-labels";
}

function collect() {
  const output = path.resolve(option("--output") ?? DEFAULT_FILE);
  const traceFiles = options("--trace").map((file) => path.resolve(file));
  if (traceFiles.length === 0) throw new Error("collect requires at least one --trace file");
  const data = readJson(output);
  const cases = new Map(data.cases.map((item) => [item.id, item]));
  let imported = 0;
  for (const traceFile of traceFiles) {
    const parsed = readTraceFile(traceFile);
    if (parsed.errors.length) throw new Error(parsed.errors.join("\n"));
    for (const [index, event] of parsed.events.entries()) {
      if (event.type !== "gate_verdict") continue;
      if (
        typeof event.judgePass !== "boolean" ||
        !Number.isFinite(event.judgeScore) ||
        event.judgeScore < 0 ||
        event.judgeScore > 1
      ) continue;
      const sourceFile = portableSource(traceFile);
      const id = `${event.runId}:gate:${sourceFile}:${event.traceLine ?? index + 1}`;
      if (cases.has(id)) continue;
      cases.set(id, {
        id,
        runId: event.runId,
        goal: event.goal ?? null,
        lane: event.lane ?? "root",
        sourceFile,
        traceLine: event.traceLine ?? index + 1,
        capturedAt: event.timestamp ?? null,
        verdict: event.verdict,
        judgePass: event.judgePass,
        judgeScore: event.judgeScore,
        findings: event.findings ?? [],
        humanPass: null,
        humanScore: null,
        humanReviewer: null,
        humanRationale: null,
        humanLabeledAt: null,
      });
      imported += 1;
    }
  }
  const next = {
    ...data,
    version: 1,
    cases: [...cases.values()],
  };
  next.status = statusFor(next.cases);
  writeJson(output, next);
  console.log(`Imported ${imported} gate calibration case(s) into ${output}. Status: ${next.status}.`);
}

function parseBoolean(value, name) {
  if (["true", "pass", "passed"].includes(String(value).toLowerCase())) return true;
  if (["false", "fail", "failed"].includes(String(value).toLowerCase())) return false;
  throw new Error(`${name} must be true/pass or false/fail`);
}

function label() {
  const file = path.resolve(option("--file") ?? DEFAULT_FILE);
  const id = option("--id", { required: true });
  const humanPass = parseBoolean(option("--human-pass", { required: true }), "--human-pass");
  const humanScore = Number(option("--human-score", { required: true }));
  const humanReviewer = option("--reviewer", { required: true });
  const humanRationale = option("--rationale", { required: true });
  if (!Number.isFinite(humanScore) || humanScore < 0 || humanScore > 1) {
    throw new Error("--human-score must be between 0 and 1");
  }
  const data = readJson(file);
  const index = data.cases.findIndex((item) => item.id === id);
  if (index < 0) throw new Error(`Calibration case not found: ${id}`);
  if (data.cases[index].humanPass !== null && !args.includes("--replace")) {
    throw new Error(`Calibration case ${id} is already labeled; use --replace to revise it`);
  }
  data.cases[index] = {
    ...data.cases[index],
    humanPass,
    humanScore,
    humanReviewer,
    humanRationale,
    humanLabeledAt: new Date().toISOString(),
  };
  data.status = statusFor(data.cases);
  writeJson(file, data);
  console.log(`Labeled ${id}. Status: ${data.status}.`);
}

function status() {
  const file = path.resolve(option("--file") ?? DEFAULT_FILE);
  const data = readJson(file);
  const unlabeled = data.cases.filter((item) => statusFor([item]) !== "calibrated");
  console.log(`Calibration file: ${file}`);
  console.log(`Status: ${statusFor(data.cases)}`);
  console.log(`Cases: ${data.cases.length}; unlabeled: ${unlabeled.length}`);
  for (const item of unlabeled) console.log(`- ${item.id}`);
}

try {
  if (command === "collect") collect();
  else if (command === "label") label();
  else if (command === "status") status();
  else throw new Error(`Unknown command: ${command}. Use collect, label, or status.`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
