import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TASK_SCHEMA = "fhf-harness/task/v1";
export const TASK_STAGES = Object.freeze([
  "intake",
  "grounded",
  "planned",
  "approved",
  "implementing",
  "verified",
  "complete",
  "blocked",
]);
export const PROOF_MODES = Object.freeze([
  "red-green-replay",
  "existing-regression-base-pass",
  "external-execution-evidence",
  "tests-not-applicable",
]);
export const INTENT_VS_BUILT_CLASSIFICATIONS = Object.freeze([
  "same",
  "accepted",
  "defect",
  "parked",
  "ask-product",
]);
export const TEST_HONESTY = Object.freeze(["live", "stubbed", "seeded"]);

const DEFAULT_APPROVAL_FIELDS = Object.freeze([
  "ticketFamily",
  "grounding.jira.issueDigest",
  "grounding.intent",
  "grounding.acceptanceCriteriaDigest",
  "grounding.catalogVersion",
  "grounding.repositories",
  "grounding.intentVsBuilt",
  "selection",
  "plan",
]);

function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().flatMap((key) =>
        value[key] === undefined ? [] : [[key, normalized(value[key])]]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(normalized(value));
}

export function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function valueAt(object, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => current?.[key], object);
}

export function approvalPayload(manifest, fields = DEFAULT_APPROVAL_FIELDS) {
  return Object.fromEntries(fields.map((field) => [field, valueAt(manifest, field)]));
}

export function approvalDigest(manifest, fields = DEFAULT_APPROVAL_FIELDS) {
  return sha256(canonicalJson(approvalPayload(manifest, fields)));
}

export function approvalState(manifest, fields = DEFAULT_APPROVAL_FIELDS) {
  const currentDigest = approvalDigest(manifest, fields);
  const approvedDigest = manifest.approval?.approvedDigest ?? null;
  if (!manifest.approval?.required) return { state: "not-required", currentDigest };
  if (!approvedDigest) return { state: "missing", currentDigest };
  return {
    state: approvedDigest === currentDigest ? "current" : "stale",
    currentDigest,
    approvedDigest,
  };
}

function scenarioRefsPayload(manifest) {
  return (manifest.plan?.tests ?? []).map((test) => test?.scenarioRef ?? null);
}

export function gatePayload(manifest, gate) {
  const extract = gate?.extract ?? "fields";
  if (extract === "scenario-refs") return scenarioRefsPayload(manifest);
  if (extract !== "fields") {
    throw new Error(`unknown gate extract: ${extract}`);
  }
  return approvalPayload(manifest, gate?.boundFields ?? []);
}

export function gateDigest(manifest, gate) {
  return sha256(canonicalJson(gatePayload(manifest, gate)));
}

export function gateState(manifest, gate, {
  approvalFields = DEFAULT_APPROVAL_FIELDS,
  legacyGateId = "plan",
} = {}) {
  const currentDigest = gateDigest(manifest, gate);
  const stamp = manifest.approval?.stamps?.[gate.id] ?? null;
  if (stamp?.digest === currentDigest) {
    return { state: "current", currentDigest, stamp };
  }
  if (stamp?.digest) {
    return { state: "stale", currentDigest, approvedDigest: stamp.digest, stamp };
  }
  if (gate.id === legacyGateId && manifest.approval?.approvedDigest) {
    const legacy = approvalState(manifest, approvalFields);
    if (legacy.state === "current") {
      return { state: "current", currentDigest, stamp: null, via: "legacy-approvedDigest" };
    }
  }
  return { state: "missing", currentDigest, stamp: null };
}

export function requiredGates(gates = [], stage) {
  return gates.filter((gate) => (gate.requiredFrom ?? []).includes(stage));
}

export function firstPendingGate(manifest, gates, stage, options = {}) {
  for (const gate of requiredGates(gates, stage)) {
    const state = gateState(manifest, gate, options);
    if (state.state !== "current") return { gate, ...state };
  }
  return null;
}

export function stampGate(manifest, gate, { approvedBy, approvedAt }, {
  approvalFields = DEFAULT_APPROVAL_FIELDS,
  legacyGateId = "plan",
  gates,
} = {}) {
  if (typeof approvedBy !== "string" || !approvedBy.trim()) {
    throw new Error("approvedBy must be a non-empty string");
  }
  if (typeof approvedAt !== "string" || !Number.isFinite(Date.parse(approvedAt))) {
    throw new Error("approvedAt must be an ISO-8601 timestamp");
  }
  if (!Array.isArray(gates) || gates.length === 0) {
    throw new Error("gates must be a non-empty array");
  }
  if (!gate?.id || !gates.some((item) => item.id === gate.id)) {
    throw new Error(`unknown gate: ${gate?.id ?? "(missing)"}`);
  }
  const stage = manifest.stage;
  const stageGates = requiredGates(gates, stage);
  const gateIndex = stageGates.findIndex((item) => item.id === gate.id);
  if (gateIndex < 0) {
    throw new Error(`cannot stamp ${gate.id} at stage ${stage}`);
  }
  for (const prior of stageGates.slice(0, gateIndex)) {
    const state = gateState(manifest, prior, { approvalFields, legacyGateId });
    if (state.state !== "current") {
      throw new Error(`cannot stamp ${gate.id} before ${prior.id} is current`);
    }
  }
  const digest = gateDigest(manifest, gate);
  const approval = {
    ...manifest.approval,
    stamps: {
      ...(manifest.approval?.stamps ?? {}),
      [gate.id]: { approvedBy: approvedBy.trim(), approvedAt, digest },
    },
  };
  if (gate.id === legacyGateId) {
    approval.approvedDigest = approvalDigest(manifest, approvalFields);
  }
  return approval;
}

