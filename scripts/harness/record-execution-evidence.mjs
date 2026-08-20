// Appends one execution/risk evidence entry to FHF/docs/evidence/execution-history.md.
// Coverage evidence (generate-coverage.mjs) answers "does a test exist?" — this answers
// "when it ran, what happened?" (failure patterns, flakiness, timing). Distinct registries,
// same split as paper-os's Coverage/Execution/Risk evidence types.
//
// Usage: node record-execution-evidence.mjs '<json>'
// JSON shape: { date, module, lane, runId, runUrl, passed, failed, flaky, categories, notes }
// categories: array of failure category strings (see cypress-debugger.md "Classify")
// Intended caller: cypress-debugger, after producing its fix plan (see that agent's
// "Cloud Investigation" step 5). Can also be invoked manually after any Cloud run investigation.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FHF_ROOT = process.env.FHF_CONSUMER_ROOT
  ? path.resolve(process.env.FHF_CONSUMER_ROOT)
  : path.resolve(HARNESS_ROOT, "..", "FHF");
const OUT = path.join(FHF_ROOT, "docs", "evidence", "execution-history.md");

const raw = process.argv[2];
if (!raw) {
  console.error("Usage: node record-execution-evidence.mjs '<json>'");
  console.error("Required fields: date, module, lane, runId, passed, failed, flaky");
  process.exit(1);
}

let entry;
try {
  entry = JSON.parse(raw);
} catch {
  console.error("Argument is not valid JSON.");
  process.exit(1);
}

const required = ["date", "module", "lane", "runId", "passed", "failed", "flaky"];
const missing = required.filter((k) => entry[k] === undefined || entry[k] === null || entry[k] === "");
if (missing.length) {
  console.error(`Missing required field(s): ${missing.join(", ")}`);
  process.exit(1);
}

const categories = Array.isArray(entry.categories) ? entry.categories.join(", ") : "";
const runLink = entry.runUrl ? `[${entry.runId}](${entry.runUrl})` : entry.runId;
const row = `| ${entry.date} | ${entry.module} | ${entry.lane} | ${runLink} | ${entry.passed} | ${entry.failed} | ${entry.flaky} | ${categories} | ${entry.notes ?? ""} |`;

const HEADER = [
  "# Execution & Risk History — Append-Only Ledger",
  "",
  "> **Written by `node scripts/harness/record-execution-evidence.mjs` — never hand-edit.**",
  "> Coverage evidence (`coverage-computed.json`) answers \"does a test exist?\". This answers \"when it ran, what happened?\" — failure patterns, flakiness, timing, per module. Populated after `cypress-debugger` investigates a Cypress Cloud run (see that agent's \"Cloud Investigation\" step).",
  "",
  "| Date | Module | Lane | Run | Passed | Failed | Flaky | Failure Categories | Notes |",
  "|---|---|---|---|---|---|---|---|---|",
].join("\n");

if (!fs.existsSync(OUT)) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${HEADER}\n${row}\n`);
} else {
  fs.appendFileSync(OUT, `${row}\n`);
}

console.log(`Recorded evidence for ${entry.module} (${entry.lane}, run ${entry.runId}) to ${path.relative(FHF_ROOT, OUT)}`);
