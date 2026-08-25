#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  approvalDigest,
  approvalState,
  canonicalJson,
  dependencyCycles,
  missingAcceptanceOracleCoverage,
  missingVerificationEvidence,
  nextStep,
  selectProofMode,
  sha256,
  validateTaskManifest,
} from "./task-protocol-lib.mjs";

const SHA = "a".repeat(40);
const runnerIds = ["frontend-unit", "frontend-e2e", "production-smoke", "backend-api-oracle"];
const runners = {
  "frontend-unit": { repository: "fhf-dashboards", requiredCapabilities: ["source-grounding", "execution-environment"] },
  "frontend-e2e": { repository: "front-end-automation-e2e", environments: ["dev", "qa"], requiredCapabilities: ["source-grounding", "cypress-cli", "execution-environment"] },
  "production-smoke": { repository: "front-end-automation-smoke", environments: ["production"] },
  "backend-api-oracle": { repository: "fhf-backend-automation", environments: ["dev", "qa"], requiredCapabilities: ["source-grounding", "backend-api-oracle", "execution-environment"] },
};
const repos = [
  "fhf-dashboards",
  "front-end-automation-e2e",
  "front-end-automation-smoke",
  "fhf-backend-automation",
];
const HERE = path.dirname(fileURLToPath(import.meta.url));

function fixture() {
  return {
    schema: "fhf-harness/task/v1",
    id: "SERV-12356-contract-reference",
    stage: "planned",
    ticketFamily: { primary: "SERV-12356", related: ["SERV-12357"] },
    grounding: {
      jira: { issueDigest: sha256("jira snapshot") },
      acceptanceCriteriaDigest: sha256("acceptance criteria"),
      catalogVersion: "1",
      repositories: [
        { id: "fhf-dashboards", baseSha: SHA, headSha: SHA, selectedPaths: ["src/contracts"] },
        { id: "front-end-automation-e2e", baseSha: SHA, headSha: SHA, selectedPaths: ["CypressFHF/fhf-dashboards/cypress/tests"] },
      ],
      intentVsBuilt: {
        rows: [{
          id: "ac-contract-reference",
          intent: "Contract reference is visible on the dashboard",
          built: "Contract reference is visible on the dashboard",
          classification: "same",
        }],
      },
    },
    selection: {
      routeId: "cross-repository-change",
      module: "contracts",
      graphNodes: ["jira:SERV-12356", "repo:fhf-dashboards", "repo:front-end-automation-e2e"],
      sourceBundles: ["full-stack-change"],
      expansionReasons: ["linked frontend and backend implementation tickets"],
    },
    plan: {
      executionBudget: {
        maxWallClockMinutes: 60,
        maxRecordedToolResults: 30,
        maxRetryableFailures: 2,
      },
      capabilities: [
        { id: "source-grounding", subject: "selected paths", status: "ready", evidenceRef: "manifest snapshot" },
        { id: "cypress-cli", subject: "e2e dev", status: "ready", evidenceRef: "execution preflight" },
        { id: "execution-environment", subject: "dev", status: "ready", evidenceRef: "execution preflight" },
      ],
      changeUnits: [
        { id: "ui", repoId: "fhf-dashboards", paths: ["src/contracts"], dependsOn: [] },
        { id: "e2e", repoId: "front-end-automation-e2e", paths: ["CypressFHF/fhf-dashboards/cypress/tests"], dependsOn: ["ui"] },
      ],
      impact: { functional: ["contract reference"], regression: ["contracts dashboard"], smoke: [] },
      tests: [
        {
          id: "ui-unit",
          runnerId: "frontend-unit",
          repoId: "fhf-dashboards",
          path: "src/contracts/contract-reference.test.tsx",
          environment: "local",
          proofMode: "red-green-replay",
        },
        {
          id: "e2e",
          runnerId: "frontend-e2e",
          repoId: "front-end-automation-e2e",
          path: "CypressFHF/fhf-dashboards/cypress/tests/contracts/contract-reference.cy.js",
          environment: "dev",
          proofMode: "external-execution-evidence",
          honesty: "live",
          acceptanceIds: ["ac-contract-reference"],
        },
      ],
    },
    approval: { required: true, approvedDigest: null, reference: null },
    evidence: { artifacts: [] },
  };
}

assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
assert.deepEqual(dependencyCycles(fixture().plan.changeUnits), []);
assert.deepEqual(
  dependencyCycles([
    { id: "a", dependsOn: ["b"] },
    { id: "b", dependsOn: ["a"] },
  ]),
  [["a", "b", "a"]],
);
const executionBudget = {
  manifestPath: "plan.executionBudget",
  requiredFields: ["maxWallClockMinutes", "maxRecordedToolResults", "maxRetryableFailures"],
  hardCeilings: { maxWallClockMinutes: 180, maxRecordedToolResults: 100, maxRetryableFailures: 3 },
};
const capabilityControl = { manifestPath: "plan.capabilities", capabilities: {
  "source-grounding": {}, "cypress-cli": {}, "execution-environment": {}, "backend-api-oracle": {},
} };
const options = { repoIds: repos, runnerIds, runners, executionBudget, capabilityControl };
assert.deepEqual(validateTaskManifest(fixture(), options), []);
const invalidBudget = fixture();
invalidBudget.plan.executionBudget.maxRecordedToolResults = 101;
assert.match(validateTaskManifest(invalidBudget, options).join("\n"), /hard ceiling/);
const crossLayer = fixture();
crossLayer.selection.routeId = "cross-layer-test-generation";
crossLayer.grounding.repositories.push({
  id: "fhf-backend-automation",
  baseSha: SHA,
  headSha: SHA,
  selectedPaths: ["tests/contracts", "api/contracts"],
});
crossLayer.plan.changeUnits.push({
  id: "backend-tests",
  repoId: "fhf-backend-automation",
  paths: ["tests/contracts", "api/contracts"],
  dependsOn: ["ui"],
});
crossLayer.plan.tests.push({
  id: "backend-contracts",
  runnerId: "backend-api-oracle",
  repoId: "fhf-backend-automation",
  path: "tests/contracts/test_contract_reference.py",
  environment: "qa",
  proofMode: "external-execution-evidence",
  honesty: "live",
  acceptanceIds: ["ac-contract-reference"],
});
crossLayer.plan.capabilities.push({ id: "backend-api-oracle", subject: "qa backend", status: "ready", evidenceRef: "backend preflight" });
assert.deepEqual(validateTaskManifest(crossLayer, options), []);
const invalidEnvironment = fixture();
invalidEnvironment.plan.tests[1].environment = "production";
assert.match(validateTaskManifest(invalidEnvironment, options).join("\n"), /outside runner frontend-e2e/);

const approved = fixture();
approved.approval.approvedDigest = approvalDigest(approved);
assert.equal(approvalState(approved).state, "current");
approved.plan.impact.regression.push("contract list filtering");
assert.equal(approvalState(approved).state, "stale");
assert.equal(nextStep(approved, options).action, "refresh-human-approval");

const cycle = fixture();
cycle.plan.changeUnits[0].dependsOn = ["e2e"];
assert.match(validateTaskManifest(cycle, options).join("\n"), /dependency cycle/);

assert.equal(selectProofMode({ testKind: "unit", hermetic: true }), "red-green-replay");
assert.equal(selectProofMode({ testKind: "unit", hermetic: true, existingCoverage: true }), "existing-regression-base-pass");
assert.equal(selectProofMode({ testKind: "cypress-e2e" }), "external-execution-evidence");
assert.equal(selectProofMode({ testKind: "unit", changeClass: "metadata" }), "tests-not-applicable");

const missingApproval = fixture();
assert.equal(nextStep(missingApproval, options).action, "await-human-approval");
missingApproval.approval.required = false;
assert.equal(nextStep(missingApproval, options).action, "begin-implementation");

assert.equal(nextStep({
  schema: "fhf-harness/task/v1",
  id: "SERV-12356-contract-reference",
  stage: "intake",
  ticketFamily: { primary: "SERV-12356", related: [] },
}).action, "ground-task");

const verified = fixture();
verified.stage = "verified";
verified.approval.approvedDigest = approvalDigest(verified);
assert.deepEqual(missingVerificationEvidence(verified), ["ui-unit", "e2e"]);
assert.equal(nextStep(verified, options).action, "collect-native-verification-evidence");
verified.evidence.artifacts = verified.plan.tests.map((test) => ({
  testId: test.id,
  runnerId: test.runnerId,
  proofMode: test.proofMode,
  result: "passed",
  testPath: test.path,
  revision: SHA,
  environment: test.id === "e2e" ? "dev" : "local",
  artifact: `reports/${test.id}.xml`,
  artifactDigest: sha256(`${test.id} artifact`),
  counts: { tests: 1, failures: 0, errors: 0, skipped: 0 },
  completedAt: "2026-08-21T00:00:00.000Z",
}));
assert.deepEqual(missingVerificationEvidence(verified), []);
assert.equal(nextStep(verified, options).action, "complete-task");

