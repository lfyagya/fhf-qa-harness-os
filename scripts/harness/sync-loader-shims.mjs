import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { withFileLock } from "./evidence-export-policy.mjs";
import {
  CURSOR_HOOKS,
  docsReadme,
  rootReadme,
  architectureOverlay,
  contributingOverlay,
  copilotInstructions,
  geminiInstructions,
  parentCopilotInstructions,
  parentGeminiInstructions,
} from "./loader-templates.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HARNESS_ROOT = path.resolve(__dirname, "..", "..");
const FHF_ROOT = process.env.FHF_SYNC_TARGET_ROOT
  ? path.resolve(process.env.FHF_SYNC_TARGET_ROOT)
  : path.resolve(HARNESS_ROOT, "..", "FHF");

const SUB_REPOS = {
  e2e: path.join(FHF_ROOT, "AG Frontend Automation", "front-end-automation"),
  smoke: path.join(FHF_ROOT, "ProdSmokeExecution", "front-end-automation"),
};

// FHF root gets the full generated .claude tree — it's the project root Claude Code
// sessions actually launch from, so it needs agent/rule/skill discovery, not just hooks.
const CLAUDE_SUBFOLDERS = ["hooks", "agents", "rules", "skills"];

// Sync-directionality safety: every write funnels through writeText/copyDirSync below, so the
// guard lives here once rather than scattered per-callsite. A target that drifted from canonical
// is expected (that's what sync fixes); a target that drifted from what sync itself last wrote
// means someone hand-edited the generated copy since — overwriting it would silently discard that
// edit (this happened for real: a source-map.md fix landed only on the FHF side and got clobbered
// by a sync run before being ported upstream). Track last-synced hashes; block instead of guessing.
const FORCE = process.argv.includes("--force");
const MANIFEST_PATH = process.env.FHF_SYNC_MANIFEST
  ? path.resolve(process.env.FHF_SYNC_MANIFEST)
  : path.join(HARNESS_ROOT, ".sync-manifest.json");
let manifest = {};
const blocked = [];
let preflight = true;
const pendingWrites = [];
const pendingDeletes = [];
const transaction = `${process.pid}.${Date.now()}`;
const transactionDirs = new Set();

function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}

// Returns true if it's safe to write; records the guard failure and returns false otherwise.
function guardWrite(filePath, newContent) {
  if (FORCE || !fs.existsSync(filePath)) return true;
  const currentHash = hash(fs.readFileSync(filePath, "utf8"));
  const lastSynced = manifest[filePath];
  if (!lastSynced || currentHash !== lastSynced) {
    blocked.push(filePath);
    return false;
  }
  return true;
}

function transactionPath(filePath, suffix) {
  const roots = [HARNESS_ROOT, FHF_ROOT, ...Object.values(SUB_REPOS)];
  const repositoryRoot = roots
    .filter((root) => filePath === root || filePath.startsWith(`${root}${path.sep}`))
    .sort((a, b) => b.length - a.length)[0] ?? HARNESS_ROOT;
  const directory = path.join(repositoryRoot, ".git", "fhf-sync", transaction);
  transactionDirs.add(directory);
  return path.join(directory, `${hash(filePath).slice(0, 24)}.${suffix}`);
}

function stageWrite(filePath, content) {
  const temporary = transactionPath(filePath, "tmp");
  fs.mkdirSync(path.dirname(temporary), { recursive: true });
  fs.writeFileSync(temporary, content, "utf8");
  pendingWrites.push({
    filePath,
    temporary,
    backup: transactionPath(filePath, "bak"),
    published: false,
  });
}

function writeText(filePath, content) {
  const normalized = content.replace(/\r?\n/g, "\n");
  if (!guardWrite(filePath, normalized)) return;
  if (preflight) return;
  stageWrite(filePath, normalized);
  manifest[filePath] = hash(normalized);
}

function copyDirSync(src, dest) {
  const destExistingNames = fs.existsSync(dest)
    ? fs.readdirSync(dest).filter((n) => n !== ".sweep-retries")
    : [];
  const srcEntries = fs.readdirSync(src, { withFileTypes: true }).filter((e) => e.name !== ".sweep-retries");
  for (const entry of srcEntries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else {
      const content = fs.readFileSync(s, "utf8");
      if (!guardWrite(d, content)) continue;
      if (preflight) continue;
      stageWrite(d, content);
      manifest[d] = hash(content);
    }
  }
  // Remove generated entries whose source no longer exists — same divergence guard applies.
  const srcNames = new Set(srcEntries.map((e) => e.name));
  for (const name of destExistingNames) {
    if (srcNames.has(name)) continue;
    const dpath = path.join(dest, name);
    if (!FORCE && fs.existsSync(dpath)) {
      if (fs.statSync(dpath).isDirectory()) {
        blocked.push(`${dpath} (would be deleted — directory ownership is untracked)`);
        continue;
      }
      const currentHash = hash(fs.readFileSync(dpath, "utf8"));
      const lastSynced = manifest[dpath];
      if (!lastSynced || currentHash !== lastSynced) {
        blocked.push(`${dpath} (would be deleted — diverged since last sync)`);
        continue;
      }
    }
    if (preflight) continue;
    pendingDeletes.push({ filePath: dpath, backup: transactionPath(dpath, "bak") });
    delete manifest[dpath];
  }
}