function validateStamps(manifest, gates = []) {
  const stamps = manifest.approval?.stamps;
  if (stamps === undefined) return [];
  if (!stamps || typeof stamps !== "object" || Array.isArray(stamps)) {
    return ["approval.stamps must be an object"];
  }
  const issues = [];
  const known = new Set(gates.map((gate) => gate.id).filter(Boolean));
  for (const [id, stamp] of Object.entries(stamps)) {
    if (known.size && !known.has(id)) issues.push(`approval.stamps.${id} is not a configured gate`);
    if (!stamp || typeof stamp !== "object" || Array.isArray(stamp)) {
      issues.push(`approval.stamps.${id} must be an object`);
      continue;
    }
    if (typeof stamp.approvedBy !== "string" || !stamp.approvedBy.trim()) {
      issues.push(`approval.stamps.${id}.approvedBy must be recorded`);
    }
    if (typeof stamp.approvedAt !== "string" || !Number.isFinite(Date.parse(stamp.approvedAt))) {
      issues.push(`approval.stamps.${id}.approvedAt must be an ISO-8601 timestamp`);
    }
    if (!/^[a-f0-9]{64}$/.test(stamp.digest ?? "")) {
      issues.push(`approval.stamps.${id}.digest must be a sha256 digest`);
    }
  }
  return issues;
}

export function dependencyCycles(changeUnits = []) {
  const dependencies = new Map(changeUnits.map((unit) => [unit.id, unit.dependsOn ?? []]));
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const cycles = [];

  function visit(id) {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      cycles.push([...stack.slice(start), id]);
      return;
    }
    if (visited.has(id) || !dependencies.has(id)) return;
    visiting.add(id);
    stack.push(id);
    for (const dependency of dependencies.get(id)) visit(dependency);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of dependencies.keys()) visit(id);
  return cycles;
}

function isRelativeSafePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)
    && !value.split(/[\\/]/).includes("..");
}

function validateGrounding(manifest, repoIds = []) {
  const issues = [];
  if (isLocalTask(manifest)) {
    if (!/^[a-f0-9]{64}$/.test(manifest.grounding?.intent?.digest ?? "")) {
      issues.push("grounding.intent.digest must be a sha256 digest of the recorded intent");
    }
  } else if (!/^[a-f0-9]{64}$/.test(manifest.grounding?.jira?.issueDigest ?? "")) {
    issues.push("grounding.jira.issueDigest must be a sha256 digest");
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.grounding?.acceptanceCriteriaDigest ?? "")) {
    issues.push("grounding.acceptanceCriteriaDigest must be a sha256 digest");
  }
  if (typeof manifest.grounding?.catalogVersion !== "string" || !manifest.grounding.catalogVersion) {
    issues.push("grounding.catalogVersion must be recorded");
  }
  const selectedRepos = manifest.grounding?.repositories ?? [];
  if (!Array.isArray(selectedRepos) || selectedRepos.length === 0) {
    issues.push("grounding.repositories must freeze at least one selected repository");
    return issues;
  }
  const selectedIds = new Set();
  for (const repo of selectedRepos) {
    if (!repo?.id || selectedIds.has(repo.id)) issues.push("selected repository IDs must be unique");
    selectedIds.add(repo?.id);
    if (repoIds.length && !repoIds.includes(repo?.id)) issues.push(`unknown repository: ${repo?.id}`);
    for (const field of ["baseSha", "headSha"]) {
      if (!/^[a-f0-9]{40}$/.test(repo?.[field] ?? "")) issues.push(`${repo?.id ?? "repository"}.${field} must be a full Git SHA`);
    }
    if (!Array.isArray(repo?.selectedPaths) || repo.selectedPaths.length === 0 || repo.selectedPaths.some((item) => !isRelativeSafePath(item))) {
      issues.push(`${repo?.id ?? "repository"}.selectedPaths must contain at least one safe relative path`);
    }
  }
  return issues;
}

export function validateIntentVsBuilt(manifest, { allowAskProduct = false } = {}) {
  const issues = [];
  const classification = manifest?.grounding?.intentVsBuilt;
  if (!classification || typeof classification !== "object" || Array.isArray(classification)) {
    return ["grounding.intentVsBuilt must classify Jira intent against shipped source"];
  }
  const rows = classification.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return ["grounding.intentVsBuilt.rows must contain at least one acceptance-criterion comparison"];
  }
  const ids = new Set();
  for (const row of rows) {
    if (!row?.id || ids.has(row.id)) issues.push("intentVsBuilt row IDs must be unique");
    ids.add(row?.id);
    const label = row?.id ?? "intentVsBuilt row";
    if (typeof row.intent !== "string" || !row.intent.trim()) issues.push(`${label}.intent must be recorded`);
    if (typeof row.built !== "string" || !row.built.trim()) issues.push(`${label}.built must be recorded`);
    if (!INTENT_VS_BUILT_CLASSIFICATIONS.includes(row.classification)) {
      issues.push(`${label}.classification must be same|accepted|defect|parked|ask-product`);
    }
    if (row.classification === "accepted" && (typeof row.acceptedBy !== "string" || !row.acceptedBy.trim())) {
      issues.push(`${label} accepted rows must record acceptedBy`);
    }
    if (row.classification === "parked" && !/^SERV-\d+$/.test(row.parkedOn ?? "")) {
      issues.push(`${label} parked rows must name parkedOn SERV ticket`);
    }
    if (!allowAskProduct && row.classification === "ask-product") {
      issues.push(`${label} ask-product rows block planning until product classifies the delta`);
    }
  }
  return issues;
}

function intentVsBuiltRowIds(manifest) {
  return new Set((manifest?.grounding?.intentVsBuilt?.rows ?? []).map((row) => row?.id).filter(Boolean));
}

export const SCENARIO_REGISTRIES = Object.freeze([
  "spec-test-scenario-groups",
  "regression-checklist",
]);

