#!/usr/bin/env node
// Calculates comparable-release regression effort from observed human work only.
// It fails closed: any missing/invalid required evidence produces UNKNOWN metrics.
import fs from "node:fs";

const CHECKLIST_SCHEMA = "fhf-regression-effort-checklist/v1";
const CAPTURE_SCHEMA = "fhf-regression-effort-release-capture/v1";
const OUTPUT_SCHEMA = "fhf-regression-effort-calculation/v1";
const REQUIRED_OPERATING_ACTIVITIES = ["trigger", "monitor", "triage", "report"];

function unknown(reasons, inputs = {}) {
  return {
    schemaVersion: OUTPUT_SCHEMA,
    evidenceStatus: "UNKNOWN",
    inputs,
    missingEvidence: [...new Set(reasons)],
    metrics: {
      manualBaselinePersonMinutes: "UNKNOWN",
      residualManualPersonMinutes: "UNKNOWN",
      automationOperatingPersonMinutes: "UNKNOWN",
      grossManualEquivalentMinutesDisplaced: "UNKNOWN",
      netRegressionMinutesSaved: "UNKNOWN",
      netRegressionHoursSaved: "UNKNOWN",
      scopeMatchRate: "UNKNOWN",
      costSavings: "UNKNOWN",
      roi: "UNKNOWN",
    },
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validTimestamp(value) {
  return nonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function validMinutes(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validIdentifier(value) {
  return nonEmptyString(value) || (typeof value === "number" && Number.isFinite(value));
}

function requireString(object, key, label, reasons) {
  if (!isObject(object) || !nonEmptyString(object[key])) reasons.push(`${label} is required.`);
}

function readJson(file, label, reasons) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    reasons.push(`${label} cannot be read as JSON: ${error.message}`);
    return null;
  }
}

function indexByActivity(records, label, expectedIds, reasons) {
  if (!Array.isArray(records)) {
    reasons.push(`${label} must be an array.`);
    return new Map();
  }

  const result = new Map();
  for (const record of records) {
    if (!isObject(record) || !nonEmptyString(record.activityId)) {
      reasons.push(`${label} contains a record without activityId.`);
      continue;
    }
    if (result.has(record.activityId)) {
      reasons.push(`${label} duplicates activityId ${record.activityId}.`);
      continue;
    }
    result.set(record.activityId, record);
  }
  for (const id of expectedIds) {
    if (!result.has(id)) reasons.push(`${label} is missing activityId ${id}.`);
  }
  for (const id of result.keys()) {
    if (!expectedIds.has(id)) reasons.push(`${label} has activityId ${id}, which is not in the checklist.`);
  }
  return result;
}

function validatePersonMinuteRecord(record, label, reasons, { allowNotPerformed }) {
  if (!isObject(record)) {
    reasons.push(`${label} must be an object.`);
    return;
  }
  if (!validMinutes(record.personMinutes)) reasons.push(`${label}.personMinutes must be a non-negative number.`);
  if (typeof record.performed !== "boolean") reasons.push(`${label}.performed must be true or false.`);
  if (!allowNotPerformed && record.performed !== true) reasons.push(`${label}.performed must be true for the baseline.`);
  if (record.performed === false) {
    if (record.personMinutes !== 0) reasons.push(`${label} must record 0 personMinutes when not performed.`);
    requireString(record, "notPerformedReason", `${label}.notPerformedReason`, reasons);
    return;
  }
  requireString(record, "observedBy", `${label}.observedBy`, reasons);
  if (!validTimestamp(record.startedAt)) reasons.push(`${label}.startedAt must be an ISO timestamp.`);
  if (!validTimestamp(record.finishedAt)) reasons.push(`${label}.finishedAt must be an ISO timestamp.`);
  if (validTimestamp(record.startedAt) && validTimestamp(record.finishedAt)
    && Date.parse(record.finishedAt) < Date.parse(record.startedAt)) {
    reasons.push(`${label}.finishedAt must not be before startedAt.`);
  }
  requireString(record, "evidenceRef", `${label}.evidenceRef`, reasons);
}

function validateCaptureIdentity(capture, kind, checklist, label, reasons) {
  if (!isObject(capture)) {
    reasons.push(`${label} is missing.`);
    return;
  }
  if (capture.schemaVersion !== CAPTURE_SCHEMA) reasons.push(`${label}.schemaVersion must be ${CAPTURE_SCHEMA}.`);
  if (capture.captureKind !== kind) reasons.push(`${label}.captureKind must be ${kind}.`);
  for (const key of ["releaseId", "releaseCategory", "environment", "executedAt"]) {
    requireString(capture, key, `${label}.${key}`, reasons);
  }
  if (!validTimestamp(capture.executedAt)) reasons.push(`${label}.executedAt must be an ISO timestamp.`);
  if (!isObject(capture.checklist)) {
    reasons.push(`${label}.checklist is required.`);
  } else {
    if (capture.checklist.id !== checklist.checklistId) reasons.push(`${label}.checklist.id must match checklistId.`);
    if (capture.checklist.version !== checklist.version) reasons.push(`${label}.checklist.version must match checklist version.`);
  }
  if (capture.releaseCategory !== checklist.releaseCategory) reasons.push(`${label}.releaseCategory must match the frozen checklist.`);
  if (capture.environment !== checklist.environment) reasons.push(`${label}.environment must match the frozen checklist.`);
  validateReleaseProvenance(capture, label, reasons);
}

function requireStringArray(value, label, reasons) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !nonEmptyString(item))) {
    reasons.push(`${label} must be a non-empty array of strings.`);
  }
}

