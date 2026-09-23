#!/usr/bin/env node
// Rebuilds only the traceability index from an existing ledger. The full generator re-reads every
// repository at its frozen SHA and takes minutes; regenerating one derived summary should not.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publishEvidenceBundle } from "./evidence-export-policy.mjs";
import { resolveConsumerRoot } from "./workspace-paths.mjs";
import { renderIndexReport } from "./traceability-lib.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONSUMER_ROOT = resolveConsumerRoot(HARNESS_ROOT);
const CONFIG = JSON.parse(fs.readFileSync(path.join(HARNESS_ROOT, "config", "qa-control-plane.json"), "utf8"));
const TRACE_CONFIG = CONFIG.paths.traceability;
const OUTPUT_ROOT = path.resolve(CONSUMER_ROOT, TRACE_CONFIG.outputRoot);
const EVIDENCE_ROOT = path.resolve(CONSUMER_ROOT, CONFIG.paths.evidenceDir);
const consentIndex = process.argv.indexOf("--consent");
const consent = consentIndex >= 0 ? process.argv[consentIndex + 1] : null;

const ledgerFile = path.join(OUTPUT_ROOT, TRACE_CONFIG.ledger);
if (!fs.existsSync(ledgerFile)) {
  throw new Error(`No ledger at ${ledgerFile}. Run generate-traceability.mjs first.`);
}
const ledger = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
const indexFile = path.join(OUTPUT_ROOT, TRACE_CONFIG.index);
const content = renderIndexReport(ledger, TRACE_CONFIG.moduleReportRoot);

publishEvidenceBundle({
  consent,
  command: "traceability-index",
  harnessRoot: HARNESS_ROOT,
  consumerRoot: CONSUMER_ROOT,
  evidenceDir: EVIDENCE_ROOT,
  runtimeFiles: [path.relative(EVIDENCE_ROOT, indexFile).replace(/\\/g, "/")],
}, [{ file: indexFile, content }]);

console.log(`Wrote ${path.relative(CONSUMER_ROOT, indexFile).replace(/\\/g, "/")} (${content.length} bytes) from ledger ${ledger.generatedAt}.`);
