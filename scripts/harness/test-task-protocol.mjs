#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  approvalDigest,
  approvalState,
  canonicalJson,
  dependencyCycles,
  firstPendingGate,
  gateDigest,
  gateState,
  missingAcceptanceOracleCoverage,
  missingVerificationEvidence,
  nextStep,
  selectProofMode,
  sha256,
  stampGate,
  canonicalTaskPath,
  isAcceptedTicket,
  ticketKeyFromValue,
  resolveActiveTask,
  resolveTaskFromText,
  taskSlug,
  validateTaskManifest,
  writeTaskFocus,
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
// frontend-change is routed by nothing and selected only by a manifest - keep it in the fixture.
const bundles = ["full-stack-change", "frontend-change", "backend-api-change"];
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
          scenarioRef: {
            registry: "regression-checklist",
            source: "docs/evidence/regression-effort/records/sprint-26.3.5/regression-checklist.yaml",
            group: "B14.3",
          },
          testData: { none: "Hermetic unit test builds its own props." },
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
          scenarioRef: {
            registry: "regression-checklist",
            source: "docs/evidence/regression-effort/records/sprint-26.3.5/regression-checklist.yaml",
            group: "B14.3",
          },
          testData: {
            fixture: "CypressFHF/fhf-dashboards/cypress/fixtures/unifi/collections/pinnedAccounts.json",
            key: "dpdUnder17",
          },
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
const crossRepositorySeam = {
  frontendRepositories: ["front-end-automation-e2e", "front-end-automation-smoke"],
  backendRepositories: ["fhf-backend-automation"],
  requiredFields: ["endpoint", "correlationKey"],
  notApplicableStatus: "NOT_APPLICABLE",
  notApplicableEvidenceField: "evidence",
};
const frontendTestData = {
  repositories: ["front-end-automation-e2e", "front-end-automation-smoke"],
  allowedSources: ["fixture-key", "synthetic-builder", "api-seed", "hermetic-inline"],
  forbiddenSources: ["production-pii", "shared-mutable-record", "untracked-live-record"],
  persistentMutationRequires: [
    "syntheticOwnedIdentity",
    "knownBaseline",
    "exactRequestAndResult",
    "prohibitedOutcome",
    "verifiedCleanup",
  ],
};
const options = {
  repoIds: repos,
  bundleIds: bundles,
  runnerIds,
  runners,
  executionBudget,
  capabilityControl,
  crossRepositorySeam,
  frontendTestData,
};
assert.deepEqual(validateTaskManifest(fixture(), options), []);

// ADR-0043: a local task is identified by its title and grounded on a recorded intent digest.
const localTask = fixture();
localTask.ticketFamily = { source: "local" };
localTask.title = "Harden the export audit trail";
delete localTask.grounding.jira;
localTask.grounding.intent = { text: "Harden the export audit trail", digest: sha256("Harden the export audit trail") };
assert.deepEqual(validateTaskManifest(localTask, options), []);
const untitledLocal = structuredClone(localTask);
delete untitledLocal.title;
assert.match(validateTaskManifest(untitledLocal, options).join("\n"), /local task .* must record a title/);
const undigestedLocal = structuredClone(localTask);
delete undigestedLocal.grounding.intent;
assert.match(validateTaskManifest(undigestedLocal, options).join("\n"), /grounding\.intent\.digest/);
assert.match(validateTaskManifest({ ...fixture(), ticketFamily: {} }, options).join("\n"), /ticketFamily\.primary must be a FirstHelp ticket/);
assert.deepEqual(validateTaskManifest({ ...fixture(), ticketFamily: { primary: "GEARS-10", related: [] } }, options), []);
assert.equal(ticketKeyFromValue("NLOS-10 then los-2"), "LOS-2");
assert.equal(ticketKeyFromValue("nlos-10"), null);
assert.equal(ticketKeyFromValue("SALES-4"), null);
assert.equal(isAcceptedTicket("SDX-3"), true);

