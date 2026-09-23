#!/usr/bin/env node
// Runs engineering.harness.verify.canonical.
//
// Why this exists: that list named 18 scripts and nothing executed it. check-docs-links.mjs
// asserted only that each file existed, and the sole trigger in the repository was an
// unversioned .git/hooks/pre-commit running 4 of them - so a fresh clone enforced nothing and
// "run the canonical checks" meant typing 18 commands from memory. The list was already
// declared; this is the loop that reads it.
//
// The list stays in the control plane. Adding a check here means adding it there, which is
// reviewed, rather than to a second list that drifts from the first.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG = path.join(HARNESS_ROOT, "config", "qa-control-plane.json");
const listOnly = process.argv.includes("--list");

let scripts;
try {
  const config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  scripts = config.engineering?.harness?.verify?.canonical;
} catch (error) {
  console.error(`Cannot read ${path.relative(HARNESS_ROOT, CONFIG)}: ${error.message}`);
  process.exit(2);
}

if (!Array.isArray(scripts) || scripts.length === 0) {
  console.error("engineering.harness.verify.canonical must be a non-empty list.");
  process.exit(2);
}

if (listOnly) {
  scripts.forEach((script) => console.log(script));
  process.exit(0);
}

const failed = [];
const started = Date.now();

for (const script of scripts) {
  const target = path.join(HARNESS_ROOT, script);
  if (!fs.existsSync(target)) {
    // Fail rather than skip: a canonical check that is named but absent is the exact state this
    // runner exists to make visible.
    console.error(`MISSING  ${script}`);
    failed.push(script);
    continue;
  }
  const at = Date.now();
  const run = spawnSync(process.execPath, [target], { cwd: HARNESS_ROOT, encoding: "utf8" });
  const seconds = ((Date.now() - at) / 1000).toFixed(1);
  if (run.status === 0) {
    console.log(`PASS  ${script} (${seconds}s)`);
    continue;
  }
  console.error(`FAIL  ${script} (${seconds}s, exit ${run.status ?? "signal"})`);
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trimEnd();
  if (output) console.error(output.split("\n").map((line) => `      ${line}`).join("\n"));
  failed.push(script);
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
if (failed.length) {
  console.error(`\n${failed.length} of ${scripts.length} canonical checks failed in ${elapsed}s:`);
  failed.forEach((script) => console.error(`- ${script}`));
  process.exit(1);
}

console.log(`\nAll ${scripts.length} canonical checks passed in ${elapsed}s.`);
