#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TASK_SCHEMA,
  approvalDigest,
  approvalState,
  nextStep,
  validateTaskManifest,
} from "./task-protocol-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const command = args[0];

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function loadConfig() {
  const candidates = [
    process.env.FHF_HARNESS_CONFIG,
    path.resolve(HERE, "..", ".claude", "harness.config.json"),
    path.resolve(HERE, "..", "..", "config", "qa-control-plane.json"),
  ].filter(Boolean);
  const selected = candidates.find((candidate) => fs.existsSync(candidate));
  if (!selected) throw new Error(`Harness config not found. Checked: ${candidates.join(", ")}`);
  return JSON.parse(fs.readFileSync(selected, "utf8"));
}

function loadManifest() {
  const source = option("--manifest");
  if (!source) throw new Error("--manifest <task.json> is required");
  return JSON.parse(fs.readFileSync(path.resolve(source), "utf8"));
}

function protocolOptions(config) {
  const runners = config.engineering?.executionRunners?.runners ?? {};
  return {
    repoIds: Object.keys(config.productTopology?.repositories ?? {}),
    runnerIds: Object.keys(runners),
    runners,
    approvalFields: config.engineering?.taskProtocol?.approval?.boundFields,
    executionBudget: config.engineering?.taskProtocol?.executionBudget,
    capabilityControl: config.engineering?.capabilityControl,
  };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function contract(config) {
  print({
    schema: TASK_SCHEMA,
    stages: config.engineering.taskProtocol.stages,
    manifestPath: config.engineering.taskProtocol.manifestPath,
    requiredSections: config.engineering.taskProtocol.requiredSections,
    approvalBoundFields: config.engineering.taskProtocol.approval.boundFields,
    executionBudget: config.engineering.taskProtocol.executionBudget,
    capabilityControl: config.engineering.capabilityControl,
    proofModes: Object.keys(config.engineering.taskProtocol.proofModes),
    runnerIds: Object.keys(config.engineering.executionRunners.runners),
    repositoryIds: Object.keys(config.productTopology.repositories),
    testEvidence: {
      schema: "fhf-harness/test-evidence/v1",
      required: [
        "testId",
        "runnerId",
        "proofMode",
        "result",
        "testPath",
        "revision",
        "environment",
        "artifact",
        "artifactDigest",
        "counts",
        "completedAt",
      ],
      acceptance: ["exact-plan-match", "tests-greater-than-zero", "zero-failures", "zero-errors"],
    },
    commands: {
      validate: "node .harness/task-protocol.mjs validate --manifest <task.json>",
      digest: "node .harness/task-protocol.mjs digest --manifest <task.json>",
      next: "node .harness/task-protocol.mjs next --manifest <task.json>",
      backendPreflight: "node .harness/backend-task-runner.mjs preflight --manifest <absolute-task.json> --test-id <id>",
    },
  });
}

try {
  const config = loadConfig();
  const options = protocolOptions(config);
  if (command === "contract") {
    contract(config);
  } else if (command === "validate") {
    const manifest = loadManifest();
    const issues = validateTaskManifest(manifest, options);
    print({ valid: issues.length === 0, issues });
    if (issues.length > 0) process.exitCode = 1;
  } else if (command === "digest") {
    const manifest = loadManifest();
    print({ digest: approvalDigest(manifest, options.approvalFields), approval: approvalState(manifest, options.approvalFields) });
  } else if (command === "next") {
    print(nextStep(loadManifest(), options));
  } else {
    throw new Error("Usage: task-protocol.mjs <contract|validate|digest|next> [--manifest <task.json>]");
  }
} catch (error) {
  console.error(`Task protocol error: ${error.message}`);
  process.exitCode = 2;
}