const resolverRoot = mkdtempSync(path.join(tmpdir(), "task-resolver-"));
const resolverConfig = { engineering: { taskProtocol: { manifestPath: ".harness/tasks/<task-id>.json", activeManifestEnv: "FHF_ACTIVE_TASK" } } };
assert.equal(taskSlug("Harden the Export audit trail!"), "harden-the-export-audit-trail");
assert.equal(path.basename(canonicalTaskPath(resolverRoot, resolverConfig, { title: "Harden the export audit trail" })), "harden-the-export-audit-trail.json");
assert.equal(path.basename(canonicalTaskPath(resolverRoot, resolverConfig, { ticket: "serv-42" })), "SERV-42.json");
// No task directory: nothing to resolve, and no focus is written into an arbitrary root.
assert.equal(writeTaskFocus(resolverRoot, resolverConfig, { file: "x.json" }), false);
const resolverTasks = path.join(resolverRoot, ".harness", "tasks");
mkdirSync(resolverTasks, { recursive: true });
writeFileSync(path.join(resolverTasks, "harden-the-export-audit-trail.json"), JSON.stringify({ ...localTask, id: "harden-the-export-audit-trail" }));
writeFileSync(path.join(resolverTasks, "SERV-42.json"), JSON.stringify({ ...fixture(), id: "SERV-42", ticketFamily: { primary: "SERV-42", related: ["SERV-41"] } }));
assert.equal(resolveTaskFromText({ root: resolverRoot, config: resolverConfig, text: "pick up SERV-42" }).match.manifest.id, "SERV-42");
assert.equal(resolveTaskFromText({ root: resolverRoot, config: resolverConfig, text: "work GEARS-7" }).kind, "jira");
assert.equal(resolveTaskFromText({ root: resolverRoot, config: resolverConfig, text: "work GEARS-7" }).key, "GEARS-7");
assert.equal(resolveTaskFromText({ root: resolverRoot, config: resolverConfig, text: "NLOS-10 only" }).kind, "title");
assert.equal(resolveTaskFromText({ root: resolverRoot, config: resolverConfig, text: "about SERV-41" }).match.manifest.id, "SERV-42");
assert.equal(resolveTaskFromText({ root: resolverRoot, config: resolverConfig, text: "harden the export audit trail next" }).match.manifest.id, "harden-the-export-audit-trail");
assert.equal(resolveTaskFromText({ root: resolverRoot, config: resolverConfig, text: "yes" }).match, null);
assert.equal(resolveActiveTask({ root: resolverRoot, config: resolverConfig, env: { FHF_ACTIVE_TASK: "/abs/override.json" } }).source, "env");
assert.equal(writeTaskFocus(resolverRoot, resolverConfig, { file: "../../escape.json" }), true);
assert.equal(resolveActiveTask({ root: resolverRoot, config: resolverConfig, env: {} }).file, null, "a focus may not point outside the task directory");
writeTaskFocus(resolverRoot, resolverConfig, { file: "SERV-42.json" });
assert.equal(path.basename(resolveActiveTask({ root: resolverRoot, config: resolverConfig, env: {} }).file), "SERV-42.json");
rmSync(resolverRoot, { recursive: true, force: true });
const forbiddenFrontendData = fixture();
forbiddenFrontendData.plan.tests[1].testData.source = "production-pii";
assert.match(validateTaskManifest(forbiddenFrontendData, options).join("\n"), /source must be allowed/);
const incompleteMutationData = fixture();
incompleteMutationData.plan.tests[1].testData.persistentMutation = true;
assert.match(
  validateTaskManifest(incompleteMutationData, options).join("\n"),
  /syntheticOwnedIdentity must record/,
);
const unroutedBundle = fixture();
unroutedBundle.selection.sourceBundles = ["frontend-change"];
assert.deepEqual(validateTaskManifest(unroutedBundle, options), []);
const typoBundle = fixture();
typoBundle.selection.sourceBundles = ["frontnd-change"];
assert.match(validateTaskManifest(typoBundle, options).join("\n"), /unknown source bundle: frontnd-change/);
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
crossLayer.plan.changeUnits[1].seam = {
  endpoint: "GET /api/contracts/{contractId}",
  correlationKey: "contractId",
};
crossLayer.plan.changeUnits.push({
  id: "backend-tests",
  repoId: "fhf-backend-automation",
  paths: ["tests/contracts", "api/contracts"],
  dependsOn: ["ui"],
  seam: {
    endpoint: "GET /api/contracts/{contractId}",
    correlationKey: "contractId",
  },
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
  scenarioRef: {
    registry: "regression-checklist",
    source: "docs/evidence/regression-effort/records/sprint-26.3.5/regression-checklist.yaml",
    group: "B13.5",
  },
  testData: { none: "Contract test builds its own request body." },
});
crossLayer.plan.capabilities.push({ id: "backend-api-oracle", subject: "qa backend", status: "ready", evidenceRef: "backend preflight" });
assert.deepEqual(validateTaskManifest(crossLayer, options), []);
const missingSeam = structuredClone(crossLayer);
delete missingSeam.plan.changeUnits[1].seam;
assert.match(validateTaskManifest(missingSeam, options).join("\n"), /e2e\.seam must bind/);
const mismatchedSeam = structuredClone(crossLayer);
mismatchedSeam.plan.changeUnits[2].seam.correlationKey = "loanNumber";
assert.match(validateTaskManifest(mismatchedSeam, options).join("\n"), /must match e2e\.seam/);
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