// Scenario and test-data binding. Scenarios are NOT restated here. Two registries already own
// them and they are not interchangeable: the application spec repo owns product behaviour as
// test_scenario_groups[].prefix + covers, while a sprint regression checklist owns execution rows
// (canaries, baselines, latency measurements) that are deliberately not module business rules.
// A manifest cites whichever one actually owns the scenario. Resolving the citation needs the
// filesystem and lives in the CLI. Requirement linkage stays on acceptanceIds -> intentVsBuilt.
function validateTestCaseBinding(manifest, frontendTestData) {
  const issues = [];
  const frontendRepositories = new Set(frontendTestData?.repositories ?? []);
  const allowedDataSources = new Set(frontendTestData?.allowedSources ?? []);
  const forbiddenDataSources = new Set(frontendTestData?.forbiddenSources ?? []);
  if (manifest.plan?.scenarios !== undefined) {
    issues.push("plan.scenarios is retired; cite a registry via plan.tests[].scenarioRef");
  }
  for (const test of manifest.plan?.tests ?? []) {
    if (test.proofMode === "tests-not-applicable") continue;
    const label = test.id ?? "test";

    if (test.scenarioIds !== undefined) {
      issues.push(`${label}.scenarioIds is retired; use scenarioRef { registry, source, group }`);
    }
    const ref = test.scenarioRef;
    if (!ref || typeof ref !== "object") {
      issues.push(`${label}.scenarioRef must cite the registry that owns the scenario`);
    } else {
      if (!SCENARIO_REGISTRIES.includes(ref.registry)) {
        issues.push(`${label}.scenarioRef.registry must be one of ${SCENARIO_REGISTRIES.join(', ')}`);
      }
      if (!isRelativeSafePath(ref.source)) {
        issues.push(`${label}.scenarioRef.source must be a repo-relative path to the registry file`);
      }
      if (typeof ref.group !== "string" || !ref.group.trim()) {
        issues.push(`${label}.scenarioRef.group must name the scenario group or row`);
      }
      // covers only means something for spec groups; checklist rows are single scenarios.
      if (ref.registry === "spec-test-scenario-groups") {
        if (!Array.isArray(ref.covers) || ref.covers.length === 0
            || ref.covers.some((id) => typeof id !== "string" || !id.trim())) {
          issues.push(`${label}.scenarioRef.covers must list the rule IDs the group covers`);
        }
      } else if (ref.covers !== undefined) {
        issues.push(`${label}.scenarioRef.covers applies only to spec-test-scenario-groups`);
      }
    }

    const data = test.testData;
    if (!data || typeof data !== "object") {
      issues.push(`${label}.testData must reference a fixture key or record { none: "<reason>" }`);
    } else if (typeof data.none === "string") {
      if (!data.none.trim()) issues.push(`${label}.testData.none must give a reason`);
    } else if ((data.fixture !== undefined || data.key !== undefined)
        && (!isRelativeSafePath(data.fixture) || typeof data.key !== "string" || !data.key.trim())) {
      // A key without a path is a half-written fixture reference, not a choice of another source.
      // Telling that author they "must reference a fixture key" names the one thing they did do.
      issues.push(`${label}.testData needs a repo-relative fixture path and a non-empty key`);
    } else if (data.fixture === undefined
        && !["synthetic-builder", "api-seed"].includes(data.source)) {
      issues.push(`${label}.testData must reference a fixture key, synthetic builder, API seed, or record { none: "<reason>" }`);
    } else if (data.resolver !== undefined && (typeof data.resolver !== "string" || !data.resolver.trim())) {
      issues.push(`${label}.testData.resolver must be the command that reads the key`);
    } else if (["synthetic-builder", "api-seed"].includes(data.source)
        && (typeof data.resolver !== "string" || !data.resolver.trim())) {
      issues.push(`${label}.testData.resolver must name the builder or seed command`);
    }
    if (frontendRepositories.has(test.repoId) && data && typeof data === "object") {
      const source = data.source ?? (data.fixture ? "fixture-key" : data.none ? "hermetic-inline" : null);
      if (!source || !allowedDataSources.has(source) || forbiddenDataSources.has(source)) {
        issues.push(`${label}.testData.source must be allowed by qualityAssurance.frontendTestData`);
      }
      if (data.persistentMutation === true) {
        for (const field of frontendTestData?.persistentMutationRequires ?? []) {
          if (typeof data[field] !== "string" || !data[field].trim()) {
            issues.push(`${label}.testData.${field} must record persistent-mutation evidence`);
          }
        }
      }
    }
  }
  return issues;
}

function validateTestHonesty(manifest) {
  const issues = [];
  const knownRows = intentVsBuiltRowIds(manifest);
  for (const test of manifest.plan?.tests ?? []) {
    const acceptanceIds = test.acceptanceIds;
    if (acceptanceIds !== undefined) {
      if (!Array.isArray(acceptanceIds) || acceptanceIds.length === 0
          || acceptanceIds.some((id) => typeof id !== "string" || !id.trim())) {
        issues.push(`${test.id ?? "test"}.acceptanceIds must be a non-empty string array`);
      } else {
        for (const id of acceptanceIds) {
          if (!knownRows.has(id)) {
            issues.push(`${test.id ?? "test"} acceptanceIds references unknown intentVsBuilt row ${id}`);
          }
        }
      }
    }
    if (test.proofMode === "external-execution-evidence") {
      if (!TEST_HONESTY.includes(test.honesty)) {
        issues.push(`${test.id ?? "test"}.honesty must be live|stubbed|seeded`);
      }
      if (!Array.isArray(acceptanceIds) || acceptanceIds.length === 0) {
        issues.push(`${test.id ?? "test"} must bind acceptanceIds when proof is external`);
      }
    }
  }
  return issues;
}

export function missingAcceptanceOracleCoverage(manifest) {
  const tests = manifest?.plan?.tests ?? [];
  return (manifest?.grounding?.intentVsBuilt?.rows ?? []).flatMap((row) => {
    if (!["same", "accepted"].includes(row?.classification)) return [];
    const hasIndependentOracle = tests.some((test) =>
      (test.acceptanceIds ?? []).includes(row.id)
      && test.proofMode === "external-execution-evidence"
      && (test.honesty === "live" || test.honesty === "seeded"));
    return hasIndependentOracle ? [] : [row.id];
  });
}

export function intentVsBuiltDefects(manifest) {
  return (manifest?.grounding?.intentVsBuilt?.rows ?? [])
    .filter((row) => row?.classification === "defect")
    .map((row) => row.id);
}

