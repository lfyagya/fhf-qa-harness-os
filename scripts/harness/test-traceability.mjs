#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildCompleteness,
  inferModule,
  mapTestsToSpecs,
  parseCypressTests,
  parsePytestTests,
  parseSpec,
  renderIndexReport,
} from "./traceability-lib.mjs";

const context = { repoId: "lane", sha: "a".repeat(40), file: "tests/example.cy.js" };
const cypress = parseCypressTests(`
describe("Outer", () => {
  context("Inner", () => {
    it("renders the queue", () => {});
    it.only("allows filtering", () => {});
    test.skip("hides archived rows", () => {});
    it(dynamicTitle, () => {});
  });
});
`, context);
assert.equal(cypress.length, 4);
assert.deepEqual(cypress.slice(0, 3).map((test) => test.state), ["active", "only", "skip"]);
assert.ok(cypress[0].suite.includes("Outer"));
assert.equal(cypress[3].resolution, "dynamic-unresolved");
assert.equal(new Set(cypress.map((test) => test.id)).size, cypress.length);

const pytest = parsePytestTests(`
import pytest

class TestQueue:
    @pytest.mark.parametrize("status", ["open", "closed", "pending"])
    def test_status_filter(self, status):
        pass

    @pytest.mark.skip(reason="later")
    def test_hidden_row(self):
        pass

@pytest.mark.parametrize("record", records())
def test_dynamic_records(record):
    pass
`, { ...context, file: "tests/test_queue.py" });
assert.equal(pytest.length, 5);
assert.equal(pytest.filter((test) => test.title === "test_status_filter").length, 3);
assert.ok(pytest.filter((test) => test.title === "test_status_filter").every((test) => test.suite[0] === "TestQueue"));
assert.equal(pytest.find((test) => test.title === "test_hidden_row").state, "skip");
assert.equal(pytest.at(-1).resolution, "dynamic-unresolved");

const spec = parseSpec(`
business_rules:
  - id: BR-Q-001
    statement: Queue rows are visible.
negative_scenarios:
  - id: NG-Q-001
    description: Archived rows remain hidden.
test_scenario_groups:
  - prefix: Queue Visibility
    covers: [BR-Q-001, NG-Q-001]
`, { repoId: "specs", sha: "b".repeat(40), file: "specs/modules/call-center/queue.yaml", module: "call-center" });
assert.equal(spec.requirements.length, 2);
assert.deepEqual(spec.groups[0].covers, ["BR-Q-001", "NG-Q-001"]);

const mapped = mapTestsToSpecs([{
  ...cypress[0],
  module: "call-center",
  subjectHints: [],
  referencedSpecIds: ["BR-Q-001"],
}], { requirements: spec.requirements, groups: spec.groups });
assert.deepEqual(mapped[0].requirementIds, ["BR-Q-001", "NG-Q-001"]);
assert.equal(mapped[0].mappingConfidence, "high");

const duplicateNames = parseCypressTests('it("same",()=>{}); it("same",()=>{});', context);
assert.equal(duplicateNames.length, 2);
assert.notEqual(duplicateNames[0].id, duplicateNames[1].id);
assert.equal(inferModule("dashboards/loss-mitigation/impound.cy.js"), "loss-mitigation");
assert.equal(inferModule("components/events.cy.js"), "shared");

const completeness = buildCompleteness(
  {
    files: [{ declarations: 2 }],
    diagnostics: [{ type: "eligible-file-without-test-declaration" }],
  },
  duplicateNames,
  { diagnostics: [] },
);
assert.equal(completeness.fileAccountingComplete, true);
assert.equal(completeness.literalNoOmissionsClaim, true);

const qualified = buildCompleteness(
  { files: [{ declarations: 1 }], diagnostics: [] },
  [cypress[3]],
  { diagnostics: [] },
);
assert.equal(qualified.fileAccountingComplete, true);
assert.equal(qualified.literalNoOmissionsClaim, false);

// The index exists so the numbers are readable without opening a multi-megabyte file; it must stay
// small, derive its counts from the ledger, and never round a dynamic case up into a coverage claim.
const index = renderIndexReport({
  generatedAt: "2026-09-03T00:00:00.000Z",
  policy: { branch: "test-policy", assertionAuthority: "frozen-product-source-not-test-code" },
  completeness: {
    eligibleTestFiles: 2,
    declarationRecords: 3,
    ledgerTestRecords: 3,
    accountingDelta: 0,
    parseErrors: 0,
    dynamicUnresolved: 1,
    fileAccountingComplete: true,
    literalNoOmissionsClaim: false,
  },
  totals: { testsByLane: { "lane-a": { files: 2, tests: 3 } } },
  baselines: [{ repoId: "lane-a", ref: "origin/dev", sha: "c".repeat(40) }],
  tests: [
    { module: "titles", outcome: "ALIGNED" },
    { module: "titles", outcome: "TEST_WITHOUT_SPEC" },
    { module: "shared", outcome: "DYNAMIC_UNRESOLVED" },
  ],
  specRequirements: [
    { module: "titles", outcome: "ALIGNED" },
    { module: "titles", outcome: "SPEC_WITHOUT_TEST" },
  ],
}, "modules");
assert.ok(index.length < 8000, `index must stay small, got ${index.length} bytes`);
assert.match(index, /\| titles \| 2 \| 1 \| 1 \| 0 \| 2 \| 1 \| \[titles\.md\]\(modules\/titles\.md\) \|/);
assert.match(index, /\| shared \| 1 \| 0 \| 0 \| 1 \| 0 \| 0 \|/);
assert.match(index, /origin\/dev@cccccccccccc/);
assert.match(index, /Literal no-omissions claim: no — 1 dynamic cases/);

console.log("traceability self-check passed");