function validateReleaseProvenance(capture, label, reasons) {
  const provenance = capture.releaseProvenance;
  if (!isObject(provenance)) {
    reasons.push(`${label}.releaseProvenance is required.`);
    return;
  }
  for (const key of ["releasePlanUrl", "sprint", "releaseTaskKey"]) {
    requireString(provenance, key, `${label}.releaseProvenance.${key}`, reasons);
  }
  if (!validIdentifier(provenance.sprintId)) reasons.push(`${label}.releaseProvenance.sprintId is required.`);
  requireStringArray(provenance.releaseVersionRefs, `${label}.releaseProvenance.releaseVersionRefs`, reasons);
  requireStringArray(provenance.inScopeIssueKeys, `${label}.releaseProvenance.inScopeIssueKeys`, reasons);

  const dependencies = provenance.dependencies;
  if (!isObject(dependencies)) {
    reasons.push(`${label}.releaseProvenance.dependencies is required.`);
  } else {
    for (const key of ["database", "api", "cronJobs"]) {
      if (!Array.isArray(dependencies[key])) reasons.push(`${label}.releaseProvenance.dependencies.${key} must be an array; use [] when none apply.`);
    }
  }

  const finalBuild = provenance.finalBuild;
  if (!isObject(finalBuild)) {
    reasons.push(`${label}.releaseProvenance.finalBuild is required.`);
  } else {
    for (const key of ["buildId", "automationSha", "deployedSystemVersion"]) {
      requireString(finalBuild, key, `${label}.releaseProvenance.finalBuild.${key}`, reasons);
    }
  }

  const scopeFreeze = provenance.scopeFreeze;
  if (!isObject(scopeFreeze)) {
    reasons.push(`${label}.releaseProvenance.scopeFreeze is required.`);
  } else {
    if (!validTimestamp(scopeFreeze.frozenAt)) reasons.push(`${label}.releaseProvenance.scopeFreeze.frozenAt must be an ISO timestamp.`);
    requireString(scopeFreeze, "frozenBy", `${label}.releaseProvenance.scopeFreeze.frozenBy`, reasons);
    if (scopeFreeze.status !== "frozen_after_refinement") reasons.push(`${label}.releaseProvenance.scopeFreeze.status must be frozen_after_refinement.`);
    requireString(scopeFreeze, "evidenceRef", `${label}.releaseProvenance.scopeFreeze.evidenceRef`, reasons);
  }

  const intakeConfig = provenance.intakeConfig;
  if (!isObject(intakeConfig)) {
    reasons.push(`${label}.releaseProvenance.intakeConfig is required.`);
  } else {
    for (const key of ["configId", "version", "projectKey"]) {
      requireString(intakeConfig, key, `${label}.releaseProvenance.intakeConfig.${key}`, reasons);
    }
    if (!validIdentifier(intakeConfig.boardId)) reasons.push(`${label}.releaseProvenance.intakeConfig.boardId is required.`);
  }

  const scopeSnapshot = provenance.scopeSnapshot;
  if (!isObject(scopeSnapshot)) {
    reasons.push(`${label}.releaseProvenance.scopeSnapshot is required.`);
  } else {
    if (!validTimestamp(scopeSnapshot.capturedAt)) reasons.push(`${label}.releaseProvenance.scopeSnapshot.capturedAt must be an ISO timestamp.`);
    requireString(scopeSnapshot, "jql", `${label}.releaseProvenance.scopeSnapshot.jql`, reasons);
    if (!Number.isInteger(scopeSnapshot.issueCount) || scopeSnapshot.issueCount < 0) reasons.push(`${label}.releaseProvenance.scopeSnapshot.issueCount must be a non-negative integer.`);
    requireString(scopeSnapshot, "evidenceRef", `${label}.releaseProvenance.scopeSnapshot.evidenceRef`, reasons);
  }

  const scopeAssessment = provenance.scopeAssessment;
  if (!Array.isArray(scopeAssessment)) {
    reasons.push(`${label}.releaseProvenance.scopeAssessment must be an array.`);
  } else {
    if (scopeSnapshot && Number.isInteger(scopeSnapshot.issueCount) && scopeAssessment.length !== scopeSnapshot.issueCount) {
      reasons.push(`${label}.releaseProvenance.scopeAssessment must classify every ticket in scopeSnapshot.issueCount.`);
    }
    const issueKeys = new Set();
    for (const record of scopeAssessment) {
      if (!isObject(record) || !nonEmptyString(record.issueKey)) {
        reasons.push(`${label}.releaseProvenance.scopeAssessment contains a record without issueKey.`);
        continue;
      }
      if (issueKeys.has(record.issueKey)) reasons.push(`${label}.releaseProvenance.scopeAssessment duplicates issueKey ${record.issueKey}.`);
      issueKeys.add(record.issueKey);
      if (!["regression_required", "not_applicable", "deferred", "blocked"].includes(record.qaDisposition)) {
        reasons.push(`${label}.releaseProvenance.scopeAssessment[${record.issueKey}].qaDisposition is invalid.`);
      }
      if (record.qaDisposition === "regression_required") {
        if (!Array.isArray(record.mappedActivityIds) || record.mappedActivityIds.length === 0 || record.mappedActivityIds.some((id) => !nonEmptyString(id))) {
          reasons.push(`${label}.releaseProvenance.scopeAssessment[${record.issueKey}] requires mappedActivityIds.`);
        }
      } else {
        requireString(record, "rationale", `${label}.releaseProvenance.scopeAssessment[${record.issueKey}].rationale`, reasons);
      }
    }
  }
}