export function missingVerificationEvidence(manifest) {
  const artifacts = Array.isArray(manifest.evidence?.artifacts) ? manifest.evidence.artifacts : [];
  const repositories = new Map(
    (manifest.grounding?.repositories ?? []).map((repository) => [repository.id, repository]),
  );
  return (manifest.plan?.tests ?? []).flatMap((test) => {
    if (test.proofMode === "tests-not-applicable") return [];
    const expectedRevision = repositories.get(test.repoId)?.headSha;
    const evidence = artifacts.find((item) =>
      item.testId === test.id
      && item.runnerId === test.runnerId
      && item.proofMode === test.proofMode
      && item.result === "passed"
      && item.testPath === test.path
      && item.revision === expectedRevision
      && item.environment === test.environment
      && typeof item.artifact === "string"
      && item.artifact.length > 0
      && /^[a-f0-9]{64}$/.test(item.artifactDigest ?? "")
      && Number.isInteger(item.counts?.tests)
      && item.counts.tests > 0
      && item.counts.failures === 0
      && item.counts.errors === 0
      && typeof item.completedAt === "string"
      && Number.isFinite(Date.parse(item.completedAt)));
    return evidence ? [] : [test.id];
  });
}

export function selectProofMode({
  testKind,
  environment = "local",
  hermetic = false,
  changeClass = "behavior",
  existingCoverage = false,
} = {}) {
  if (changeClass === "metadata" || changeClass === "chore") {
    return "tests-not-applicable";
  }
  if (environment === "production" || [
    "cypress-e2e",
    "cypress-smoke",
    "api-integration",
    "oracle-integration",
    "third-party-integration",
  ].includes(testKind)) {
    return "external-execution-evidence";
  }
  if (hermetic && ["unit", "component", "service-contract"].includes(testKind)) {
    return existingCoverage ? "existing-regression-base-pass" : "red-green-replay";
  }
  return "external-execution-evidence";
}

function validateExecutionBudget(manifest, policy) {
  const issues = [];
  const budget = manifest.plan?.executionBudget;
  if (!policy || typeof policy !== "object") return ["execution budget policy is unavailable"];
  if (!budget || typeof budget !== "object" || Array.isArray(budget)) {
    return [`${policy.manifestPath ?? "plan.executionBudget"} must be an object`];
  }
  for (const field of policy.requiredFields ?? []) {
    const value = budget[field];
    const ceiling = policy.hardCeilings?.[field];
    if (!Number.isInteger(value) || value < 1) {
      issues.push(`${policy.manifestPath ?? "plan.executionBudget"}.${field} must be a positive integer`);
    } else if (!Number.isInteger(ceiling) || ceiling < 1 || value > ceiling) {
      issues.push(`${policy.manifestPath ?? "plan.executionBudget"}.${field} exceeds its configured hard ceiling`);
    }
  }
  return issues;
}

function validateCapabilities(manifest, policy, runners) {
  if (!policy || typeof policy !== "object") return ["capability control policy is unavailable"];
  const issues = [];
  const selected = manifest.plan?.capabilities;
  if (!Array.isArray(selected) || selected.length === 0) return [`${policy.manifestPath ?? "plan.capabilities"} must select required capabilities`];
  const known = new Set(Object.keys(policy.capabilities ?? {}));
  const selectedIds = new Set();
  for (const capability of selected) {
    if (!capability?.id || selectedIds.has(capability.id)) issues.push("plan.capabilities IDs must be unique");
    selectedIds.add(capability?.id);
    if (!known.has(capability?.id)) issues.push(`unknown capability: ${capability?.id}`);
    if (typeof capability?.subject !== "string" || !capability.subject.trim()) issues.push(`${capability?.id ?? "capability"}.subject must be recorded`);
    if (capability?.status !== "ready") issues.push(`${capability?.id ?? "capability"}.status must be ready before planning`);
    if (typeof capability?.evidenceRef !== "string" || !capability.evidenceRef.trim()) issues.push(`${capability?.id ?? "capability"}.evidenceRef must identify the observed probe or approved fallback`);
  }
  const required = new Set(policy.taskRequiredCapabilities ?? []);
  for (const test of manifest.plan?.tests ?? []) {
    for (const id of runners[test.runnerId]?.requiredCapabilities ?? []) required.add(id);
  }
  for (const id of required) if (!selectedIds.has(id)) issues.push(`plan.capabilities must include required capability: ${id}`);
  return issues;
}

function validateCrossRepositorySeams(changeUnits, policy) {
  if (!policy || typeof policy !== "object") return [];
  const frontend = new Set(policy.frontendRepositories ?? []);
  const backend = new Set(policy.backendRepositories ?? []);
  const selected = new Set(changeUnits.map((unit) => unit.repoId));
  if (![...selected].some((repo) => frontend.has(repo))
      || ![...selected].some((repo) => backend.has(repo))) return [];

  const issues = [];
  const concrete = [];
  for (const unit of changeUnits.filter((item) => frontend.has(item.repoId) || backend.has(item.repoId))) {
    const seam = unit.seam;
    if (!seam || typeof seam !== "object") {
      issues.push(`${unit.id ?? "change unit"}.seam must bind frontend and backend coverage`);
      continue;
    }
    if (seam.status === policy.notApplicableStatus) {
      const evidence = seam[policy.notApplicableEvidenceField];
      if (typeof evidence !== "string" || !evidence.trim()) {
        issues.push(`${unit.id}.seam ${policy.notApplicableStatus} requires evidence`);
      }
      continue;
    }
    const missing = (policy.requiredFields ?? []).filter(
      (field) => typeof seam[field] !== "string" || !seam[field].trim(),
    );
    if (missing.length > 0) issues.push(`${unit.id}.seam is missing ${missing.join(", ")}`);
    else concrete.push({ unit: unit.id, seam });
  }

  if (concrete.length > 1) {
    const fields = policy.requiredFields ?? [];
    const expected = concrete[0];
    for (const item of concrete.slice(1)) {
      if (fields.some((field) => item.seam[field] !== expected.seam[field])) {
        issues.push(
          `${item.unit}.seam must match ${expected.unit}.seam on ${fields.join(" and ")}`,
        );
      }
    }
  }
  return issues;
}