const mismatchedEvidence = structuredClone(verified);
mismatchedEvidence.evidence.artifacts[0].testPath = "src/contracts/different.test.tsx";
assert.deepEqual(missingVerificationEvidence(mismatchedEvidence), ["ui-unit"]);

const zeroTestEvidence = structuredClone(verified);
zeroTestEvidence.evidence.artifacts[1].counts.tests = 0;
assert.deepEqual(missingVerificationEvidence(zeroTestEvidence), ["e2e"]);

const unclassified = fixture();
unclassified.stage = "grounded";
delete unclassified.grounding.intentVsBuilt;
unclassified.approval.approvedDigest = null;
assert.equal(nextStep(unclassified, options).action, "classify-intent-vs-built");

const askProduct = fixture();
askProduct.stage = "grounded";
askProduct.grounding.intentVsBuilt.rows[0].classification = "ask-product";
assert.equal(nextStep(askProduct, options).action, "classify-intent-vs-built");
assert.match(validateTaskManifest(askProduct, options).join("\n"), /ask-product/);

const classifiedGrounded = fixture();
classifiedGrounded.stage = "grounded";
assert.equal(nextStep(classifiedGrounded, options).action, "plan-cross-repository-change");

const acceptedMissingOwner = fixture();
acceptedMissingOwner.grounding.intentVsBuilt.rows[0].classification = "accepted";
assert.match(validateTaskManifest(acceptedMissingOwner, options).join("\n"), /acceptedBy/);

const parkedMissingSibling = fixture();
parkedMissingSibling.grounding.intentVsBuilt.rows[0].classification = "parked";
assert.match(validateTaskManifest(parkedMissingSibling, options).join("\n"), /parkedOn/);

const missingHonesty = fixture();
delete missingHonesty.plan.tests[1].honesty;
assert.match(validateTaskManifest(missingHonesty, options).join("\n"), /honesty/);

const stubbedOnly = structuredClone(verified);
stubbedOnly.plan.tests[1].honesty = "stubbed";
stubbedOnly.approval.approvedDigest = approvalDigest(stubbedOnly);
assert.deepEqual(missingAcceptanceOracleCoverage(stubbedOnly), ["ac-contract-reference"]);
assert.equal(nextStep(stubbedOnly, options).action, "collect-native-verification-evidence");
assert.deepEqual(nextStep(stubbedOnly, options).missingOracles, ["ac-contract-reference"]);

const defectBlocksRelease = structuredClone(verified);
defectBlocksRelease.grounding.intentVsBuilt.rows[0].classification = "defect";
defectBlocksRelease.approval.approvedDigest = approvalDigest(defectBlocksRelease);
assert.equal(nextStep(defectBlocksRelease, options).action, "resolve-intent-vs-built-defect");
assert.equal(nextStep(defectBlocksRelease, options).blocked, true);

const classificationInvalidatesApproval = fixture();
classificationInvalidatesApproval.approval.approvedDigest = approvalDigest(classificationInvalidatesApproval);
assert.equal(approvalState(classificationInvalidatesApproval).state, "current");
classificationInvalidatesApproval.grounding.intentVsBuilt.rows[0].built = "source silently rewrote the AC";
assert.equal(approvalState(classificationInvalidatesApproval).state, "stale");

const cliRoot = mkdtempSync(path.join(tmpdir(), "fhf-task-protocol-"));
const manifestPath = path.join(cliRoot, "task.json");
writeFileSync(manifestPath, JSON.stringify(fixture()), "utf8");
const validateResult = spawnSync(process.execPath, [path.join(HERE, "task-protocol.mjs"), "validate", "--manifest", manifestPath], { encoding: "utf8" });
assert.equal(validateResult.status, 0, validateResult.stderr);
assert.equal(JSON.parse(validateResult.stdout).valid, true);
const nextResult = spawnSync(process.execPath, [path.join(HERE, "task-protocol.mjs"), "next", "--manifest", manifestPath], { encoding: "utf8" });
assert.equal(nextResult.status, 0, nextResult.stderr);
assert.equal(JSON.parse(nextResult.stdout).action, "await-human-approval");
const contractResult = spawnSync(process.execPath, [path.join(HERE, "task-protocol.mjs"), "contract"], { encoding: "utf8" });
assert.equal(contractResult.status, 0, contractResult.stderr);
assert.equal(JSON.parse(contractResult.stdout).schema, "fhf-harness/task/v1");
rmSync(cliRoot, { recursive: true, force: true });

console.log("Task protocol tests passed.");
