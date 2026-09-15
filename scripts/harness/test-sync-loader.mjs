import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The drift check compares the projection against parentAgents(). Hand-writing the expected
// roster here made the fixture rot the moment the real roster changed - which it did when the
// route-mapped skills landed. Generate it from the same source the check uses.
import { parentAgents } from "./loader-templates.mjs";

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
    path.join(root, "front-end-automation-smoke", ".codex"),
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

  const roster = parentAgents();
  fs.writeFileSync(path.join(root, "AGENTS.md"), roster, "utf8");
  for (const lane of [
    path.join(root, "front-end-automation-e2e"),
    path.join(root, "front-end-automation-smoke"),
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

  // Backend is a full sync consumer: the unflagged sync writes it and the
  // unflagged drift check must catch it drifting. Before this pairing existed,
  // backend was synced by default but never verified, so a stale backend
  // projection stayed green and needed a separate --only-backend run to notice.
  const backendProjection = path.join(root, "fhf-backend-automation", ".harness", "lane.json");
  const backendBefore = fs.readFileSync(backendProjection, "utf8");
  fs.writeFileSync(backendProjection, `${backendBefore}\n// drift\n`, "utf8");
  const backendDrift = spawnSync(process.execPath, [driftScript], {
    encoding: "utf8",
    env: { ...process.env, FHF_SYNC_TARGET_ROOT: root, FHF_SYNC_MANIFEST: manifest },
  });
  assert.notEqual(backendDrift.status, 0, "default drift check must cover the backend consumer");
  assert.match(backendDrift.stderr, /fhf-backend-automation/, backendDrift.stderr);
  fs.writeFileSync(backendProjection, backendBefore, "utf8");

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

  const e2eReadme = path.join(root, "front-end-automation-e2e", "README.md");
  const ownerCursor = path.join(root, "front-end-automation-e2e", ".cursor", "BUGBOT.md");
  assert.equal(fs.existsSync(path.join(root, ".harness", "verify.mjs")), true);
  assert.equal(fs.existsSync(path.join(root, ".harness", "record-loop-event.mjs")), true);
  assert.equal(fs.existsSync(path.join(root, ".harness", "portable-runtime-state.mjs")), true);
  assert.equal(fs.existsSync(path.join(root, ".harness", "backend-task-runner.mjs")), true);
  // ADR-0032: the generic runtime CLIs live only at the workspace root; a lane keeps its
  // identity marker and (for the Cypress lanes) its own execution tooling.
  assert.equal(fs.existsSync(path.join(root, "front-end-automation-smoke", ".harness", "verify.mjs")), false);
  assert.equal(fs.existsSync(path.join(root, "front-end-automation-smoke", ".harness", "prepare-execution.mjs")), true);
  assert.equal(fs.existsSync(path.join(root, "front-end-automation-smoke", ".harness", "record-loop-event.mjs")), false);
  // The lane .npmrc is gitignored, so the key-less template is the only committed carrier of the
  // Windows script-shell line. Assert it ships per lane with that lane's record-key field.
  for (const [lane, laneKey] of [["e2e", "cypress_record_key_e2e"], ["smoke", "cypress_record_key_smoke"]]) {
    const example = path.join(root, `front-end-automation-${lane}`, "CypressFHF", "fhf-dashboards", ".npmrc.example");
    assert.equal(fs.existsSync(example), true, `missing generated .npmrc.example for ${lane}`);
    const text = fs.readFileSync(example, "utf8");
    assert.ok(text.includes("script-shell=C:\\Program Files\\Git\\bin\\bash.exe"), "template must pin Git\\bin\\bash.exe");
    const shellLine = text.split("\n").map((line) => line.trim()).find((line) => line.startsWith("script-shell="));
    assert.ok(shellLine && !shellLine.includes("Git\\usr\\bin"), "script-shell must not use the coreutils-less usr\\bin shell");
    assert.match(text, new RegExp(`^${laneKey}=$`, "m"), `${lane} example must expose ${laneKey}`);
    assert.doesNotMatch(text, /^cypress_record_key_\w+=.+$/m, "template must never carry a record key value");
  }

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
  assert.equal(fs.existsSync(path.join(rootOnly, "front-end-automation-e2e")), false);
  assert.equal(fs.existsSync(path.join(rootOnly, "front-end-automation-smoke")), false);

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
  const linkedE2e = path.join(linkedFhf, "front-end-automation-e2e");
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
  assert.equal(fs.existsSync(path.join(linkedE2e, ".harness", "lane.json")), true);
  assert.equal(fs.existsSync(path.join(linkedE2e, ".harness", "verify.mjs")), false);
  assert.equal(fs.existsSync(path.join(linkedE2e, ".harness", "prepare-execution.mjs")), true);
  assert.equal(fs.existsSync(path.join(linkedE2e, ".harness", "record-loop-event.mjs")), false);
  assert.equal(fs.existsSync(path.join(linkedE2e, ".harness", "portable-runtime-state.mjs")), false);
  // ADR-0032: the Cursor adapter loads the vendored hooks, which now live only at the
  // workspace root, so the lane must NOT receive a hooks.json pointing at absent files.
  assert.equal(fs.existsSync(path.join(linkedE2e, ".cursor", "hooks.json")), false);
  assert.equal(fs.existsSync(path.join(linkedE2e, ".github", "copilot-instructions.md")), true);
  assert.equal(fs.existsSync(path.join(linkedE2e, "GEMINI.md")), true);
  const e2eArchitecture = fs.readFileSync(path.join(linkedE2e, "ARCHITECTURE.md"), "utf8");
  assert.match(e2eArchitecture, /harness\.config\.json#policyGovernance/);
  assert.match(e2eArchitecture, /does not own loan thresholds, statuses, dropdown values/);
  assert.match(e2eArchitecture, /unknown applicability.*blocks enforcement/s);
  assert.equal(fs.existsSync(path.join(linkedFhf, ".claude", "harness.config.json")), false);

  const linkedSmoke = path.join(linkedFhf, "front-end-automation-smoke");
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
  assert.equal(fs.existsSync(path.join(linkedSmoke, ".harness", "lane.json")), true);
  const smokeArchitecture = fs.readFileSync(path.join(linkedSmoke, "ARCHITECTURE.md"), "utf8");
  assert.match(smokeArchitecture, /harness\.config\.json#policyGovernance/);
  assert.match(smokeArchitecture, /credentials only in environment\/secret stores/);
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

  // A clone with core.autocrlf=true checks generated files out as CRLF. That is not a hand-edit,
  // so the divergence guard must ignore it — while still catching a real content change, and
  // still accepting manifests written before hashes were EOL-normalized.
  const eolRoot = path.join(root, "eol-target");
  const eolManifest = path.join(eolRoot, "sync-manifest.json");
  const eolEnv = { FHF_SYNC_TARGET_ROOT: eolRoot, FHF_SYNC_MANIFEST: eolManifest };
  const eolRun = (args = []) => spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...eolEnv },
  });

  assert.equal(eolRun(["--force", "--only-root"]).status, 0);
  const rulesDir = path.join(eolRoot, ".claude", "rules");
  const eolFile = path.join(rulesDir, fs.readdirSync(rulesDir).find((n) => n.endsWith(".md")));
  const projected = fs.readFileSync(eolFile, "utf8");

  // Flip whatever was projected to the opposite line ending, so the guard checks below run
  // the same way on an LF clone and on a core.autocrlf=true clone.
  fs.writeFileSync(
    eolFile,
    projected.includes("\r\n") ? projected.replaceAll("\r\n", "\n") : projected.replaceAll("\n", "\r\n"),
    "utf8",
  );
  const eolOnly = eolRun(["--only-root"]);
  assert.equal(eolOnly.status, 0, `EOL-only checkout must not block: ${eolOnly.stderr}`);

  // A real content change on top of that must still block, and must not be overwritten.
  const handEdited = `${fs.readFileSync(eolFile, "utf8")}hand-edited\n`;
  fs.writeFileSync(eolFile, handEdited, "utf8");
  const contentChanged = eolRun(["--only-root"]);
  assert.notEqual(contentChanged.status, 0, "a real hand-edit must still block");
  assert.match(contentChanged.stderr, /Sync blocked/);
  assert.equal(fs.readFileSync(eolFile, "utf8"), handEdited);

  // Legacy manifest: pre-fix runs stored raw-byte hashes. Upgrading must not mass-block.
  assert.equal(eolRun(["--force", "--only-root"]).status, 0);
  const legacy = JSON.parse(fs.readFileSync(eolManifest, "utf8"));
  const legacyKey = Object.keys(legacy).find((k) => k.endsWith(path.basename(eolFile)));
  const crlf = fs.readFileSync(eolFile, "utf8").replaceAll("\n", "\r\n");
  fs.writeFileSync(eolFile, crlf, "utf8");
  legacy[legacyKey] = createHash("sha256").update(crlf).digest("hex");
  fs.writeFileSync(eolManifest, JSON.stringify(legacy, null, 2), "utf8");
  const legacyRun = eolRun(["--only-root"]);
  assert.equal(legacyRun.status, 0, `legacy raw-byte manifest must be accepted: ${legacyRun.stderr}`);

  // Projection output must not depend on how this harness clone checked the source out.
  assert.equal(eolRun(["--force", "--only-root"]).status, 0);
  assert.equal(
    fs.readFileSync(eolFile, "utf8").includes("\r\n"),
    false,
    "projected content must be written LF-only regardless of the source checkout",
  );

  console.log("sync-loader safety tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