export function validateTaskManifest(manifest, {
  repoIds = [],
  bundleIds = [],
  runnerIds = [],
  runners = {},
  executionBudget,
  capabilityControl,
  crossRepositorySeam,
  frontendTestData,
  gates = [],
} = {}) {
  const issues = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["task manifest must be an object"];
  }
  if (manifest.schema !== TASK_SCHEMA) issues.push(`schema must be ${TASK_SCHEMA}`);
  if (typeof manifest.id !== "string" || !manifest.id) issues.push("id must be a non-empty string");
  if (!TASK_STAGES.includes(manifest.stage)) issues.push("stage is not recognized");
  issues.push(...taskIdentityIssues(manifest));
  issues.push(...validateGrounding(manifest, repoIds));
  issues.push(...validateIntentVsBuilt(manifest));

  const graphNodes = manifest.selection?.graphNodes;
  if (!Array.isArray(graphNodes) || graphNodes.length === 0) {
    issues.push("selection.graphNodes must contain the task-scoped graph slice");
  }
  if (typeof manifest.selection?.routeId !== "string" || !manifest.selection.routeId ||
      !Array.isArray(manifest.selection?.sourceBundles) || manifest.selection.sourceBundles.length === 0 ||
      !Array.isArray(manifest.selection?.expansionReasons)) {
    issues.push("selection must record routeId, sourceBundles, and expansionReasons");
  }
  // The bundle catalog is a superset of the routed bundles on purpose: a route pre-seeds the
  // common cases, and the manifest selects directly for everything else (frontend-change,
  // letters-workflow and repossession-workflow have no route at all). check-docs-links validates
  // route -> bundle in one direction only, so without this the authoritative selection was the
  // one place a bundle id was never checked and a typo passed every gate.
  if (bundleIds.length) {
    for (const bundleId of manifest.selection?.sourceBundles ?? []) {
      if (!bundleIds.includes(bundleId)) issues.push(`unknown source bundle: ${bundleId}`);
    }
  }
  const changeUnits = manifest.plan?.changeUnits ?? [];
  if (!Array.isArray(changeUnits) || changeUnits.length === 0) {
    issues.push("plan.changeUnits must not be empty");
  } else {
    const unitIds = new Set(changeUnits.map((unit) => unit.id));
    for (const unit of changeUnits) {
      if (!unit.id || !unit.repoId) issues.push("each change unit needs id and repoId");
      if (repoIds.length && !repoIds.includes(unit.repoId)) issues.push(`unknown change-unit repository: ${unit.repoId}`);
      if (!Array.isArray(unit.paths) || unit.paths.some((item) => !isRelativeSafePath(item))) {
        issues.push(`${unit.id ?? "change unit"}.paths must contain safe relative paths`);
      }
      for (const dependency of unit.dependsOn ?? []) {
        if (!unitIds.has(dependency)) issues.push(`${unit.id} depends on unknown change unit ${dependency}`);
      }
    }
    for (const cycle of dependencyCycles(changeUnits)) issues.push(`change-unit dependency cycle: ${cycle.join(" -> ")}`);
    issues.push(...validateCrossRepositorySeams(changeUnits, crossRepositorySeam));
  }

  issues.push(...validateExecutionBudget(manifest, executionBudget));

  const tests = manifest.plan?.tests ?? [];
  if (!Array.isArray(tests) || tests.length === 0) {
    issues.push("plan.tests must declare verification or an explicit not-applicable record");
  } else {
    for (const test of tests) {
      if (!test.id || !test.runnerId) issues.push("each test needs id and runnerId");
      if (runnerIds.length && !runnerIds.includes(test.runnerId)) issues.push(`unknown runner: ${test.runnerId}`);
      if (!PROOF_MODES.includes(test.proofMode)) issues.push(`${test.id ?? "test"}.proofMode is not recognized`);
      if (test.proofMode === "tests-not-applicable" && !test.reason) {
        issues.push(`${test.id ?? "test"} needs a reason when tests are not applicable`);
      } else if (test.proofMode !== "tests-not-applicable") {
        if (!test.repoId || !isRelativeSafePath(test.path)) {
          issues.push(`${test.id ?? "test"} must select repoId and a safe relative test path`);
        }
        if (typeof test.environment !== "string" || !test.environment) {
          issues.push(`${test.id ?? "test"}.environment must be recorded`);
        }
        const runner = runners[test.runnerId];
        const runnerRepos = runner ? (runner.repositories ?? [runner.repository]).filter(Boolean) : [];
        if (runnerRepos.length > 0 && !runnerRepos.includes(test.repoId)) {
          issues.push(`${test.id ?? "test"} selects repository ${test.repoId} outside runner ${test.runnerId}`);
        }
        if (Array.isArray(runner?.environments) && !runner.environments.includes(test.environment)) {
          issues.push(`${test.id ?? "test"} selects environment ${test.environment} outside runner ${test.runnerId}`);
        }
      }
    }
  }

  if (!Array.isArray(manifest.plan?.impact?.functional) ||
      !Array.isArray(manifest.plan?.impact?.regression) ||
      !Array.isArray(manifest.plan?.impact?.smoke)) {
    issues.push("plan.impact must classify functional, regression, and smoke scope");
  }
  if (typeof manifest.approval?.required !== "boolean") issues.push("approval.required must be boolean");
  issues.push(...validateStamps(manifest, gates));
  if (!Array.isArray(manifest.evidence?.artifacts)) issues.push("evidence.artifacts must be an array");
  issues.push(...validateTestHonesty(manifest));
  issues.push(...validateTestCaseBinding(manifest, frontendTestData));
  issues.push(...validateCapabilities(manifest, capabilityControl, runners));
  return [...new Set(issues)];
}

