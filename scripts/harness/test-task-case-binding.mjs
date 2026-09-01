#!/usr/bin/env node
// Self-check for the requirement -> scenario -> test-case-with-data chain.
// Run: node scripts/harness/test-task-case-binding.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateTaskManifest } from "./task-protocol-lib.mjs";

const base = {
  grounding: { intentVsBuilt: { rows: [{ id: "ivb-1", classification: "same" }] } },
  plan: {
    scenarios: [{ id: "S1", acceptanceIds: ["ivb-1"], description: "Delinquent account shows a payment path." }],
    tests: [{
      id: "t-1", runnerId: "frontend-e2e", repoId: "front-end-automation-e2e",
      proofMode: "external-execution-evidence", environment: "dev", honesty: "seeded",
      acceptanceIds: ["ivb-1"], scenarioIds: ["S1"], path: "a/b.cy.js", assertion: "x",
      testData: { fixture: "CypressFHF/fhf-dashboards/cypress/fixtures/unifi/collections/pinnedAccounts.json", key: "dpdUnder17" },
    }],
  },
};
const of = (mutate) => { const m = structuredClone(base); mutate(m); return validateTaskManifest(m, {}).join(" | "); };
const has = (issues, needle) => assert.ok(issues.includes(needle), `expected /${needle}/ in: ${issues}`);

assert.equal(of((m) => { delete m.plan.tests[0].testData; }).includes("must reference a fixture key"), true);
has(of((m) => { m.plan.tests[0].testData = { key: "x" }; }), "repo-relative fixture path");
has(of((m) => { m.plan.tests[0].scenarioIds = ["S9"]; }), "unknown plan.scenarios row S9");
has(of((m) => { delete m.plan.tests[0].scenarioIds; }), "must cite at least one plan.scenarios row");
has(of((m) => { m.plan.scenarios[0].acceptanceIds = ["ivb-99"]; }), "unknown intentVsBuilt row ivb-99");
assert.equal(of((m) => { m.plan.tests[0].testData = { none: "" }; }).includes("must give a reason"), true);

// Valid shapes produce no binding complaints.
for (const issues of [of(() => {}), of((m) => { m.plan.tests[0].testData = { none: "Contrast check reads computed CSS only." }; })]) {
  assert.ok(!/testData|scenarioIds|plan\.scenarios/.test(issues), `unexpected binding issue: ${issues}`);
}
// Filesystem half: structural checks live in the lib, existence lives in the CLI, so it needs
// a real spawn to be covered at all.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "task-case-binding-"));
try {
  const write = (m) => {
    const f = path.join(tmp, "task.json");
    fs.writeFileSync(f, JSON.stringify(m));
    return f;
  };
  const validate = (m) => JSON.parse(spawnSync(process.execPath,
    [path.join(HERE, "task-protocol.mjs"), "validate", "--manifest", write(m)],
    { encoding: "utf8" }).stdout || "{}");

  const badKey = structuredClone(base);
  badKey.plan.tests[0].testData.key = "noSuchAccountKey";
  const keyIssues = (validate(badKey).issues ?? []).join(" | ");
  assert.match(keyIssues, /noSuchAccountKey" is absent/, `expected absent-key issue, got: ${keyIssues}`);

  const badFile = structuredClone(base);
  badFile.plan.tests[0].testData.fixture = "cypress/fixtures/does/not/exist.json";
  const fileIssues = (validate(badFile).issues ?? []).join(" | ");
  assert.match(fileIssues, /fixture not found/, `expected missing-fixture issue, got: ${fileIssues}`);

  // An unchecked-out repository must skip, not block: partial checkouts are normal. Every
  // topology repo is present on a full meta-root, so point the config at a root that is not.
  const canonicalConfig = path.resolve(HERE, "..", "..", "config", "qa-control-plane.json");
  const cfg = JSON.parse(fs.readFileSync(canonicalConfig, "utf8"));
  cfg.productTopology.repositories["front-end-automation-e2e"].root = "not-checked-out-here";
  const absentConfig = path.join(tmp, "absent-repo-config.json");
  fs.writeFileSync(absentConfig, JSON.stringify(cfg));
  const absentIssues = (JSON.parse(spawnSync(process.execPath,
    [path.join(HERE, "task-protocol.mjs"), "validate", "--manifest", write(base)],
    { encoding: "utf8", env: { ...process.env, FHF_HARNESS_CONFIG: absentConfig } },
  ).stdout || "{}").issues ?? []).join(" | ");
  assert.ok(!/fixture not found|is absent/.test(absentIssues),
    `absent repository must not raise a fixture issue, got: ${absentIssues}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("test-case-binding self-check passed");
