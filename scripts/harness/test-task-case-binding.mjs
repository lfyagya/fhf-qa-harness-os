#!/usr/bin/env node
// Scenario and test-data binding. Scenarios live in whichever registry owns them - the spec repo's
// test_scenario_groups, or a sprint regression checklist - and the manifest cites one. Structural
// rules are pure; resolving a citation and a fixture key needs the filesystem and runs through the CLI.
// Run: node scripts/harness/test-task-case-binding.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateTaskManifest } from "./task-protocol-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKLIST = "docs/evidence/regression-effort/records/sprint-26.3.5/regression-checklist.yaml";
const INVOICE_SPEC = "specs/modules/ancillary/ACD-Letters/monthly-dealer-invoice.yaml";

const base = {
  grounding: {
    intentVsBuilt: { rows: [{ id: "ivb-1", classification: "same" }] },
    repositories: [{ id: "front-end-automation-e2e" }],
  },
  plan: {
    tests: [{
      id: "t-1", runnerId: "frontend-e2e", repoId: "front-end-automation-e2e",
      proofMode: "external-execution-evidence", environment: "dev", honesty: "seeded",
      acceptanceIds: ["ivb-1"], path: "a/b.cy.js", assertion: "x",
      scenarioRef: { registry: "regression-checklist", source: CHECKLIST, group: "B14.3" },
      testData: {
        fixture: "CypressFHF/fhf-dashboards/cypress/fixtures/unifi/collections/pinnedAccounts.json",
        key: "dpdUnder17",
      },
    }],
  },
};
const of = (mutate) => { const m = structuredClone(base); mutate(m); return validateTaskManifest(m, {}).join(" | "); };
const has = (issues, needle) => assert.ok(issues.includes(needle), `expected /${needle}/ in: ${issues}`);

// --- structural (pure lib) ---
has(of((m) => { delete m.plan.tests[0].testData; }), "must reference a fixture key");
has(of((m) => { m.plan.tests[0].testData = { key: "x" }; }), "repo-relative fixture path");
has(of((m) => { m.plan.tests[0].testData = { none: "" }; }), "must give a reason");
has(of((m) => { delete m.plan.tests[0].scenarioRef; }), "must cite the registry that owns the scenario");
has(of((m) => { m.plan.tests[0].scenarioRef.registry = "invented"; }), "registry must be one of");
has(of((m) => { delete m.plan.tests[0].scenarioRef.group; }), "must name the scenario group or row");

// A spec-group citation must say which rules it covers; a checklist row must not pretend to.
has(of((m) => { m.plan.tests[0].scenarioRef = { registry: "spec-test-scenario-groups", source: "specs/x.yaml", group: "G" }; }),
  "covers must list the rule IDs");
has(of((m) => { m.plan.tests[0].scenarioRef.covers = ["BR-1"]; }), "covers applies only to spec-test-scenario-groups");

// The retired vocabulary must fail loudly rather than be silently ignored.
has(of((m) => { m.plan.scenarios = [{ id: "S1" }]; }), "plan.scenarios is retired");
has(of((m) => { m.plan.tests[0].scenarioIds = ["S1"]; }), "scenarioIds is retired");

for (const issues of [of(() => {}), of((m) => { m.plan.tests[0].testData = { none: "Reads computed styles only." }; })]) {
  assert.ok(!/testData|scenarioRef|plan\.scenarios/.test(issues), `unexpected binding issue: ${issues}`);
}

// --- filesystem (CLI) ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "task-case-binding-"));
try {
  const write = (m) => {
    const f = path.join(tmp, "task.json");
    fs.writeFileSync(f, JSON.stringify(m));
    return f;
  };
  const issuesOf = (m, env = {}) => (JSON.parse(spawnSync(process.execPath,
    [path.join(HERE, "task-protocol.mjs"), "validate", "--manifest", write(m)],
    { encoding: "utf8", env: { ...process.env, ...env } }).stdout || "{}").issues ?? []).join(" | ");

  const badKey = structuredClone(base);
  badKey.plan.tests[0].testData.key = "noSuchAccountKey";
  assert.match(issuesOf(badKey), /noSuchAccountKey" is absent/);

  const badFile = structuredClone(base);
  badFile.plan.tests[0].testData.fixture = "cypress/fixtures/does/not/exist.json";
  assert.match(issuesOf(badFile), /fixture not found/);

  // A cited checklist row that does not exist must be caught, not shrugged off.
  const badRow = structuredClone(base);
  badRow.plan.tests[0].scenarioRef.group = "B99.9";
  assert.match(issuesOf(badRow), /"B99\.9" is not a row in/);

  const badRegistryFile = structuredClone(base);
  badRegistryFile.plan.tests[0].scenarioRef.source = "docs/evidence/no-such-checklist.yaml";
  assert.match(issuesOf(badRegistryFile), /registry file not found/);

  // Spec-repo registry: a group that is not a test_scenario_groups prefix must be caught.
  const badGroup = structuredClone(base);
  badGroup.plan.tests[0].scenarioRef = {
    registry: "spec-test-scenario-groups",
    source: INVOICE_SPEC,
    group: "No Such Group",
    covers: ["BR-MDI-001"],
  };
  assert.match(issuesOf(badGroup), /is not a test_scenario_groups prefix/);

  // A real group citing a rule it does not cover must be caught.
  const badCovers = structuredClone(badGroup);
  badCovers.plan.tests[0].scenarioRef.group = "Invoice Idempotency";
  badCovers.plan.tests[0].scenarioRef.covers = ["BR-MDI-001"];
  assert.match(issuesOf(badCovers), /does not cover in/);

  // The same group citing rules it really does cover must raise nothing.
  const goodCovers = structuredClone(badGroup);
  goodCovers.plan.tests[0].scenarioRef.group = "Invoice Idempotency";
  goodCovers.plan.tests[0].scenarioRef.covers = ["BR-MDI-012", "EG-MDI-001"];
  assert.ok(!/scenarioRef/.test(issuesOf(goodCovers)), `real group must resolve: ${issuesOf(goodCovers)}`);

  // An unchecked-out repository must skip, not block.
  const canonicalConfig = path.resolve(HERE, "..", "..", "config", "qa-control-plane.json");
  const cfg = JSON.parse(fs.readFileSync(canonicalConfig, "utf8"));
  cfg.productTopology.repositories["front-end-automation-e2e"].root = "not-checked-out-here";
  cfg.paths.applicationIntelligence = "not-checked-out-either/specs";
  const absentConfig = path.join(tmp, "absent-repo-config.json");
  fs.writeFileSync(absentConfig, JSON.stringify(cfg));
  const absent = issuesOf(base, { FHF_HARNESS_CONFIG: absentConfig });
  assert.ok(!/fixture not found|is absent|registry file not found/.test(absent),
    `absent repositories must not raise binding issues, got: ${absent}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("test-case-binding self-check passed");