export function nextStep(manifest, options = {}) {
  if (manifest?.stage === "blocked") {
    return { action: "resolve-blocker", stage: "blocked", blocked: true, issues: [] };
  }
  const identityIssues = [];
  if (manifest?.schema !== TASK_SCHEMA) identityIssues.push(`schema must be ${TASK_SCHEMA}`);
  if (typeof manifest?.id !== "string" || !manifest.id) identityIssues.push("id must be a non-empty string");
  if (!TASK_STAGES.includes(manifest?.stage)) identityIssues.push("stage is not recognized");
  identityIssues.push(...taskIdentityIssues(manifest));
  if (identityIssues.length) {
    return { action: "repair-task-manifest", stage: manifest?.stage ?? null, blocked: true, issues: identityIssues };
  }
  if (manifest.stage === "intake") {
    return { action: "ground-task", stage: "intake", blocked: false };
  }
  if (manifest.stage === "grounded") {
    const groundingIssues = validateGrounding(manifest, options.repoIds);
    if (!Array.isArray(manifest.selection?.graphNodes) || manifest.selection.graphNodes.length === 0) groundingIssues.push("selected graph nodes are missing");
    if (groundingIssues.length) {
      return { action: "repair-task-manifest", stage: "grounded", blocked: true, issues: groundingIssues };
    }
    const classifyIssues = validateIntentVsBuilt(manifest);
    return classifyIssues.length
      ? { action: "classify-intent-vs-built", stage: "grounded", blocked: true, issues: classifyIssues }
      : { action: "plan-cross-repository-change", stage: "grounded", blocked: false };
  }

  const issues = validateTaskManifest(manifest, options);
  if (issues.length) return { action: "repair-task-manifest", stage: manifest?.stage ?? null, blocked: true, issues };

  const approval = approvalState(manifest, options.approvalFields);
  const gateOptions = {
    approvalFields: options.approvalFields,
    legacyGateId: options.legacySingleDigestSatisfies ?? "plan",
  };
  const gates = options.gates ?? [];
  const pendingGate = gates.length && manifest.approval?.required
    ? firstPendingGate(manifest, gates, manifest.stage, gateOptions)
    : null;
  if (pendingGate) {
    return {
      action: pendingGate.state === "stale" ? "refresh-human-approval" : "await-human-approval",
      stage: manifest.stage,
      blocked: true,
      gate: pendingGate.gate.id,
      label: pendingGate.gate.label ?? pendingGate.gate.id,
      approval,
      pending: {
        id: pendingGate.gate.id,
        state: pendingGate.state,
        currentDigest: pendingGate.currentDigest,
      },
    };
  }
  if (!gates.length
      && ["planned", "approved", "implementing", "verified", "complete"].includes(manifest.stage)
      && manifest.approval?.required && approval.state !== "current") {
    return {
      action: approval.state === "stale" ? "refresh-human-approval" : "await-human-approval",
      stage: manifest.stage,
      blocked: true,
      approval,
    };
  }

  if (["verified", "complete"].includes(manifest.stage)) {
    const defects = intentVsBuiltDefects(manifest);
    if (defects.length > 0) {
      return {
        action: "resolve-intent-vs-built-defect",
        stage: manifest.stage,
        blocked: true,
        defects,
        approval,
      };
    }
    const missingOracles = missingAcceptanceOracleCoverage(manifest);
    if (missingOracles.length > 0) {
      return {
        action: "collect-native-verification-evidence",
        stage: manifest.stage,
        blocked: false,
        missingOracles,
        approval,
      };
    }
    const missingEvidence = missingVerificationEvidence(manifest);
    if (missingEvidence.length > 0) {
      return {
        action: "collect-native-verification-evidence",
        stage: manifest.stage,
        blocked: false,
        missingEvidence,
        approval,
      };
    }
  }

  const plannedAction = gates.length
    ? "begin-implementation"
    : (manifest.approval?.required ? "record-human-approval" : "begin-implementation");
  const actions = {
    intake: "ground-task",
    grounded: "plan-cross-repository-change",
    planned: plannedAction,
    approved: "begin-implementation",
    implementing: "collect-native-verification-evidence",
    verified: "complete-task",
    complete: "none",
  };
  return { action: actions[manifest.stage], stage: manifest.stage, blocked: false, approval };
}

// ADR-0043. A task is a Jira family (ticketFamily.primary = SERV-n) or a local task
// (ticketFamily.source = "local") identified by its title. Both live at manifestPath.
export function isLocalTask(manifest) {
  return manifest?.ticketFamily?.source === "local";
}

export function taskIdentityIssues(manifest) {
  if (isLocalTask(manifest)) {
    return typeof manifest.title === "string" && manifest.title.trim()
      ? []
      : ["a local task (ticketFamily.source=local) must record a title"];
  }
  return /^SERV-\d+$/.test(manifest?.ticketFamily?.primary ?? "")
    ? []
    : ["ticketFamily.primary must be a SERV ticket"];
}

export function taskSlug(title) {
  return String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
}

// ADR-0043. Which manifest is active is resolved from the work, not exported per shell.
// Order: the explicit env override, then the focus the prompt router recorded.
const TASK_KEY = /\bSERV-\d+\b/i;
const TERMINAL_STAGES = new Set(["complete", "blocked"]);
const STOP_TERMS = new Set(
  "the and for with from into this that are was were has have not but its our your their via add fix use make update task".split(" "),
);