const gates = [
  {
    id: "manifest",
    label: "Task manifest",
    boundFields: [
      "ticketFamily",
      "grounding.jira.issueDigest",
      "grounding.acceptanceCriteriaDigest",
      "grounding.catalogVersion",
      "grounding.repositories",
      "grounding.intentVsBuilt",
      "selection",
    ],
    requiredFrom: ["grounded", "planned", "approved", "implementing", "verified", "complete"],
  },
  {
    id: "scenarios",
    label: "Approved scenarios",
    boundFields: ["plan.tests"],
    extract: "scenario-refs",
    requiredFrom: ["planned", "approved", "implementing", "verified", "complete"],
  },
  {
    id: "plan",
    label: "Task plan",
    boundFields: ["plan.changeUnits", "plan.impact", "plan.executionBudget"],
    requiredFrom: ["planned", "approved", "implementing", "verified", "complete"],
  },
  {
    id: "test-cases",
    label: "Selected tests",
    boundFields: ["plan.tests"],
    requiredFrom: ["planned", "approved", "implementing", "verified", "complete"],
  },
  {
    id: "evidence",
    label: "Native evidence",
    boundFields: ["evidence"],
    requiredFrom: ["verified", "complete"],
  },
  {
    id: "release",
    label: "Release confidence",
    boundFields: ["evidence", "plan.impact"],
    requiredFrom: ["complete"],
  },
];
const gatedOptions = { ...options, gates, legacySingleDigestSatisfies: "plan" };
const gated = fixture();
assert.equal(gateState(gated, gates[0]).state, "missing");
assert.equal(firstPendingGate(gated, gates, "grounded").gate.id, "manifest");
assert.equal(firstPendingGate(gated, gates, "planned").gate.id, "manifest");
assert.equal(nextStep(gated, gatedOptions).action, "await-human-approval");
assert.equal(nextStep(gated, gatedOptions).gate, "manifest");

gated.approval.stamps = {
  manifest: {
    approvedBy: "Sanjay Koju",
    approvedAt: "2026-09-17T00:00:00.000Z",
    digest: gateDigest(gated, gates[0]),
  },
};
assert.equal(gateState(gated, gates[0]).state, "current");
assert.equal(firstPendingGate(gated, gates, "planned").gate.id, "scenarios");
assert.equal(nextStep(gated, gatedOptions).gate, "scenarios");

const scenarioOnly = structuredClone(gated);
scenarioOnly.plan.tests[0].path = "src/contracts/renamed.test.tsx";
assert.equal(gateDigest(scenarioOnly, gates[1]), gateDigest(gated, gates[1]));
assert.notEqual(gateDigest(scenarioOnly, gates[3]), gateDigest(gated, gates[3]));

const scenarioChanged = structuredClone(gated);
scenarioChanged.plan.tests[0].scenarioRef.group = "B99.9";
assert.notEqual(gateDigest(scenarioChanged, gates[1]), gateDigest(gated, gates[1]));

gated.approval.approvedDigest = approvalDigest(gated);
assert.equal(gateState(gated, gates[2], { legacyGateId: "plan" }).state, "current");
assert.equal(gateState(gated, gates[2], { legacyGateId: "plan" }).via, "legacy-approvedDigest");
assert.equal(firstPendingGate(gated, gates, "planned", { legacyGateId: "plan" }).gate.id, "scenarios");

