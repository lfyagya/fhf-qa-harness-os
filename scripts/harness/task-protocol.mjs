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

// Structural testData checks live in the lib; existence needs the filesystem, so it lives here.
function fixtureIssues(manifest, config) {
  const repositories = config.productTopology?.repositories ?? {};
  const issues = [];
  for (const test of manifest.plan?.tests ?? []) {
    const data = test.testData;
    if (!data?.fixture || typeof data.none === "string") continue;
    const label = test.id ?? "test";
    const root = repositories[test.repoId]?.root;
    if (!root) {
      issues.push(`${label}.testData cannot resolve: repository ${test.repoId} has no configured root`);
      continue;
    }
    // Two run locations, same as loadConfig(): projected at <consumer>/.harness, and canonical
    // at <harness>/scripts/harness with the consumer tree alongside. Try both.
    const repoRoot = [
      path.resolve(HERE, "..", root),
      path.resolve(HERE, "..", "..", config.paths?.consumerRoot ?? "..", root),
    ].find((candidate) => fs.existsSync(candidate));
    // A repository that is not checked out here cannot be judged. Skip rather than block:
    // partial checkouts are normal (one lane cloned, not the meta-root), and a gate that
    // fires on absent siblings gets switched off. An absent file inside a PRESENT repo is
    // still a hard failure - that is the case this check exists for.
    if (!repoRoot) continue;
    const file = path.join(repoRoot, data.fixture);
    if (!fs.existsSync(file)) {
      issues.push(`${label}.testData fixture not found: ${root}/${data.fixture}`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      issues.push(`${label}.testData fixture is not readable JSON: ${error.message}`);
      continue;
    }
    // ponytail: key resolves at the top level or one level in (fixtures nest under "accounts" etc).
    const resolves = Object.hasOwn(parsed, data.key)
      || Object.values(parsed).some((group) =>
        group && typeof group === "object" && !Array.isArray(group) && Object.hasOwn(group, data.key));
    if (!resolves) issues.push(`${label}.testData key "${data.key}" is absent from ${root}/${data.fixture}`);
  }
  return issues;
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
    intentVsBuilt: {
      path: "grounding.intentVsBuilt",
      classifications: ["same", "accepted", "defect", "parked", "ask-product"],
      honesty: ["live", "stubbed", "seeded"],
      rules: [
        "classify-before-plan",
        "ask-product-blocks-planning",
        "defect-blocks-verified-and-complete",
        "stubbed-external-proof-cannot-complete-same-or-accepted-rows",
      ],
    },
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
    const issues = [...validateTaskManifest(manifest, options), ...fixtureIssues(manifest, config)];
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
