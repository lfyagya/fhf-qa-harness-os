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
import { untracedRules, tracedButBaselined, parseRuleTraces } from "./lib/spec-linkage.mjs";

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
