#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publishEvidenceBundle } from "./evidence-export-policy.mjs";
import { resolveConsumerRoot } from "./workspace-paths.mjs";
import {
  attachSourceEvidence,
  buildCompleteness,
  buildSourceCatalog,
  collectSpecs,
  collectTests,
  coverageForRequirements,
  mapTestsToSpecs,
  renderIndexReport,
  renderModuleReport,
  renderSpecGapReport,
  resolveBaselines,
} from "./traceability-lib.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONSUMER_ROOT = resolveConsumerRoot(HARNESS_ROOT);
const CONFIG_FILE = path.join(HARNESS_ROOT, "config", "qa-control-plane.json");
const CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
const TRACE_CONFIG = CONFIG.paths.traceability;
const OUTPUT_ROOT = path.resolve(CONSUMER_ROOT, TRACE_CONFIG.outputRoot);
const EVIDENCE_ROOT = path.resolve(CONSUMER_ROOT, CONFIG.paths.evidenceDir);
const consentIndex = process.argv.indexOf("--consent");
const consent = consentIndex >= 0 ? process.argv[consentIndex + 1] : null;
const dryRun = process.argv.includes("--dry-run");

function countBy(values, key) {
  const result = {};
  for (const value of values) {
    const selected = typeof key === "function" ? key(value) : value[key];
    result[selected] = (result[selected] ?? 0) + 1;
  }
  return result;
}

function safeModuleName(module) {
  return module.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
}

const generatedAt = new Date().toISOString();
const baselines = resolveBaselines(
  CONSUMER_ROOT,
  CONFIG.productTopology.repositories,
  TRACE_CONFIG.testRefs,
);
const unavailable = baselines.filter((baseline) => baseline.availability !== "available");
const testInventory = collectTests(CONSUMER_ROOT, baselines);
const specBaseline = baselines.find((baseline) => baseline.repoId === "Test-Case-Automation-Using-Claude-Agents");
const specInventory = collectSpecs(CONSUMER_ROOT, specBaseline);
const specMappedTests = mapTestsToSpecs(testInventory.records, specInventory);
const sourceCatalog = buildSourceCatalog(CONSUMER_ROOT, baselines);
const tests = attachSourceEvidence(CONSUMER_ROOT, specMappedTests, sourceCatalog);
const requirements = coverageForRequirements(specInventory, tests);
const completeness = buildCompleteness(testInventory, tests, specInventory);

const totalsByLane = Object.fromEntries(
  TRACE_CONFIG.testRepositories.map((repoId) => [
    repoId,
    {
      files: testInventory.files.filter((file) => file.repoId === repoId).length,
      tests: tests.filter((test) => test.repoId === repoId).length,
      outcomes: countBy(tests.filter((test) => test.repoId === repoId), "outcome"),
    },
  ]),
);
const modules = [...new Set([
  ...tests.map((test) => test.module),
  ...requirements.map((requirement) => requirement.module),
])].sort();
const baselineSummary = baselines
  .filter((baseline) => baseline.availability === "available")
  .map((baseline) => `${baseline.repoId}@${baseline.sha.slice(0, 12)}`)
  .join(", ");

const ledger = {
  schemaVersion: 1,
  generatedAt,
  policy: {
    branch: TRACE_CONFIG.branchPolicy,
    testUniverse: TRACE_CONFIG.testRepositories,
    assertionAuthority: "frozen-product-source-not-test-code",
    dynamicPolicy: "record-unresolved-never-silently-omit",
  },
  baselines,
  completeness,
  totals: {
    repositories: baselines.length,
    unavailableRepositories: unavailable.length,
    sourceCatalogFiles: sourceCatalog.length,
    specFiles: specInventory.files.length,
    specRequirements: requirements.length,
    scenarioGroups: specInventory.groups.length,
    automationScenarioFiles: testInventory.scenarios.length,
    automationScenarios: testInventory.scenarios.reduce((sum, file) => sum + file.definitions.length, 0),
    testFiles: testInventory.files.length,
    tests: tests.length,
    testsByLane: totalsByLane,
    outcomes: countBy(tests, "outcome"),
    requirementOutcomes: countBy(requirements, "outcome"),
  },
  diagnostics: [...testInventory.diagnostics, ...specInventory.diagnostics],
  testFiles: testInventory.files,
  automationScenarios: testInventory.scenarios,
  tests,
  specRequirements: requirements,
  scenarioGroups: specInventory.groups,
};

const files = [];
const ledgerFile = path.join(OUTPUT_ROOT, TRACE_CONFIG.ledger);
files.push({ file: ledgerFile, content: `${JSON.stringify(ledger, null, 2)}\n` });
const gapFile = path.join(OUTPUT_ROOT, TRACE_CONFIG.specGapReport);
files.push({ file: gapFile, content: renderSpecGapReport(tests, requirements) });
files.push({
  file: path.join(OUTPUT_ROOT, TRACE_CONFIG.index),
  content: renderIndexReport(ledger, TRACE_CONFIG.moduleReportRoot),
});
for (const module of modules) {
  files.push({
    file: path.join(OUTPUT_ROOT, TRACE_CONFIG.moduleReportRoot, `${safeModuleName(module)}.md`),
    content: renderModuleReport(
      module,
      tests.filter((test) => test.module === module),
      requirements.filter((requirement) => requirement.module === module),
      baselineSummary,
    ),
  });
}

const coverageFile = path.join(EVIDENCE_ROOT, "coverage-computed.json");
let coverage = {};
try {
  coverage = JSON.parse(fs.readFileSync(coverageFile, "utf8"));
} catch {
  coverage = { schemaVersion: 1, lanes: {} };
}
coverage.generatedAt = generatedAt;
coverage.traceability = {
  ledger: path.relative(CONSUMER_ROOT, ledgerFile).replace(/\\/g, "/"),
  baselinePolicy: TRACE_CONFIG.branchPolicy,
  completeness,
  testsByLane: totalsByLane,
  outcomes: ledger.totals.outcomes,
  specRequirements: requirements.length,
  specRequirementsWithoutTests: requirements.filter((requirement) => requirement.outcome === "SPEC_WITHOUT_TEST").length,
};
files.push({ file: coverageFile, content: `${JSON.stringify(coverage, null, 2)}\n` });

const runtimeFiles = files.map(({ file }) => path.relative(EVIDENCE_ROOT, file).replace(/\\/g, "/"));
if (!dryRun) {
  publishEvidenceBundle({
    consent,
    command: "generate-traceability",
    harnessRoot: HARNESS_ROOT,
    consumerRoot: CONSUMER_ROOT,
    evidenceDir: EVIDENCE_ROOT,
    runtimeFiles,
  }, files);
}

console.log(JSON.stringify({
  generatedAt,
  dryRun,
  ledger: path.relative(CONSUMER_ROOT, ledgerFile).replace(/\\/g, "/"),
  modules: modules.length,
  totals: ledger.totals,
  completeness,
}, null, 2));

if (!completeness.fileAccountingComplete) process.exitCode = 2;
