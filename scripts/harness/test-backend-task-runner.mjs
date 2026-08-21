#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { approvalDigest, sha256 } from "./task-protocol-lib.mjs";
import { buildBackendRunPlan } from "./backend-task-runner.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fhf-backend-runner-"));
const repositoryRoot = path.join(root, "fhf-backend-automation");
fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
fs.mkdirSync(path.join(root, ".harness", "tasks"), { recursive: true });
fs.mkdirSync(path.join(repositoryRoot, "tests", "contracts"), { recursive: true });
fs.mkdirSync(path.join(repositoryRoot, "config"), { recursive: true });
fs.writeFileSync(path.join(repositoryRoot, ".gitignore"), "tests/.env\nconfig/config.ini\nreports/\nallure-results/\n", "utf8");
fs.writeFileSync(path.join(repositoryRoot, "tests", "contracts", "test_contract.py"), "def test_contract():\n    assert True\n", "utf8");
execFileSync("git", ["init", repositoryRoot]);
execFileSync("git", ["-C", repositoryRoot, "config", "user.email", "harness@example.invalid"]);
execFileSync("git", ["-C", repositoryRoot, "config", "user.name", "Harness Test"]);
execFileSync("git", ["-C", repositoryRoot, "add", ".gitignore", "tests/contracts/test_contract.py"]);
execFileSync("git", ["-C", repositoryRoot, "commit", "-m", "fixture"]);
const revision = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
fs.writeFileSync(path.join(repositoryRoot, "tests", ".env"), "fixture", "utf8");
fs.writeFileSync(path.join(repositoryRoot, "config", "config.ini"), "fixture", "utf8");

const config = {
  paths: {
    automationLanes: {
      backend: { execution: { junit: "reports/junit-report.xml" } },
    },
  },
  productTopology: {
    catalogVersion: "test-catalog",
    repositories: {
      "fhf-backend-automation": { root: "fhf-backend-automation" },
    },
  },
  engineering: {
    taskProtocol: {
      schema: "fhf-harness/task/v1",
      activeManifestEnv: "FHF_ACTIVE_TASK",
      executionBudget: {
        manifestPath: "plan.executionBudget",
        requiredFields: ["maxWallClockMinutes", "maxRecordedToolResults", "maxRetryableFailures"],
        hardCeilings: { maxWallClockMinutes: 180, maxRecordedToolResults: 100, maxRetryableFailures: 3 },
      },
    },
    capabilityControl: {
      manifestPath: "plan.capabilities",
      capabilities: { "source-grounding": {}, "backend-api-oracle": {}, "execution-environment": {} },
    },
    executionRunners: {
      runners: {
        "backend-api-oracle": {
          repository: "fhf-backend-automation",
          environments: ["dev", "qa"],
          requiredCapabilities: ["source-grounding", "backend-api-oracle", "execution-environment"],
        },
      },
    },
  },
};
fs.writeFileSync(
  path.join(root, ".claude", "harness.config.json"),
  JSON.stringify(config),
  "utf8",
);

const manifest = {
  schema: "fhf-harness/task/v1",
  id: "SERV-12356-contract-reference",
  stage: "implementing",
  ticketFamily: { primary: "SERV-12356", related: ["SERV-12357"] },
  grounding: {
    jira: { issueDigest: sha256("jira snapshot") },
    acceptanceCriteriaDigest: sha256("acceptance criteria"),
    catalogVersion: "test-catalog",
    repositories: [{
      id: "fhf-backend-automation",
      baseSha: revision,
      headSha: revision,
      selectedPaths: ["tests/contracts"],
    }],
  },
  selection: {
    routeId: "backend-test",
    module: "contracts",
    graphNodes: ["jira:SERV-12356", "repo:fhf-backend-automation"],
    sourceBundles: ["backend-api-change"],
    expansionReasons: ["selected API contract"],
  },
  plan: {
    executionBudget: {
      maxWallClockMinutes: 60,
      maxRecordedToolResults: 30,
      maxRetryableFailures: 2,
    },
    capabilities: [
      { id: "source-grounding", subject: "backend contract", status: "ready", evidenceRef: "snapshot" },
      { id: "backend-api-oracle", subject: "qa backend", status: "ready", evidenceRef: "preflight" },
      { id: "execution-environment", subject: "qa", status: "ready", evidenceRef: "preflight" },
    ],
    changeUnits: [{
      id: "backend-tests",
      repoId: "fhf-backend-automation",
      paths: ["tests/contracts"],
      dependsOn: [],
    }],
    impact: { functional: ["contract reference"], regression: [], smoke: [] },
    tests: [{
      id: "backend-contracts",
      runnerId: "backend-api-oracle",
      repoId: "fhf-backend-automation",
      path: "tests/contracts/test_contract.py",
      environment: "qa",
      proofMode: "external-execution-evidence",
    }],
  },
  approval: { required: true, approvedDigest: null, reference: "human-review" },
  evidence: { artifacts: [] },
};
manifest.approval.approvedDigest = approvalDigest(manifest);
const manifestPath = path.join(root, ".harness", "tasks", "SERV-12356.json");
fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

const env = {
  FHF_ACTIVE_TASK: manifestPath,
  FHF_BACKEND_ENVIRONMENT: "qa",
};
const plan = buildBackendRunPlan({ root, manifestPath, testId: "backend-contracts", env });
assert.equal(plan.test.path, "tests/contracts/test_contract.py");
assert.equal(plan.environment, "qa");
assert.equal(plan.revision, revision);
assert.deepEqual(plan.pytestArgs, [
  "-m",
  "pytest",
  "tests/contracts/test_contract.py",
  "--dist=no",
  "--junitxml=reports/junit-report.xml",
]);

assert.throws(
  () => buildBackendRunPlan({
    root,
    manifestPath,
    testId: "backend-contracts",
    env: { ...env, FHF_BACKEND_ENVIRONMENT: "dev" },
  }),
  /must equal the manifest environment qa/,
);

fs.writeFileSync(path.join(repositoryRoot, "unrelated.py"), "# unrelated\n", "utf8");
assert.throws(
  () => buildBackendRunPlan({ root, manifestPath, testId: "backend-contracts", env }),
  /changes outside the task plan: unrelated.py/,
);

fs.rmSync(root, { recursive: true, force: true });
console.log("Backend task runner tests passed.");