const stamped = fixture();
assert.throws(
  () => stampGate(stamped, gates[0], {
    approvedBy: "Sanjay Koju",
    approvedAt: "2026-09-17T00:00:00.000Z",
  }),
  /gates must be a non-empty array/,
);
assert.throws(
  () => stampGate(stamped, gates[1], {
    approvedBy: "Sanjay Koju",
    approvedAt: "2026-09-17T00:00:00.000Z",
  }, { gates }),
  /cannot stamp scenarios before manifest is current/,
);
stamped.approval = stampGate(stamped, gates[0], {
  approvedBy: "Sanjay Koju",
  approvedAt: "2026-09-17T00:00:00.000Z",
}, { gates });
assert.equal(stamped.approval.stamps.manifest.approvedBy, "Sanjay Koju");
assert.equal(gateState({ ...fixture(), approval: stamped.approval }, gates[0]).state, "current");

const groundedOnly = fixture();
groundedOnly.stage = "grounded";
groundedOnly.approval = stampGate(groundedOnly, gates[0], {
  approvedBy: "Sanjay Koju",
  approvedAt: "2026-09-17T00:00:00.000Z",
}, { gates });
assert.throws(
  () => stampGate(groundedOnly, gates[1], {
    approvedBy: "Sanjay Koju",
    approvedAt: "2026-09-17T00:00:00.000Z",
  }, { gates }),
  /cannot stamp scenarios at stage grounded/,
);
assert.throws(
  () => stampGate(groundedOnly, gates[4], {
    approvedBy: "Sanjay Koju",
    approvedAt: "2026-09-17T00:00:00.000Z",
  }, { gates }),
  /cannot stamp evidence at stage grounded/,
);
assert.throws(
  () => stampGate(stamped, gates[2], {
    approvedBy: "Sanjay Koju",
    approvedAt: "2026-09-17T00:00:00.000Z",
  }, { gates }),
  /cannot stamp plan before scenarios is current/,
);
assert.match(
  validateTaskManifest({
    ...fixture(),
    approval: { required: true, stamps: { manifest: { approvedBy: "", approvedAt: "nope", digest: "short" } } },
  }, gatedOptions).join("\n"),
  /approvedBy must be recorded/,
);

const allPlannedStamped = fixture();
for (const gate of gates.filter((item) => item.requiredFrom.includes("planned"))) {
  allPlannedStamped.approval = stampGate(allPlannedStamped, gate, {
    approvedBy: "Sanjay Koju",
    approvedAt: "2026-09-17T00:00:00.000Z",
  }, { approvalFields: options.approvalFields, legacyGateId: "plan", gates });
}
assert.equal(nextStep(allPlannedStamped, gatedOptions).action, "begin-implementation");
assert.equal(nextStep(allPlannedStamped, gatedOptions).blocked, false);
assert.throws(
  () => stampGate(allPlannedStamped, gates[4], {
    approvedBy: "Sanjay Koju",
    approvedAt: "2026-09-17T00:00:00.000Z",
  }, { gates }),
  /cannot stamp evidence at stage planned/,
);
assert.throws(
  () => stampGate(allPlannedStamped, gates[5], {
    approvedBy: "Sanjay Koju",
    approvedAt: "2026-09-17T00:00:00.000Z",
  }, { gates }),
  /cannot stamp release at stage planned/,
);