function publishSync() {
  const manifestTemporary = transactionPath(MANIFEST_PATH, "tmp");
  const manifestBackup = transactionPath(MANIFEST_PATH, "bak");
  fs.mkdirSync(path.dirname(manifestTemporary), { recursive: true });
  fs.writeFileSync(manifestTemporary, JSON.stringify(manifest, null, 2), "utf8");
  try {
    for (const entry of pendingWrites) {
      fs.mkdirSync(path.dirname(entry.filePath), { recursive: true });
    }
    for (const entry of [...pendingWrites, ...pendingDeletes]) {
      if (fs.existsSync(entry.filePath)) fs.renameSync(entry.filePath, entry.backup);
    }
    for (const entry of pendingWrites) {
      fs.renameSync(entry.temporary, entry.filePath);
      entry.published = true;
      if (
        process.env.FHF_SYNC_FAIL_AFTER_PUBLISH === "1" &&
        pendingWrites.filter((item) => item.published).length === 1
      ) {
        throw new Error("Injected failure after partial publication.");
      }
    }
    if (fs.existsSync(MANIFEST_PATH)) fs.renameSync(MANIFEST_PATH, manifestBackup);
    fs.renameSync(manifestTemporary, MANIFEST_PATH);
    for (const entry of [...pendingWrites, ...pendingDeletes]) {
      fs.rmSync(entry.backup, { recursive: true, force: true });
    }
    fs.rmSync(manifestBackup, { force: true });
  } catch (error) {
    for (const entry of [...pendingWrites, ...pendingDeletes].reverse()) {
      if (entry.published) fs.rmSync(entry.filePath, { recursive: true, force: true });
      if (fs.existsSync(entry.backup)) fs.renameSync(entry.backup, entry.filePath);
    }
    if (fs.existsSync(manifestBackup)) {
      fs.rmSync(MANIFEST_PATH, { force: true });
      fs.renameSync(manifestBackup, MANIFEST_PATH);
    }
    throw error;
  } finally {
    for (const entry of pendingWrites) fs.rmSync(entry.temporary, { force: true });
    fs.rmSync(manifestTemporary, { force: true });
    fs.rmSync(manifestBackup, { force: true });
    for (const directory of transactionDirs) fs.rmSync(directory, { recursive: true, force: true });
  }
}

function harnessSettings() {
  return fs.readFileSync(path.join(HARNESS_ROOT, ".claude", "settings.json"), "utf8");
}

function syncFhfRoot() {
  for (const sub of CLAUDE_SUBFOLDERS) {
    copyDirSync(path.join(HARNESS_ROOT, ".claude", sub), path.join(FHF_ROOT, ".claude", sub));
  }
  writeText(path.join(FHF_ROOT, ".claude", "settings.json"), harnessSettings());
  writeText(path.join(FHF_ROOT, ".cursor", "hooks.json"), `${JSON.stringify(CURSOR_HOOKS, null, 2)}\n`);
  writeText(path.join(FHF_ROOT, ".github", "copilot-instructions.md"), parentCopilotInstructions());
  writeText(path.join(FHF_ROOT, "GEMINI.md"), parentGeminiInstructions());
}

// Sub-repos (E2E/Smoke lanes) never needed agents/rules/skills/commands — hooks run via
// absolute path regardless of CWD, so only settings.json + doc overlays are generated here.
function syncSubRepo(repoPath, lane) {
  writeText(path.join(repoPath, "docs", "README.md"), docsReadme(lane));
  writeText(path.join(repoPath, "README.md"), rootReadme(lane));
  writeText(path.join(repoPath, "ARCHITECTURE.md"), architectureOverlay(lane));
  writeText(path.join(repoPath, "CONTRIBUTING.md"), contributingOverlay(lane));
  // ponytail: sub-repos get a verbatim copy of harness settings — hook commands use
  // absolute C:/Users/Leapfrog/fhf-harness-os paths, so they run correctly from any repo CWD.
  writeText(path.join(repoPath, ".claude", "settings.json"), harnessSettings());
  writeText(path.join(repoPath, ".cursor", "hooks.json"), `${JSON.stringify(CURSOR_HOOKS, null, 2)}\n`);
  writeText(path.join(repoPath, ".github", "copilot-instructions.md"), copilotInstructions(lane));
  writeText(path.join(repoPath, "GEMINI.md"), geminiInstructions(lane));
}

withFileLock(MANIFEST_PATH, () => {
  manifest = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))
    : {};
  syncFhfRoot();
  syncSubRepo(SUB_REPOS.e2e, "e2e");
  syncSubRepo(SUB_REPOS.smoke, "smoke");

  if (blocked.length) {
    console.error("Sync blocked for files that changed since the last sync (hand-edited, not just stale):");
    for (const f of blocked) console.error(`  - ${f}`);
    console.error("\nPort the fix into the canonical source in this repo, then re-run sync.");
    console.error("Or re-run with --force to discard the target-side changes and overwrite anyway.");
    process.exitCode = 1;
  } else {
    preflight = false;
    syncFhfRoot();
    syncSubRepo(SUB_REPOS.e2e, "e2e");
    syncSubRepo(SUB_REPOS.smoke, "smoke");
    publishSync();
    console.log("Synced loader shims for FHF root, E2E repo, and Smoke repo.");
  }
});
