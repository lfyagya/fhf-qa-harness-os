#!/usr/bin/env node
// Lane-local keep-list: a target-owned file that canonical lacks must survive sync, including
// --force. Before the keep-list, copyDirSync deleted anything canonical did not have, which is
// how the e2e selector-liveness gate came within one bare --force of being destroyed.
// Run: node scripts/harness/test-lane-local-paths.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = path.resolve(HERE, "..", "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lane-local-"));
const lane = path.join(tmp, "lane");
const KEEP = ".claude/hooks/lane-only.mjs";
const DROP = ".claude/hooks/stale-orphan.mjs";

function seed(rel) {
  const file = path.join(lane, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "// lane-owned\n");
  return file;
}

function runSync(configPath, extraArgs) {
  return execFileSync(process.execPath,
    [path.join(HERE, "sync-loader-shims.mjs"), "--only-e2e", ...extraArgs], {
      encoding: "utf8",
      env: { ...process.env,
        FHF_HARNESS_CONFIG: configPath,
        FHF_E2E_TARGET_ROOT: lane,
        FHF_SYNC_MANIFEST: path.join(tmp, "manifest.json") },
    });
}

function configWith(paths) {
  const cfg = JSON.parse(fs.readFileSync(path.join(HARNESS_ROOT, "config", "qa-control-plane.json"), "utf8"));
  cfg.engineering.harness.laneLocalPaths = paths;
  const file = path.join(tmp, `config-${paths.length}.json`);
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return file;
}

try {
  const kept = seed(KEEP);
  const dropped = seed(DROP);

  // --force is the failure mode the keep-list exists to survive.
  runSync(configWith([KEEP]), ["--force"]);
  assert.ok(fs.existsSync(kept), "lane-local file was deleted despite being on the keep-list");
  assert.ok(!fs.existsSync(dropped), "orphan not on the keep-list should still be removed by --force");

  // An empty keep-list must not protect anything — otherwise the check is vacuous.
  const reseeded = seed(KEEP);
  runSync(configWith([]), ["--force"]);
  assert.ok(!fs.existsSync(reseeded), "empty keep-list must not protect a lane-local file");

  // Directory entries cover a whole lane-owned subtree.
  const nested = seed(".claude/hooks/lane-lib/deep/thing.mjs");
  runSync(configWith([".claude/hooks/lane-lib"]), ["--force"]);
  assert.ok(fs.existsSync(nested), "directory keep-list entry must protect its whole subtree");

  console.log("lane-local keep-list self-check passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