const evidenceStage = structuredClone(verified);
evidenceStage.approval.stamps = Object.fromEntries(
  gates.filter((gate) => gate.requiredFrom.includes("planned")).map((gate) => [gate.id, {
    approvedBy: "Sanjay Koju",
    approvedAt: "2026-09-17T00:00:00.000Z",
    digest: gateDigest(evidenceStage, gate),
  }]),
);
assert.equal(firstPendingGate(evidenceStage, gates, "verified").gate.id, "evidence");
assert.equal(nextStep(evidenceStage, gatedOptions).gate, "evidence");
evidenceStage.approval.stamps.evidence = {
  approvedBy: "Sanjay Koju",
  approvedAt: "2026-09-17T00:00:00.000Z",
  digest: gateDigest(evidenceStage, gates[4]),
};
assert.equal(nextStep(evidenceStage, gatedOptions).action, "complete-task");
evidenceStage.stage = "complete";
assert.equal(nextStep(evidenceStage, gatedOptions).gate, "release");

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
assert.deepEqual(JSON.parse(contractResult.stdout).approvalGates, [
  "manifest",
  "scenarios",
  "plan",
  "test-cases",
  "evidence",
  "release",
]);
const nextGated = JSON.parse(nextResult.stdout);
assert.equal(nextGated.gate, "manifest");
const agentApprove = spawnSync(
  process.execPath,
  [path.join(HERE, "task-protocol.mjs"), "approve", "--manifest", manifestPath, "--gate", "manifest"],
  { encoding: "utf8", env: { ...process.env, CLAUDECODE: "1" } },
);
assert.equal(agentApprove.status, 2);
assert.match(agentApprove.stderr, /Agents cannot approve/);
const humanApprove = spawnSync(
  process.execPath,
  [path.join(HERE, "task-protocol.mjs"), "approve", "--manifest", manifestPath, "--gate", "manifest"],
  {
    encoding: "utf8",
    input: "yes\n",
    env: Object.fromEntries(
      Object.entries({ ...process.env, CLAUDECODE: "", CLAUDE_CODE: "", CURSOR_AGENT: "" })
        .filter(([, value]) => value !== ""),
    ),
  },
);
assert.equal(humanApprove.status, 0, humanApprove.stderr);
assert.equal(JSON.parse(humanApprove.stdout).gate, "manifest");
assert.equal(JSON.parse(humanApprove.stdout).approved, true);
const afterApprove = spawnSync(process.execPath, [path.join(HERE, "task-protocol.mjs"), "next", "--manifest", manifestPath], { encoding: "utf8" });
assert.equal(JSON.parse(afterApprove.stdout).gate, "scenarios");
rmSync(cliRoot, { recursive: true, force: true });


const hookProtocol = await import("../../.claude/hooks/lib/task-protocol.mjs");
const taskRoot = hookProtocol.taskRoot;
const savedProject = {
  CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR,
  CURSOR_PROJECT_DIR: process.env.CURSOR_PROJECT_DIR,
};
delete process.env.CLAUDE_PROJECT_DIR;
delete process.env.CURSOR_PROJECT_DIR;
try {
  const workspace = mkdtempSync(path.join(tmpdir(), "fhf-task-root-"));
  const e2e = path.join(workspace, "front-end-automation-e2e");
  mkdirSync(path.join(workspace, ".harness", "tasks"), { recursive: true });
  mkdirSync(path.join(e2e, ".harness"), { recursive: true });
  writeFileSync(path.join(workspace, ".harness", "lane.json"), JSON.stringify({ lane: "root" }));
  writeFileSync(path.join(e2e, ".harness", "lane.json"), JSON.stringify({ lane: "e2e" }));
  writeFileSync(path.join(e2e, ".harness", "workspace.local.json"), JSON.stringify({ consumerRoot: workspace }));
  assert.equal(taskRoot({}, path.join(e2e, "cypress")), workspace);
  assert.equal(taskRoot({}, workspace), workspace);

  const sibling = mkdtempSync(path.join(tmpdir(), "fhf-task-sibling-"));
  const lane = path.join(sibling, "e2e");
  const home = path.join(sibling, "FHF");
  mkdirSync(path.join(home, ".harness", "tasks"), { recursive: true });
  mkdirSync(path.join(lane, ".harness"), { recursive: true });
  writeFileSync(path.join(lane, ".harness", "lane.json"), JSON.stringify({ lane: "e2e" }));
  writeFileSync(path.join(lane, ".harness", "workspace.local.json"), JSON.stringify({ consumerRoot: home }));
  assert.equal(taskRoot({}, lane), home);
  const cli = spawnSync(process.execPath, [path.join(HERE, "task-protocol.mjs"), "path", "--ticket", "SERV-1"], {
    cwd: e2e,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: "", CURSOR_PROJECT_DIR: "" },
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).path, path.join(workspace, ".harness", "tasks", "SERV-1.json"));
  rmSync(workspace, { recursive: true, force: true });
  rmSync(sibling, { recursive: true, force: true });
} finally {
  for (const [key, value] of Object.entries(savedProject)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("Task protocol tests passed.");
