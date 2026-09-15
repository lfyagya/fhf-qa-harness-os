#!/usr/bin/env node
// Why this exists (2026-09-16): the model cannot tell, from a spec alone, whether a business rule
// is verified anywhere. It will infer a link from a familiar-looking module or file name and route
// a task to the wrong details with full confidence. build-knowledge-index.mjs measured the real
// state - 0 of 611 rules traced, 0 of 234 endpoints and 8 of 356 tables named in any spec - so
// almost every such inference today is a guess. This gate compensates by requiring the edge to be
// declared at the moment a rule is written, when the author knows it, rather than reconstructed
// later by similarity.
//
// PostToolUse:Edit|Write - a business rule written or edited today must declare where it is
// verified. Rationale (2026-09-16): build-knowledge-index.mjs reported 0 of 611 rules traced,
// 0 of 234 endpoints and 8 of 356 tables named in any spec. Those rules are not untested, they
// are unaccounted for - no machine-checkable path runs from the rule to a test, endpoint or
// table, so routing a task to "the right details" is a guess. The 608 rules that predate this
// gate are baselined; this stops the gap growing while the backfill happens separately.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hookContent, hookFilePath } from "./lib/hook-payload.mjs";
import { emitAllow } from "./lib/hook-runtime.mjs";
import { untracedRules, tracedButBaselined, parseRuleTraces, loadTraceUniverse, resolveTraces } from "./lib/spec-linkage.mjs";
import { loadHarnessConfig } from "./lib/harness-config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = path.join(HERE, "linkage-baseline.json");

let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, "utf8")); } catch {}

const filePath = hookFilePath(payload);
const content = hookContent(payload);

// Only application specs carry business_rules. Anything else is none of this gate's business.
if (!filePath || !/\.ya?ml$/i.test(filePath) || !/[\\/]specs[\\/]/.test(filePath)) {
  emitAllow(payload);
  process.exit(0);
}

const text = content ?? (fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "");
if (!text.includes("business_rules:")) {
  emitAllow(payload);
  process.exit(0);
}

let baseline = new Set();
try {
  const parsed = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
  baseline = new Set(parsed.rules ?? []);
} catch {
  // A missing or unreadable baseline must not silently exempt everything, nor block all spec
  // work. Report it and let the write through - a broken baseline is a harness defect, not a
  // reason to fail an author's edit.
  console.error("validate-spec-linkage: linkage-baseline.json is missing or invalid; not enforcing.");
  emitAllow(payload);
  process.exit(0);
}

// Resolve what the spec declares. A declared edge that names something non-existent is a fake
// edge: the arrow is drawn and no data flows along it. Declaring is cheap, so resolution is what
// makes the declaration worth anything.
function traceRoots() {
  try {
    const config = loadHarnessConfig();
    const root = process.env.CLAUDE_PROJECT_DIR ?? process.env.CURSOR_PROJECT_DIR ?? process.cwd();
    const abs = (rel) => (rel ? path.resolve(root, rel) : null);
    const backendRel = config.paths?.automationLanes?.backend?.root
      ?? config.paths?.lanes?.backend?.root ?? null;
    const laneRoots = Object.values(config.paths?.lanes ?? {})
      .map((lane) => (lane?.root ? abs(path.join(lane.root, lane.package ?? "")) : null))
      .filter(Boolean);
    return { backendRoot: abs(backendRel), laneRoots };
  } catch {
    // No config, no resolution. Existence checks degrade to skipped rather than failing every
    // reference, which is the same choice the baseline fallback makes.
    return { backendRoot: null, laneRoots: [] };
  }
}

const universe = loadTraceUniverse(traceRoots());
const unresolved = [];
const uncited = [];
for (const rule of parseRuleTraces(text)) {
  if (!rule.traced) continue;
  const result = resolveTraces(rule, universe);
  for (const problem of result.unresolved) unresolved.push(`${rule.id}: ${problem}`);
  for (const problem of result.uncited) uncited.push(problem);
}

const untraced = untracedRules(text, baseline);
const stale = tracedButBaselined(text, baseline);

if (stale.length > 0) {
  // Not a block: the author did the right thing. But leaving the id in the baseline means the
  // ratchet stops tightening, so say so loudly.
  console.error(
    `validate-spec-linkage: ${stale.join(", ")} now declare traces but remain in `
    + `.claude/hooks/linkage-baseline.json. Remove them so the baseline keeps shrinking.`,
  );
}

if (uncited.length > 0) {
  // Warned, not blocked: the file exists, and citing a rule id inside a test has almost no
  // adoption yet (6 of 322 test files cite anything). Blocking here would reject correct work.
  console.error("validate-spec-linkage: declared test(s) resolve but do not mention the rule:");
  for (const problem of uncited) console.error(`  ${problem}`);
}

if (unresolved.length > 0) {
  console.error(`BLOCKED: ${unresolved.length} declared trace(s) name something that does not exist.`);
  console.error("");
  for (const problem of unresolved) console.error(`  ${problem}`);
  console.error("");
  console.error("A trace must resolve: an api: name is a key in tests/example_env, a db: name is");
  console.error("declared in tests/commons/db_schema.py, and a tests:/ui: path is a real file.");
  console.error("A declared edge that resolves to nothing is worse than no edge - it reports as");
  console.error("covered while nothing verifies the rule.");
  process.exit(2);
}

if (untraced.length === 0) {
  emitAllow(payload);
  process.exit(0);
}

const total = parseRuleTraces(text).length;
console.error(`BLOCKED: ${untraced.length} of ${total} business rule(s) in this spec declare no traces:.`);
console.error("");
for (const id of untraced) console.error(`  ${id}`);
console.error("");
console.error("A rule needs at least one declared edge. All lists are optional; one non-empty is enough:");
console.error("");
console.error("  business_rules:");
console.error("    - id: BR-XXX-001");
console.error("      traces:");
console.error("        api: [SOME_ENDPOINT_NAME]        # a name from tests/example_env");
console.error("        db: [SOME_TABLE_CONSTANT]        # a constant from tests/commons/db_schema.py");
console.error("        tests: [backend:tests/smoke/x/test_y.py]");
console.error("        ui: [cypress/tests/.../thing.cy.js]");
console.error("");
console.error("Rules that predate this gate are exempt via .claude/hooks/linkage-baseline.json.");
console.error("Never add a new id there - the baseline may only shrink.");
process.exit(2);
