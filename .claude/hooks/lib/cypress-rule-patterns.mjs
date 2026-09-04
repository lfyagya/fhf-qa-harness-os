// Shared Cypress rule patterns — single source of truth for the checks that were
// previously copy-pasted across pre-validate-cypress-rules.mjs, validate-cypress-rules.mjs,
// and spec-sweep-stop-hook.mjs. Canonical rule descriptions live in
// docs/framework/testing-standards/TESTS.md — this module is the executable form.
import { loadHarnessConfig } from "./harness-config.mjs";

export const CY_WAIT_NUMBER_RE = /cy\.wait\(\s*\d+/;
export const SMOKE_MUTATION_RE = /\.(post|put|patch|delete)\s*\(|method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i;
export const HARDCODED_CREDENTIAL_RE = /(?:password|passwd)\s*[:=]\s*['"][^'"]{4,}['"]/i;

export function qualityAssurance(config = loadHarnessConfig()) {
  const policy = config?.qualityAssurance;
  if (!policy || typeof policy !== "object" || !Array.isArray(policy.scenarioRequiredFields)) {
    throw new Error("qualityAssurance policy is missing or invalid");
  }
  return policy;
}

export function smokePolicy(config = loadHarnessConfig()) {
  const policy = qualityAssurance(config).lanes?.smoke;
  if (!policy || !Array.isArray(policy.allowedMethods) || !Array.isArray(policy.forbiddenActions)) {
    throw new Error("qualityAssurance.lanes.smoke policy is missing or invalid");
  }
  return policy;
}

export function tagTaxonomy(config = loadHarnessConfig()) {
  const policy = qualityAssurance(config).tagTaxonomy;
  if (!policy
      || !Array.isArray(policy.suiteRequiredAxes)
      || !Array.isArray(policy.testRequiredAxes)
      || typeof policy.suiteBundle !== "string"
      || typeof policy.tagNamespace !== "string") {
    throw new Error("qualityAssurance.tagTaxonomy policy is missing or invalid");
  }
  return policy;
}

function callOptions(content, functionName) {
  const calls = [];
  const callRe = new RegExp(
    `\\b${functionName}(?:\\.only|\\.skip)?\\s*\\(([\\s\\S]*?)(?=(?:\\(\\)|\\([^)]*\\))\\s*=>|function\\s*\\()`,
    "g",
  );
  for (const match of content.matchAll(callRe)) calls.push(match[1]);
  return calls;
}

export function checkTagTaxonomy(content, config = loadHarnessConfig()) {
  const policy = tagTaxonomy(config);
  const violations = [];
  const namespace = policy.tagNamespace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bundle = policy.suiteBundle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const axisAliases = new Map();
  const destructureRe = new RegExp(`\\{([^}]+)\\}\\s*=\\s*${namespace}\\b`, "g");
  for (const match of content.matchAll(destructureRe)) {
    for (const member of match[1].split(",")) {
      const [axis, alias = axis] = member.trim().split(/\s*:\s*/);
      if (axis && alias) axisAliases.set(axis, alias);
    }
  }
  const hasAxisTag = (options, axis) => {
    if (new RegExp(`\\b${namespace}\\.${axis}\\.[A-Z0-9_]+\\b`).test(options)) return true;
    const alias = axisAliases.get(axis);
    return Boolean(alias) && new RegExp(`\\b${alias}\\.[A-Z0-9_]+\\b`).test(options);
  };

  for (const options of callOptions(content, policy.suiteScope)) {
    const usesBundle = new RegExp(`\\b${bundle}\\.[A-Z0-9_]+\\b`).test(options);
    const missingAxes = policy.suiteRequiredAxes.filter((axis) => !hasAxisTag(options, axis));
    if (!usesBundle && missingAxes.length > 0) {
      violations.push(
        `${policy.suiteScope} tags must use ${policy.suiteBundle} or include ` +
        `${policy.suiteRequiredAxes.join(" + ")}; missing ${missingAxes.join(", ")}`,
      );
    }
  }

  for (const options of callOptions(content, policy.testScope)) {
    const hasTagsOption = /\btags\s*:/.test(options);
    const hasStatus = policy.testRequiredAxes.every((axis) => hasAxisTag(options, axis));
    if (!hasTagsOption || !hasStatus) {
      violations.push(
        `${policy.testScope} tags must include ${policy.testRequiredAxes.join(" + ")} ` +
        `through ${policy.tagNamespace}`,
      );
    }
  }

  return violations;
}

export function isSmokePath(filePath) {
  return /[\\/]smoke[\\/]/.test(filePath);
}

export function isSmokeLane(filePath, lane) {
  return lane === "smoke" || isSmokePath(filePath);
}

export function isSpecFile(filePath) {
  return filePath.endsWith('.cy.js') || filePath.endsWith('.cy.ts');
}

export function isConfigPath(filePath) {
  return /[\\/]configs[\\/]/.test(filePath);
}

// Checks applicable to any spec file's full content. Returns a list of violation strings.
export function checkSpecContent(content) {
  const v = [];
  if (CY_WAIT_NUMBER_RE.test(content)) v.push('cy.wait(number) — use cy.apiWait() or .should(\'be.visible\')');
  if (!content.includes('cy.ensureAuthenticated()')) v.push('missing cy.ensureAuthenticated()');
  if (!content.includes('testIsolation: true')) v.push('missing testIsolation: true');
  return v;
}
