#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SPECS_FOLDER = "Test-Case-Automation-Using-Claude-Agents";
const LANE_FOLDERS = [
  "front-end-automation-e2e",
  "front-end-automation-smoke",
  "fhf-backend-automation",
];

function isDir(value) {
  return fs.existsSync(value) && fs.statSync(value).isDirectory();
}

function resolveFhf() {
  const explicit = process.env.FHF_SYNC_TARGET_ROOT || process.env.FHF_CONSUMER_ROOT;
  if (explicit) return path.resolve(explicit);
  const sibling = path.resolve(HARNESS_ROOT, "..", "FHF");
  if (isDir(sibling)) return sibling;
  return path.resolve("/FHF");
}

function run(script, env) {
  const result = spawnSync(process.execPath, [script], {
    cwd: HARNESS_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  return result.status ?? 1;
}

const fhf = resolveFhf();
const alreadySetUp = isDir(path.join(fhf, ".claude"))
  || fs.existsSync(path.join(fhf, ".harness", "workspace.local.json"));
const mode = alreadySetUp ? "update" : "new";

console.log(`FHF harness ${mode}`);
console.log(`Engine:    ${HARNESS_ROOT}`);
console.log(`Workspace: ${fhf}`);

if (!isDir(fhf)) {
  const suggested = path.resolve(HARNESS_ROOT, "..", "FHF");
  console.error("FHF workspace not found. New machine — clone beside the engine, then rerun this command:");
  console.error(`  mkdir -p "${suggested}"`);
  console.error(`  git clone -b dev     git@github.com:treacyandcoventures/front-end-automation.git "${suggested}/front-end-automation-e2e"`);
  console.error(`  git clone -b staging git@github.com:treacyandcoventures/front-end-automation.git "${suggested}/front-end-automation-smoke"`);
  console.error(`  git clone -b master  git@github.com:treacyandcoventures/fhf-backend-automation.git "${suggested}/fhf-backend-automation"`);
  console.error(`  git clone git@github.com:treacyandcoventures/${SPECS_FOLDER}.git "${suggested}/${SPECS_FOLDER}"`);
  console.error("  node scripts/harness/bootstrap.mjs");
  process.exit(2);
}

const missingLanes = LANE_FOLDERS.filter((folder) => !isDir(path.join(fhf, folder)));
if (missingLanes.length) {
  console.error(`Testing lanes missing under ${fhf}: ${missingLanes.join(", ")}`);
  console.error("Clone those folders, then rerun: node scripts/harness/bootstrap.mjs");
  process.exit(2);
}

const syncStatus = run(path.join(HARNESS_ROOT, "scripts", "harness", "sync-loader-shims.mjs"), {
  FHF_SYNC_TARGET_ROOT: fhf,
});
if (syncStatus !== 0) {
  console.error("Sync failed. If it reports files changed since the last sync, stop and ask — do not use --force.");
  process.exit(syncStatus);
}

const setupStatus = run(path.join(HARNESS_ROOT, "scripts", "harness", "workspace-setup.mjs"), {
  CLAUDE_PROJECT_DIR: fhf,
  CURSOR_PROJECT_DIR: fhf,
  FHF_CONSUMER_ROOT: fhf,
  FHF_SYNC_TARGET_ROOT: fhf,
});
if (setupStatus !== 0) process.exit(setupStatus);

console.log(mode === "new"
  ? "New setup is done. Open the FHF folder in Cursor."
  : "Update is done. Open the FHF folder in Cursor.");
