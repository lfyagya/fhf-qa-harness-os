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

export function falseGreenPolicy(config = loadHarnessConfig()) {
  const qa = config.qualityAssurance ?? {};
  return { ...(qa.falseGreen ?? {}), ...(qa.falseGreenEnforcement ?? {}) };
}

// qualityAssurance.falseGreen declared four booleans and nothing enforced them; the session
// rules require a gate to be wired into the real runtime, so these are the mechanical half.
// A test that runs and asserts nothing is the cheapest possible false green — it reports pass,
// raises the file count, and verifies no behavior. The published account of agents gaming a
// suite names the exact shapes: assertions stripped off the result, unconditional skips, and
// empty catch blocks. Each check below maps to one already-declared boolean.
export function checkFalseGreen(content, config = loadHarnessConfig()) {
  const policy = falseGreenPolicy(config);
  const v = [];

  const testCount = (content.match(/(?<![A-Za-z0-9_.])it\s*\(/g) ?? []).length;
  // Assertion-bearing custom commands count. This architecture puts assertions IN commands -
  // commands own reusable commands and assertions, specs hold thin orchestration - so counting
  // only .should()/expect() inside a spec penalises the mandated structure. Verified against
  // loss-mitigation/impound.cy.js, where six it() blocks assert entirely through
  // cy.lmImpoundAssertSingleDashboardWrite() and were wrongly reported as asserting nothing.
  const assertionCount = (policy.assertionPatterns ?? [
    '\\.should\\s*\\(',
    '\\.and\\s*\\(',
    '(?<![A-Za-z0-9_.])expect\\s*\\(',
    '(?<![A-Za-z0-9_.])assert[.(]',
    'cy\\.\\w*[Aa]ssert\\w*\\s*\\(',
    'cy\\.\\w*[Vv]erif\\w*\\s*\\(',
  ]).reduce((total, source) => (
    total + (content.match(new RegExp(source, 'g')) ?? []).length
  ), 0);

  if (policy.structuralInventoryAsProductCoverageAccepted === false && testCount > 0) {
    // Density per test is NOT measurable from a spec file in this architecture: an assertion
    // inside a custom command cannot be attributed to the it() that calls it without resolving
    // every command, which is whole-repo static analysis. So density is opt-in and defaults to
    // OFF; only the decisive case is enforced - a spec with no assertion signal at all.
    // ponytail: raise minimumAssertionsPerTest above 0 only for a lane that asserts inline;
    // true per-test density needs command resolution, which is a separate build.
    const minimum = Number.isInteger(policy.minimumAssertionsPerTest)
      ? policy.minimumAssertionsPerTest
      : 0;
    if (assertionCount === 0) {
      v.push(`${testCount} it() block(s) and no assertion — a test that asserts nothing is a false green, not coverage`);
    } else if (minimum > 0 && assertionCount < testCount * minimum) {
      v.push(`${assertionCount} assertion(s) across ${testCount} it() block(s) — below the configured ${minimum} per test`);
    }
  }

  if (policy.disabledSuitesAccepted === false) {
    if (/(?<![A-Za-z0-9_.])(?:describe|it|context)\s*\.\s*skip\s*\(/.test(content)) {
      v.push('.skip( — a skipped suite reports pass without running; delete it or fix it');
    }
    if (/(?<![A-Za-z0-9_.])x(?:it|describe|context)\s*\(/.test(content)) {
      v.push('xit(/xdescribe( — a disabled suite reports pass without running');
    }
    if (/(?<![A-Za-z0-9_.])(?:describe|it|context)\s*\.\s*only\s*\(/.test(content)) {
      v.push('.only( — silently drops every other test in the run');
    }
  }

  if (policy.fallbackMarkersAccepted === false) {
    if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(content)) {
      v.push('empty catch block — swallows the failure it should surface');
    }
    if (/cy\.on\s*\(\s*['"]fail['"]/.test(content)) {
      v.push("cy.on('fail') — converts a real failure into a pass");
    }
    if (/this\.skip\s*\(\s*\)/.test(content)) {
      v.push('this.skip() — a conditional skip turns missing behavior into a pass');
    }
  }

  return v;
}

// Checks applicable to any spec file's full content. Returns a list of violation strings.
export function checkSpecContent(content, config = loadHarnessConfig()) {
  const v = [];
  if (CY_WAIT_NUMBER_RE.test(content)) v.push('cy.wait(number) — use cy.apiWait() or .should(\'be.visible\')');
  if (!content.includes('cy.ensureAuthenticated()')) v.push('missing cy.ensureAuthenticated()');
  if (!content.includes('testIsolation: true')) v.push('missing testIsolation: true');
  v.push(...checkFalseGreen(content, config));
  return v;
}
