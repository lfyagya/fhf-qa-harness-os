import { createHash } from "node:crypto";

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
  if (!/^[a-f0-9]{64}$/.test(manifest.grounding?.jira?.issueDigest ?? "")) {
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

function validateTestCaseBinding(manifest) {
  const issues = [];
  const knownRows = intentVsBuiltRowIds(manifest);
  const scenarios = manifest.plan?.scenarios ?? [];
  const scenarioIds = new Set();

  for (const scenario of scenarios) {
    if (!scenario?.id || scenarioIds.has(scenario.id)) {
      issues.push("plan.scenarios IDs must be present and unique");
      continue;
    }
    scenarioIds.add(scenario.id);
    if (typeof scenario.description !== "string" || !scenario.description.trim()) {
      issues.push(`${scenario.id}.description must state the scenario`);
    }
    const derivedFrom = scenario.acceptanceIds;
    if (!Array.isArray(derivedFrom) || derivedFrom.length === 0) {
      issues.push(`${scenario.id}.acceptanceIds must bind the requirement it derives from`);
    } else {
      for (const id of derivedFrom) {
        if (!knownRows.has(id)) issues.push(`${scenario.id} acceptanceIds references unknown intentVsBuilt row ${id}`);
      }
    }
  }

  for (const test of manifest.plan?.tests ?? []) {
    if (test.proofMode === "tests-not-applicable") continue;
    const label = test.id ?? "test";

    const cited = test.scenarioIds;
    if (!Array.isArray(cited) || cited.length === 0) {
      issues.push(`${label}.scenarioIds must cite at least one plan.scenarios row`);
    } else {
      for (const id of cited) {
        if (!scenarioIds.has(id)) issues.push(`${label} scenarioIds references unknown plan.scenarios row ${id}`);
      }
    }

    const data = test.testData;
    if (!data || typeof data !== "object") {
      issues.push(`${label}.testData must reference a fixture key or record { none: "<reason>" }`);
    } else if (typeof data.none === "string") {
      if (!data.none.trim()) issues.push(`${label}.testData.none must give a reason`);
    } else if (!isRelativeSafePath(data.fixture) || typeof data.key !== "string" || !data.key.trim()) {
      issues.push(`${label}.testData needs a repo-relative fixture path and a non-empty key`);
    } else if (data.resolver !== undefined && (typeof data.resolver !== "string" || !data.resolver.trim())) {
      issues.push(`${label}.testData.resolver must be the command that reads the key`);
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

export function validateTaskManifest(manifest, { repoIds = [], runnerIds = [], runners = {}, executionBudget, capabilityControl } = {}) {
  const issues = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["task manifest must be an object"];
  }
  if (manifest.schema !== TASK_SCHEMA) issues.push(`schema must be ${TASK_SCHEMA}`);
  if (typeof manifest.id !== "string" || !manifest.id) issues.push("id must be a non-empty string");
  if (!TASK_STAGES.includes(manifest.stage)) issues.push("stage is not recognized");
  if (!/^SERV-\d+$/.test(manifest.ticketFamily?.primary ?? "")) {
    issues.push("ticketFamily.primary must be a SERV ticket");
  }
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
  if (!Array.isArray(manifest.evidence?.artifacts)) issues.push("evidence.artifacts must be an array");
  issues.push(...validateTestHonesty(manifest));
  issues.push(...validateTestCaseBinding(manifest));
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
  if (!/^SERV-\d+$/.test(manifest?.ticketFamily?.primary ?? "")) identityIssues.push("ticketFamily.primary must be a SERV ticket");
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
  if (["planned", "approved", "implementing", "verified", "complete"].includes(manifest.stage)
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

  const actions = {
    intake: "ground-task",
    grounded: "plan-cross-repository-change",
    planned: manifest.approval?.required ? "record-human-approval" : "begin-implementation",
    approved: "begin-implementation",
    implementing: "collect-native-verification-evidence",
    verified: "complete-task",
    complete: "none",
  };
  return { action: actions[manifest.stage], stage: manifest.stage, blocked: false, approval };
}