function activeTaskPolicy(config) {
  return config?.engineering?.taskProtocol?.activeTask ?? {};
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// One resolver for hooks and the CLI. Lane names come from paths.lanes.
// A lane checkout is not a second task home: the manifest stays in the FHF workspace.
export function taskRoot(payload = {}, cwd = "", config = null) {
  const lanes = new Set(Object.keys(config?.paths?.lanes ?? {}));
  const setupFile = config?.workspaceContract?.setupFile ?? ".harness/workspace.local.json";
  const start = path.resolve(
    process.env.CLAUDE_PROJECT_DIR
      ?? process.env.CURSOR_PROJECT_DIR
      ?? payload?.cwd
      ?? (cwd || process.cwd()),
  );
  const laneOf = (dir) => {
    const lane = readJsonFile(path.join(dir, ".harness", "lane.json"))?.lane;
    return typeof lane === "string" ? lane : null;
  };
  const consumerOf = (dir) => {
    const raw = readJsonFile(path.join(dir, setupFile))?.consumerRoot;
    if (typeof raw !== "string" || !raw.trim()) return null;
    const resolved = path.resolve(dir, raw.trim());
    return fs.existsSync(resolved) ? resolved : null;
  };
  let current = start;
  let laneCheckout = null;
  while (true) {
    const lane = laneOf(current);
    if (lane === "root") return current;
    if (lanes.has(lane)) {
      laneCheckout = current;
      const consumer = consumerOf(current);
      if (consumer && path.resolve(consumer) !== path.resolve(current)) return consumer;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (laneCheckout) {
    const parent = path.dirname(laneCheckout);
    if (laneOf(parent) === "root" || fs.existsSync(taskDirectory(parent, config))) return parent;
  }
  return start;
}

export function taskDirectory(root, config) {
  const pattern = config?.engineering?.taskProtocol?.manifestPath ?? ".harness/tasks/<task-id>.json";
  return path.resolve(root, path.dirname(pattern));
}

export function canonicalTaskPath(root, config, { ticket, title } = {}) {
  const id = ticket ? String(ticket).toUpperCase() : taskSlug(title);
  return id ? path.join(taskDirectory(root, config), `${id}.json`) : null;
}

export function listTaskManifests(root, config) {
  const dir = taskDirectory(root, config);
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".json") && !name.startsWith("."))
    .flatMap((name) => {
      const file = path.join(dir, name);
      try {
        const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
        return manifest?.schema === TASK_SCHEMA ? [{ file, manifest }] : [];
      } catch {
        return [];
      }
    });
}

function preferOpen(entries) {
  const open = entries.filter((entry) => !TERMINAL_STAGES.has(entry.manifest.stage));
  return open.length ? open : entries;
}

function matchByTicket(entries, key) {
  const primary = preferOpen(entries.filter((entry) =>
    String(entry.manifest.ticketFamily?.primary ?? "").toUpperCase() === key));
  if (primary.length === 1) return { match: primary[0], candidates: primary };
  if (primary.length > 1) return { match: null, candidates: primary };
  const related = preferOpen(entries.filter((entry) =>
    (entry.manifest.ticketFamily?.related ?? []).some((item) => String(item).toUpperCase() === key)));
  return { match: related.length === 1 ? related[0] : null, candidates: related, via: "related" };
}

function terms(text) {
  return new Set(String(text ?? "").toLowerCase().split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP_TERMS.has(word)));
}

// ponytail: shared-term overlap against manifest titles, not semantic search. It only has to
// separate a handful of open manifests; upgrade to a ranked index if tasks number in the hundreds.
function matchByTitle(entries, text, { minSharedTerms = 3, minCoverage = 0.6 } = {}) {
  const wanted = terms(text);
  const scored = entries
    .map((entry) => {
      const titleTerms = terms(entry.manifest.title);
      let shared = 0;
      for (const word of titleTerms) if (wanted.has(word)) shared += 1;
      return { ...entry, shared, coverage: titleTerms.size ? shared / titleTerms.size : 0 };
    })
    .filter((entry) => entry.shared >= minSharedTerms && entry.coverage >= minCoverage)
    .sort((a, b) => b.coverage - a.coverage || b.shared - a.shared);
  const best = preferOpen(scored.filter((entry) =>
    entry.coverage === scored[0]?.coverage && entry.shared === scored[0]?.shared));
  return { match: best.length === 1 ? best[0] : null, candidates: scored.slice(0, 5) };
}

// An answer to the task question: every keyword the owner gave appears in one manifest's title or id.
function matchByKeyword(entries, text) {
  const wanted = [...terms(text)];
  if (!wanted.length) return { match: null, candidates: [] };
  const hits = preferOpen(entries.filter((entry) => {
    const own = terms(`${entry.manifest.title ?? ""} ${entry.manifest.id ?? ""}`);
    return wanted.every((word) => own.has(word));
  }));
  return { match: hits.length === 1 ? hits[0] : null, candidates: hits.slice(0, 5) };
}

// lenient: the owner is answering the task question, so a bare keyword is enough to select.
export function resolveTaskFromText({ root, config, text, lenient = false }) {
  const entries = listTaskManifests(root, config);
  const value = String(text ?? "");
  const named = (value.match(/[\w.-]+\.json\b/gi) ?? []).map((name) => name.toLowerCase());
  const byFile = entries.filter((entry) => named.includes(path.basename(entry.file).toLowerCase()));
  if (byFile.length === 1) return { kind: "file", match: byFile[0], candidates: byFile };
  const key = value.match(TASK_KEY)?.[0]?.toUpperCase();
  if (key) {
    return { kind: "jira", key, ...matchByTicket(entries, key), suggestedPath: canonicalTaskPath(root, config, { ticket: key }) };
  }
  const byTitle = matchByTitle(entries, value, activeTaskPolicy(config).titleMatch);
  if (byTitle.match || !lenient) return { kind: "title", ...byTitle };
  return {
    kind: "keyword",
    ...matchByKeyword(entries, value),
    suggestedPath: canonicalTaskPath(root, config, { title: value }),
  };
}

// ADR-0043. What the owner is asked when the harness's own search finds no task. One question,
// three answers; the reply is matched by the prompt router on the next turn.
export function taskQuestion({ root, config, searched = [], key = null }) {
  const open = preferOpen(listTaskManifests(root, config))
    .filter((entry) => !TERMINAL_STAGES.has(entry.manifest.stage))
    .slice(0, 8)
    .map((entry) => path.basename(entry.file));
  const lines = [
    `TASK NEEDED: no task manifest selects this automation work${key ? ` (${key} has no manifest yet)` : ""}.`,
    `Searched: ${searched.length ? searched.join("; ") : "prompt focus"}.`,
    "Ask the owner in this turn, as one question with these options. Do not guess, create, or switch a task yourself:",
    "  1. Jira task: reply with the SERV key (e.g. SERV-12669).",
    `  2. Existing manifest: reply with its file name${open.length ? ` (open: ${open.join(", ")})` : ""}.`,
    "  3. Not in Jira: reply with a keyword or the task title; it is matched to manifest titles, or named",
    "     .harness/tasks/<title-slug>.json to create.",
  ];
  return lines.join("\n");
}

export function taskFocusPath(root, config) {
  return path.resolve(root, activeTaskPolicy(config).focusFile ?? ".harness/tasks/.focus.json");
}

