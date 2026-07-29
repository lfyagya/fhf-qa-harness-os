import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "sync-loader-shims.mjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fhf-sync-loader-"));
const manifest = path.join(root, "sync-manifest.json");
const guarded = path.join(root, ".cursor", "hooks.json");

function run(args = [], extraEnv = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      FHF_SYNC_TARGET_ROOT: root,
      FHF_SYNC_MANIFEST: manifest,
      ...extraEnv,
    },
  });
}

function transactionArtifacts(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory()
      ? transactionArtifacts(target)
      : /\.(tmp|bak)$/.test(entry.name) ? [target] : [];
  });
}

try {
  fs.mkdirSync(path.dirname(guarded), { recursive: true });
  fs.writeFileSync(guarded, "owner content\n", "utf8");

  const blocked = run();
  assert.notEqual(blocked.status, 0);
  assert.equal(fs.readFileSync(guarded, "utf8"), "owner content\n");
  assert.equal(fs.existsSync(manifest), false);

  const legacyCodexDirs = [
    path.join(root, ".codex"),
    path.join(root, "ProdSmokeExecution", "front-end-automation", ".codex"),
  ];
  legacyCodexDirs.forEach((directory) => fs.mkdirSync(directory, { recursive: true }));
  const initialized = run(["--force"]);
  assert.equal(initialized.status, 0, initialized.stderr);
  legacyCodexDirs.forEach((directory) => assert.equal(fs.existsSync(directory), false));
  const beforeTarget = fs.readFileSync(guarded, "utf8");
  const beforeManifest = fs.readFileSync(manifest, "utf8");

  const lock = `${manifest}.lock`;
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }), "utf8");
  const concurrent = run();
  assert.notEqual(concurrent.status, 0);
  assert.equal(fs.readFileSync(guarded, "utf8"), beforeTarget);
  assert.equal(fs.readFileSync(manifest, "utf8"), beforeManifest);
  fs.rmSync(lock);

  const interrupted = run([], { FHF_SYNC_FAIL_AFTER_PUBLISH: "1" });
  assert.notEqual(interrupted.status, 0);
  assert.equal(fs.readFileSync(guarded, "utf8"), beforeTarget);
  assert.equal(fs.readFileSync(manifest, "utf8"), beforeManifest);
  assert.deepEqual(transactionArtifacts(root), []);

  console.log("sync-loader safety tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
