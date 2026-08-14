import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "sync-loader-shims.mjs");
const driftScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "check-loader-drift.mjs");
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
  const initializedManifest = JSON.parse(fs.readFileSync(manifest, "utf8"));
  assert.ok(Object.keys(initializedManifest).every((key) => !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(key)));
  assert.ok(Object.keys(initializedManifest).every((key) => /^(?:harness|consumer)\//.test(key)));
  const beforeTarget = fs.readFileSync(guarded, "utf8");
  const beforeManifest = fs.readFileSync(manifest, "utf8");

  const roster = [
    "# FHF Fixture",
    "| Cypress work | Agent |",
    "| --- | --- |",
    "| Build tests | `cypress-generator` |",
    "| Review before merge | `cypress-gate` |",
    "| Debug failures/flakiness | `cypress-debugger` |",
    "| Open PR or report coverage | `cypress-shipper` |",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, "AGENTS.md"), roster, "utf8");
  for (const lane of [
    path.join(root, "AG Frontend Automation", "front-end-automation"),
    path.join(root, "ProdSmokeExecution", "front-end-automation"),
  ]) {
    fs.writeFileSync(path.join(lane, "AGENTS.md"), "# Fixture\n", "utf8");
  }
  const completeProjection = spawnSync(process.execPath, [driftScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      FHF_SYNC_TARGET_ROOT: root,
      FHF_SYNC_MANIFEST: manifest,
    },
  });
  assert.equal(completeProjection.status, 0, completeProjection.stderr);

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

  const e2eReadme = path.join(root, "AG Frontend Automation", "front-end-automation", "README.md");
  const ownerCursor = path.join(root, "AG Frontend Automation", "front-end-automation", ".cursor", "BUGBOT.md");
  assert.equal(fs.existsSync(path.join(root, ".harness", "verify.mjs")), true);
  assert.equal(fs.existsSync(path.join(root, ".harness", "record-loop-event.mjs")), true);
  assert.equal(fs.existsSync(path.join(root, ".harness", "portable-runtime-state.mjs")), true);
  assert.equal(fs.existsSync(path.join(root, "ProdSmokeExecution", "front-end-automation", ".harness", "verify.mjs")), true);
  assert.equal(fs.existsSync(path.join(root, "ProdSmokeExecution", "front-end-automation", ".harness", "record-loop-event.mjs")), true);

  const rootOnly = path.join(root, "root-only");
  const rootOnlyRun = spawnSync(process.execPath, [script, "--force", "--only-root"], {
    encoding: "utf8",
    env: {
      ...process.env,
      FHF_SYNC_TARGET_ROOT: rootOnly,
      FHF_SYNC_MANIFEST: path.join(rootOnly, "sync-manifest.json"),
    },
  });
  assert.equal(rootOnlyRun.status, 0, rootOnlyRun.stderr);
  assert.equal(fs.existsSync(path.join(rootOnly, ".claude", "harness.config.json")), true);
  assert.equal(fs.existsSync(path.join(rootOnly, "AG Frontend Automation")), false);
  assert.equal(fs.existsSync(path.join(rootOnly, "ProdSmokeExecution")), false);

  const baselineOnly = path.join(root, "baseline-only");
  const baselineEnv = {
    ...process.env,
    FHF_SYNC_TARGET_ROOT: root,
    FHF_BASELINE_TARGET: baselineOnly,
    FHF_SYNC_MANIFEST: path.join(baselineOnly, "sync-manifest.json"),
  };
  const baselineRun = spawnSync(process.execPath, [script, "--force", "--only-baseline"], {
    encoding: "utf8",
    env: baselineEnv,
  });
  assert.equal(baselineRun.status, 0, baselineRun.stderr);
  assert.equal(fs.existsSync(path.join(baselineOnly, ".claude", "harness.config.json")), true);
  assert.equal(fs.existsSync(path.join(baselineOnly, "CLAUDE.md")), true);
  assert.equal(fs.existsSync(path.join(baselineOnly, "AGENTS.md")), true);
  assert.equal(fs.existsSync(path.join(baselineOnly, ".harness", "verify.mjs")), true);
  const baselineCheck = spawnSync(process.execPath, [driftScript, "--only-baseline"], {
    encoding: "utf8",
    env: baselineEnv,
  });
  assert.equal(baselineCheck.status, 0, baselineCheck.stderr);
  fs.mkdirSync(path.dirname(ownerCursor), { recursive: true });
  fs.writeFileSync(ownerCursor, "owner cursor file\n", "utf8");
  fs.writeFileSync(e2eReadme, "owner e2e readme\n", "utf8");
  const skipped = run(["--force", "--skip-e2e"]);
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(fs.readFileSync(ownerCursor, "utf8"), "owner cursor file\n");
  assert.equal(fs.readFileSync(e2eReadme, "utf8"), "owner e2e readme\n");

  const linkedSource = path.join(root, "linked-source");
  const linkedFhf = path.join(root, "linked-fhf");
  const linkedE2e = path.join(linkedFhf, "AG Frontend Automation", "front-end-automation");
  fs.mkdirSync(linkedSource, { recursive: true });
  execFileSync("git", ["init", linkedSource]);
  execFileSync("git", ["-C", linkedSource, "config", "user.email", "harness@example.invalid"]);
  execFileSync("git", ["-C", linkedSource, "config", "user.name", "Harness Test"]);
  fs.writeFileSync(path.join(linkedSource, "README.md"), "fixture\n", "utf8");
  fs.writeFileSync(path.join(linkedSource, "AGENTS.md"), "# Fixture\n", "utf8");
  execFileSync("git", ["-C", linkedSource, "add", "README.md", "AGENTS.md"]);
  execFileSync("git", ["-C", linkedSource, "commit", "-m", "fixture"]);
  fs.mkdirSync(path.dirname(linkedE2e), { recursive: true });
  execFileSync("git", ["-C", linkedSource, "worktree", "add", "-b", "projection", linkedE2e]);
  const linked = spawnSync(process.execPath, [script, "--force", "--only-e2e"], {
    encoding: "utf8",
    env: {
      ...process.env,
      FHF_SYNC_TARGET_ROOT: linkedFhf,
      FHF_SYNC_MANIFEST: path.join(linkedFhf, "sync-manifest.json"),
    },
  });
  assert.equal(linked.status, 0, linked.stderr);
  assert.equal(fs.existsSync(path.join(linkedE2e, ".claude", "harness.config.json")), true);
  assert.equal(fs.existsSync(path.join(linkedE2e, ".harness", "verify.mjs")), true);
  assert.equal(fs.existsSync(path.join(linkedE2e, ".harness", "record-loop-event.mjs")), true);
  assert.equal(fs.existsSync(path.join(linkedE2e, ".harness", "portable-runtime-state.mjs")), true);
  assert.equal(fs.existsSync(path.join(linkedE2e, ".cursor", "hooks.json")), true);
  assert.equal(fs.existsSync(path.join(linkedE2e, ".github", "copilot-instructions.md")), true);
  assert.equal(fs.existsSync(path.join(linkedE2e, "GEMINI.md")), true);
  assert.equal(fs.existsSync(path.join(linkedFhf, ".claude", "harness.config.json")), false);

  const linkedSmoke = path.join(linkedFhf, "ProdSmokeExecution", "front-end-automation");
  fs.mkdirSync(path.dirname(linkedSmoke), { recursive: true });
  execFileSync("git", ["-C", linkedSource, "worktree", "add", "-b", "smoke-projection", linkedSmoke]);
  const smoke = spawnSync(process.execPath, [script, "--force", "--only-smoke"], {
    encoding: "utf8",
    env: {
      ...process.env,
      FHF_SYNC_TARGET_ROOT: linkedFhf,
      FHF_SYNC_MANIFEST: path.join(linkedFhf, "sync-manifest.json"),
    },
  });
  assert.equal(smoke.status, 0, smoke.stderr);
  assert.equal(fs.existsSync(path.join(linkedSmoke, ".claude", "harness.config.json")), true);
  const smokeCheck = spawnSync(process.execPath, [driftScript, "--only-smoke"], {
    encoding: "utf8",
    env: {
      ...process.env,
      FHF_SYNC_TARGET_ROOT: linkedFhf,
      FHF_SYNC_MANIFEST: path.join(linkedFhf, "sync-manifest.json"),
    },
  });
  assert.equal(smokeCheck.status, 0, smokeCheck.stderr);
  const smokePointer = path.join(linkedSmoke, "AGENTS.md");
  fs.writeFileSync(smokePointer, "FHF/docs/architecture/HARNESS.md\n", "utf8");
  const smokePointerCheck = spawnSync(process.execPath, [driftScript, "--only-smoke"], {
    encoding: "utf8",
    env: {
      ...process.env,
      FHF_SYNC_TARGET_ROOT: linkedFhf,
      FHF_SYNC_MANIFEST: path.join(linkedFhf, "sync-manifest.json"),
    },
  });
  assert.notEqual(smokePointerCheck.status, 0);

  console.log("sync-loader safety tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