export function readTaskFocus(root, config) {
  try {
    return JSON.parse(fs.readFileSync(taskFocusPath(root, config), "utf8"));
  } catch {
    return null;
  }
}

// A root with no task directory has no tasks to focus, so nothing is written there.
export function writeTaskFocus(root, config, focus) {
  const file = taskFocusPath(root, config);
  if (!fs.existsSync(path.dirname(file))) return false;
  fs.writeFileSync(file, `${JSON.stringify(focus, null, 2)}\n`, "utf8");
  return true;
}

export function focusFromResolution(resolution, at = new Date().toISOString()) {
  if (resolution.match) {
    return {
      id: resolution.match.manifest.id,
      file: path.basename(resolution.match.file),
      source: resolution.kind,
      key: resolution.key ?? null,
      at,
    };
  }
  return { id: null, file: null, source: resolution.kind, key: resolution.key ?? null, at };
}

// A focus belongs to the session that set it (one session, one job). A caller with no session
// (the CLI, the backend runner) accepts any focus.
export function sessionFocus(root, config, sessionId = null) {
  const focus = readTaskFocus(root, config);
  if (focus?.sessionId && sessionId && focus.sessionId !== sessionId) return null;
  return focus;
}

export function resolveActiveTask({ root, config, env = process.env, sessionId = null }) {
  const envName = config?.engineering?.taskProtocol?.activeManifestEnv;
  const explicit = envName ? String(env[envName] ?? "").trim() : "";
  if (explicit) return { source: "env", envName, file: explicit };
  const focus = sessionFocus(root, config, sessionId);
  if (focus?.file) {
    const dir = taskDirectory(root, config);
    const file = path.resolve(dir, String(focus.file));
    // The focus names a file inside the task directory, never a path elsewhere.
    if (path.dirname(file) === dir) return { source: "focus", envName, file, focus };
  }
  return { source: null, envName, file: null, focus };
}

// ADR-0044. Every prompt is a task. A prompt that names no SERV ticket is a quick task: its
// intent is the prompt, it needs one owner confirm, and it carries no Jira grounding or gates.
const AFFIRMATIVE = /^\s*(?:y|yes|yep|yeah|ok|okay|sure|confirm(?:ed)?|approve(?:d)?|go(?: ahead)?|proceed|do it|lgtm)\b/i;
const NEGATIVE = /^\s*(?:n|no|nope|cancel|stop|don't|do not)\b/i;
const SHORT_REPLY = /^\s*(?:y|yes|yep|yeah|ok|okay|sure|confirm(?:ed)?|approve(?:d)?|go(?: ahead)?|proceed|do it|lgtm|continue|next|n|no|nope|cancel|stop|thanks|thank you)\b[\s.!,]*$/i;

export function isAffirmative(text) {
  return AFFIRMATIVE.test(String(text ?? ""));
}

export function isNegative(text) {
  return NEGATIVE.test(String(text ?? ""));
}

// A prompt that asks for work, as opposed to a reply such as "yes" or "continue".
export function isInstruction(text) {
  const value = String(text ?? "").trim();
  return value.length >= 8 && !SHORT_REPLY.test(value);
}

export function quickTaskDirectory(root, config) {
  return path.resolve(root, activeTaskPolicy(config).quick?.directory ?? ".harness/tasks/quick");
}

export function quickTaskFor(root, config, instruction) {
  const text = String(instruction?.text ?? "").trim();
  const digest = sha256(text);
  const id = `quick-${taskSlug(text).slice(0, 40).replace(/-+$/, "")}-${digest.slice(0, 8)}`;
  return { id, digest, title: text.slice(0, 120), file: path.join(quickTaskDirectory(root, config), `${id}.json`) };
}

export function readQuickTask(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// The quick task file is the record (intent, touched paths). Its confirmation lives in the
// governance-protected focus, so editing this file cannot authorize anything.
export function recordQuickTask(root, config, quick, { instruction, touched = null } = {}) {
  if (!fs.existsSync(taskDirectory(root, config))) return false;
  fs.mkdirSync(path.dirname(quick.file), { recursive: true });
  const existing = readQuickTask(quick.file) ?? {
    schema: "fhf-harness/quick-task/v1",
    id: quick.id,
    tier: "quick",
    title: quick.title,
    intent: { text: String(instruction?.text ?? quick.title), digest: quick.digest },
    createdAt: new Date().toISOString(),
    touched: [],
  };
  if (touched && !existing.touched.includes(touched)) existing.touched.push(touched);
  fs.writeFileSync(quick.file, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
  return true;
}

export function quickTaskQuestion({ quick, target, suggestions = [] }) {
  return [
    `QUICK TASK CONFIRM: "${quick.title}" wants to write ${target}.`,
    ...suggestions.map((line) => `Note: ${line}`),
    'Ask the owner in this turn with one question, header "Quick task", question text starting',
    `"Quick task: ${quick.title}", and options "Yes, go ahead" / "No". Do not answer it yourself.`,
    "One yes covers every automation write and own-file test run for this prompt's task.",
  ].join("\n");
}

// One options builder for every nextStep/validate caller. The hooks once passed only the gate
// options, so every planned manifest looked broken to them ("execution budget policy is unavailable").
export function protocolOptions(config) {
  const runners = config?.engineering?.executionRunners?.runners ?? {};
  const approval = config?.engineering?.taskProtocol?.approval ?? {};
  return {
    repoIds: Object.keys(config?.productTopology?.repositories ?? {}),
    bundleIds: Object.keys(config?.productTopology?.sourceBundles ?? {}),
    runnerIds: Object.keys(runners),
    runners,
    approvalFields: approval.boundFields,
    gates: approval.gates ?? [],
    legacySingleDigestSatisfies: approval.legacySingleDigestSatisfies ?? "plan",
    executionBudget: config?.engineering?.taskProtocol?.executionBudget,
    crossRepositorySeam: config?.engineering?.taskProtocol?.crossRepositorySeam,
    frontendTestData: config?.qualityAssurance?.frontendTestData,
    capabilityControl: config?.engineering?.capabilityControl,
  };
}