function validateScopeAssessmentActivityReferences(capture, label, activityIds, reasons) {
  for (const record of capture?.releaseProvenance?.scopeAssessment ?? []) {
    if (record.qaDisposition !== "regression_required") continue;
    for (const activityId of record.mappedActivityIds ?? []) {
      if (!activityIds.has(activityId)) reasons.push(`${label}.scopeAssessment[${record.issueKey}] maps unknown activityId ${activityId}.`);
    }
  }
}

function calculate(checklist, baseline, assisted) {
  const reasons = [];
  const inputs = {
    checklistId: checklist?.checklistId ?? "UNKNOWN",
    checklistVersion: checklist?.version ?? "UNKNOWN",
    baselineReleaseId: baseline?.releaseId ?? "UNKNOWN",
    automationAssistedReleaseId: assisted?.releaseId ?? "UNKNOWN",
  };

  if (!isObject(checklist)) return unknown(["Checklist is missing or invalid JSON."], inputs);
  if (checklist.schemaVersion !== CHECKLIST_SCHEMA) reasons.push(`checklist.schemaVersion must be ${CHECKLIST_SCHEMA}.`);
  for (const key of ["checklistId", "version", "releaseCategory", "environment"]) {
    requireString(checklist, key, `checklist.${key}`, reasons);
  }
  if (checklist.status !== "frozen") reasons.push("checklist.status must be frozen before collection.");
  if (!Array.isArray(checklist.activities) || checklist.activities.length === 0) {
    reasons.push("checklist.activities must contain at least one frozen activity.");
  }

  const activityIds = new Set();
  for (const activity of Array.isArray(checklist.activities) ? checklist.activities : []) {
    if (!isObject(activity) || !nonEmptyString(activity.activityId)) {
      reasons.push("Each checklist activity requires activityId.");
      continue;
    }
    if (activityIds.has(activity.activityId)) reasons.push(`checklist.activities duplicates activityId ${activity.activityId}.`);
    activityIds.add(activity.activityId);
    requireString(activity, "title", `checklist activity ${activity.activityId}.title`, reasons);
    requireString(activity, "scope", `checklist activity ${activity.activityId}.scope`, reasons);
  }

  validateScopeAssessmentActivityReferences(baseline, "baseline", activityIds, reasons);
  validateScopeAssessmentActivityReferences(assisted, "automation-assisted capture", activityIds, reasons);

  validateCaptureIdentity(baseline, "manual_baseline", checklist, "baseline", reasons);
  validateCaptureIdentity(assisted, "automation_assisted", checklist, "automation-assisted capture", reasons);
  if (baseline?.releaseId === assisted?.releaseId) reasons.push("Baseline and automation-assisted captures must use different releaseId values.");
  const comparison = assisted?.comparison;
  if (!isObject(comparison)) {
    reasons.push("automation-assisted capture.comparison is required.");
  } else {
    if (comparison.baselineReleaseId !== baseline?.releaseId) reasons.push("automation-assisted capture.comparison.baselineReleaseId must match baseline.releaseId.");
    if (comparison.scopeStatus !== "same_frozen_checklist") reasons.push("automation-assisted capture.comparison.scopeStatus must be same_frozen_checklist.");
    if (!validTimestamp(comparison.assessedAt)) reasons.push("automation-assisted capture.comparison.assessedAt must be an ISO timestamp.");
    requireString(comparison, "assessedBy", "automation-assisted capture.comparison.assessedBy", reasons);
    requireString(comparison, "evidenceRef", "automation-assisted capture.comparison.evidenceRef", reasons);
  }

  const baselineRecords = indexByActivity(baseline?.manualActivities, "baseline.manualActivities", activityIds, reasons);
  const residualRecords = indexByActivity(assisted?.residualManualActivities, "automation-assisted residualManualActivities", activityIds, reasons);
  const mappingRecords = indexByActivity(assisted?.activityMappings, "automation-assisted activityMappings", activityIds, reasons);

  for (const [id, record] of baselineRecords) validatePersonMinuteRecord(record, `baseline.manualActivities[${id}]`, reasons, { allowNotPerformed: false });
  for (const [id, record] of residualRecords) validatePersonMinuteRecord(record, `automation-assisted residualManualActivities[${id}]`, reasons, { allowNotPerformed: true });

  let automatedActivityCount = 0;
  for (const id of activityIds) {
    const mapping = mappingRecords.get(id);
    const residual = residualRecords.get(id);
    if (!mapping) continue;
    if (!["automated", "residual_manual"].includes(mapping.mode)) {
      reasons.push(`activityMappings[${id}].mode must be automated or residual_manual.`);
      continue;
    }
    if (mapping.mode === "automated") {
      automatedActivityCount += 1;
      for (const key of ["scenarioId", "testId", "lane", "runId", "artifactRef"]) {
        requireString(mapping, key, `activityMappings[${id}].${key}`, reasons);
      }
      if (mapping.nativeStatus !== "passed") reasons.push(`activityMappings[${id}].nativeStatus must be passed for a replacement claim.`);
      if (residual?.performed !== false) reasons.push(`activityMappings[${id}] is automated, so its residual manual capture must be explicitly not performed.`);
    }
    if (mapping.mode === "residual_manual" && residual?.performed !== true) {
      reasons.push(`activityMappings[${id}] is residual_manual, so its residual manual capture must be performed.`);
    }
  }

  const operating = assisted?.automationOperatingActivities;
  if (!Array.isArray(operating)) {
    reasons.push("automation-assisted capture.automationOperatingActivities must be an array.");
  } else {
    const counts = new Map();
    for (const record of operating) {
      if (!isObject(record) || !nonEmptyString(record.activityType)) {
        reasons.push("automationOperatingActivities contains a record without activityType.");
        continue;
      }
      counts.set(record.activityType, (counts.get(record.activityType) ?? 0) + 1);
      validatePersonMinuteRecord(record, `automationOperatingActivities[${record.activityType}]`, reasons, { allowNotPerformed: true });
    }
    for (const type of REQUIRED_OPERATING_ACTIVITIES) {
      if (counts.get(type) !== 1) reasons.push(`automationOperatingActivities must contain exactly one ${type} record.`);
    }
  }

  if (reasons.length) return unknown(reasons, inputs);

  const baselineMinutes = [...baselineRecords.values()].reduce((total, record) => total + record.personMinutes, 0);
  const residualMinutes = [...residualRecords.values()].reduce((total, record) => total + record.personMinutes, 0);
  const operatingMinutes = operating.reduce((total, record) => total + record.personMinutes, 0);
  const grossDisplacedMinutes = [...activityIds]
    .filter((id) => mappingRecords.get(id).mode === "automated")
    .reduce((total, id) => total + baselineRecords.get(id).personMinutes, 0);

  return {
    schemaVersion: OUTPUT_SCHEMA,
    evidenceStatus: "COMPLETE",
    inputs,
    missingEvidence: [],
    metrics: {
      manualBaselinePersonMinutes: baselineMinutes,
      residualManualPersonMinutes: residualMinutes,
      automationOperatingPersonMinutes: operatingMinutes,
      grossManualEquivalentMinutesDisplaced: grossDisplacedMinutes,
      netRegressionMinutesSaved: baselineMinutes - residualMinutes - operatingMinutes,
      netRegressionHoursSaved: (baselineMinutes - residualMinutes - operatingMinutes) / 60,
      scopeMatchRate: automatedActivityCount === 0 ? "UNKNOWN" : 1,
      replacedActivityCount: automatedActivityCount,
      checklistActivityCount: activityIds.size,
      costSavings: "UNKNOWN",
      roi: "UNKNOWN",
    },
  };
}

function usage() {
  console.log(`Usage:
  node scripts/evidence/calculate-regression-effort.mjs <checklist.json> <manual-baseline.json> <automation-assisted.json>
  node scripts/evidence/calculate-regression-effort.mjs --self-test

The calculator writes JSON to stdout. It returns UNKNOWN metrics until all required evidence is present.`);
}

function selfTest() {
  const checklist = {
    schemaVersion: CHECKLIST_SCHEMA, checklistId: "pre-release-regression", version: "1.0.0", status: "frozen",
    releaseCategory: "pre-release-regression", environment: "QA",
    activities: [{ activityId: "login-and-dashboard", title: "Login and dashboard check", scope: "Synthetic QA account" }],
  };
  const baseline = {
    schemaVersion: CAPTURE_SCHEMA, captureKind: "manual_baseline", releaseId: "release-a", releaseCategory: "pre-release-regression", environment: "QA", executedAt: "2026-08-09T10:00:00Z",
    checklist: { id: "pre-release-regression", version: "1.0.0" },
    releaseProvenance: {
      releasePlanUrl: "https://example.invalid/release-a", sprint: "Sprint A", sprintId: 1, releaseTaskKey: "SERV-1",
      releaseVersionRefs: ["SERV-release-a"], inScopeIssueKeys: ["SERV-1"],
      dependencies: { database: [], api: [], cronJobs: [] },
      finalBuild: { buildId: "build-a", automationSha: "automation-sha-a", deployedSystemVersion: "app-version-a" },
      scopeFreeze: { frozenAt: "2026-08-09T09:00:00Z", frozenBy: "QA lead", status: "frozen_after_refinement", evidenceRef: "release-plan" },
      intakeConfig: { configId: "fhf-serv-jira-release-intake", version: "1.0.0", projectKey: "SERV", boardId: 8 },
      scopeSnapshot: { capturedAt: "2026-08-09T09:00:00Z", jql: "project = SERV AND Sprint = 1", issueCount: 1, evidenceRef: "read-only-sprint-snapshot" },
      scopeAssessment: [{ issueKey: "SERV-1", qaDisposition: "regression_required", mappedActivityIds: ["login-and-dashboard"] }],
    },
    manualActivities: [{ activityId: "login-and-dashboard", performed: true, personMinutes: 12, observedBy: "QA observer", startedAt: "2026-08-09T10:00:00Z", finishedAt: "2026-08-09T10:12:00Z", evidenceRef: "local-observation" }],
  };
  const assisted = {
    schemaVersion: CAPTURE_SCHEMA, captureKind: "automation_assisted", releaseId: "release-b", releaseCategory: "pre-release-regression", environment: "QA", executedAt: "2026-08-16T10:00:00Z",
    checklist: { id: "pre-release-regression", version: "1.0.0" },
    releaseProvenance: {
      releasePlanUrl: "https://example.invalid/release-b", sprint: "Sprint B", sprintId: 2, releaseTaskKey: "SERV-2",
      releaseVersionRefs: ["SERV-release-b"], inScopeIssueKeys: ["SERV-2"],
      dependencies: { database: [], api: [], cronJobs: [] },
      finalBuild: { buildId: "build-b", automationSha: "automation-sha-b", deployedSystemVersion: "app-version-b" },
      scopeFreeze: { frozenAt: "2026-08-16T09:00:00Z", frozenBy: "QA lead", status: "frozen_after_refinement", evidenceRef: "release-plan" },
      intakeConfig: { configId: "fhf-serv-jira-release-intake", version: "1.0.0", projectKey: "SERV", boardId: 8 },
      scopeSnapshot: { capturedAt: "2026-08-16T09:00:00Z", jql: "project = SERV AND Sprint = 2", issueCount: 1, evidenceRef: "read-only-sprint-snapshot" },
      scopeAssessment: [{ issueKey: "SERV-2", qaDisposition: "regression_required", mappedActivityIds: ["login-and-dashboard"] }],
    },
    comparison: { baselineReleaseId: "release-a", scopeStatus: "same_frozen_checklist", assessedAt: "2026-08-16T09:30:00Z", assessedBy: "QA lead", evidenceRef: "scope-review" },
    residualManualActivities: [{ activityId: "login-and-dashboard", performed: false, personMinutes: 0, notPerformedReason: "Exact automated replacement ran." }],
    activityMappings: [{ activityId: "login-and-dashboard", mode: "automated", scenarioId: "demo-login-01", testId: "dashboard.cy.js :: login", lane: "E2E", runId: "local-demo", nativeStatus: "passed", artifactRef: "local-artifact" }],
    automationOperatingActivities: REQUIRED_OPERATING_ACTIVITIES.map((activityType) => ({ activityType, performed: true, personMinutes: 1, observedBy: "QA observer", startedAt: "2026-08-16T10:00:00Z", finishedAt: "2026-08-16T10:01:00Z", evidenceRef: "local-observation" })),
  };
  const complete = calculate(checklist, baseline, assisted);
  if (complete.evidenceStatus !== "COMPLETE" || complete.metrics.netRegressionMinutesSaved !== 8) throw new Error("Complete evidence self-test failed.");
  assisted.activityMappings[0].runId = "";
  const incomplete = calculate(checklist, baseline, assisted);
  if (incomplete.evidenceStatus !== "UNKNOWN" || incomplete.metrics.netRegressionMinutesSaved !== "UNKNOWN") throw new Error("UNKNOWN self-test failed.");
  console.log("Regression-effort calculator self-test passed.");
}

if (process.argv[2] === "--help" || process.argv[2] === "-h") {
  usage();
} else if (process.argv[2] === "--self-test") {
  selfTest();
} else if (process.argv.length === 5) {
  const reasons = [];
  const [checklistFile, baselineFile, assistedFile] = process.argv.slice(2);
  const result = calculate(
    readJson(checklistFile, "Checklist", reasons),
    readJson(baselineFile, "Manual baseline capture", reasons),
    readJson(assistedFile, "Automation-assisted capture", reasons),
  );
  if (reasons.length) {
    console.log(JSON.stringify(unknown(reasons, result.inputs), null, 2));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
} else {
  usage();
  process.exitCode = 1;
}
