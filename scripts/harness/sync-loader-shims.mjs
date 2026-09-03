import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConsumerRoot, resolveLaneRoot } from "./workspace-paths.mjs";
import { createHash } from "node:crypto";
import { withFileLock } from "./evidence-export-policy.mjs";
import {
  CURSOR_HOOKS,
  HARNESS_CONFIG_TEXT,
  claudeSettingsText,
  cursorHooks,
  VENDORED_HOOKS,
  portableSettings,
  docsReadme,
  rootReadme,
  architectureOverlay,
  contributingOverlay,
  copilotInstructions,
  geminiInstructions,
  parentCopilotInstructions,
  parentGeminiInstructions,
  baselineClaude,
  baselineAgents,
  baselineReadme,
  baselineArchitecture,
  baselineContributing,
  baselineDocsReadme,
  baselineCopilotInstructions,
  baselineGeminiInstructions,
  consumerVerifierReadme,
  CONSUMER_VERIFIER_TEXT,
  PORTABLE_RUNTIME_STATE_TEXT,
  RECORD_LOOP_EVENT_TEXT,
  TASK_PROTOCOL_LIB_TEXT,
  TASK_PROTOCOL_CLI_TEXT,
  BACKEND_TASK_RUNNER_TEXT,
  EXECUTION_SETUP_TEXT,
  JIRA_ACCESS_DOCTOR_TEXT,
  CAPABILITY_DOCTOR_TEXT,
  WORKSPACE_SETUP_TEXT,
  executionProfileExample,
  lanePackage,
  npmrcExample,
  laneMarker,
  workspaceExample,
} from "./loader-templates.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HARNESS_ROOT = path.resolve(__dirname, "..", "..");
const FHF_ROOT = resolveConsumerRoot(HARNESS_ROOT, { explicit: process.env.FHF_SYNC_TARGET_ROOT });
const BASELINE_ROOT = process.env.FHF_BASELINE_TARGET
  ? path.resolve(process.env.FHF_BASELINE_TARGET)
  : null;

const SUB_REPOS = {
  e2e: resolveLaneRoot(HARNESS_ROOT, FHF_ROOT, "e2e", { explicit: process.env.FHF_E2E_TARGET_ROOT }),
  smoke: resolveLaneRoot(HARNESS_ROOT, FHF_ROOT, "smoke", { explicit: process.env.FHF_SMOKE_TARGET_ROOT }),
  backend: resolveLaneRoot(HARNESS_ROOT, FHF_ROOT, "backend", { explicit: process.env.FHF_BACKEND_TARGET_ROOT }),
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
const SKIP_E2E = process.argv.includes("--skip-e2e");
const ONLY_E2E = process.argv.includes("--only-e2e");
const ONLY_SMOKE = process.argv.includes("--only-smoke");
const ONLY_ROOT = process.argv.includes("--only-root");
const ONLY_BASELINE = process.argv.includes("--only-baseline");
const ONLY_BACKEND = process.argv.includes("--only-backend");
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
const FIRST_SYNC_GENERATED = new Set([
  path.join(HARNESS_ROOT, ".claude", "settings.json"),
]);

function resolveAgainstRoots(filePath) {
  const absolute = path.resolve(filePath);
  const roots = [
    [HARNESS_ROOT, "harness"],
    [FHF_ROOT, "consumer"],
    ...(BASELINE_ROOT ? [[BASELINE_ROOT, "baseline"]] : []),
    [SUB_REPOS.e2e, "consumer/e2e"],
    [SUB_REPOS.smoke, "consumer/smoke"],
    [SUB_REPOS.backend, "consumer/backend"],
  ].sort((a, b) => b[0].length - a[0].length);
  for (const [root, prefix] of roots) {
    if (absolute === root || absolute.startsWith(`${root}${path.sep}`)) {
      return { prefix, rel: path.relative(root, absolute).replaceAll(path.sep, "/") };
    }
  }
  return { prefix: "external", rel: absolute.replaceAll("\\", "/") };
}

function manifestKey(filePath) {
  const { prefix, rel } = resolveAgainstRoots(filePath);
  return `${prefix}/${rel}`;
}

// Lane-local files: a target owns them, canonical does not, and sync must never delete them.
// copyDirSync mirrors canonical and removes anything else, so before this list a lane-local file
// was structurally doomed - flagged on every run and destroyed by the first bare --force. That
// nearly took the e2e selector-liveness gate (249 lines, closed Cloud run 754). The check sits
// ahead of the FORCE branch on purpose: --force is the failure mode, so it must not override it.
const LANE_LOCAL_PATHS = (() => {
  try {
    return JSON.parse(HARNESS_CONFIG_TEXT).engineering?.harness?.laneLocalPaths ?? [];
  } catch {
    return [];
  }
})();

function isLaneLocal(filePath) {
  const { rel } = resolveAgainstRoots(filePath);
  return LANE_LOCAL_PATHS.some((kept) => {
    const base = String(kept).replace(/\/+$/, "");
    return base.length > 0 && (rel === base || rel.startsWith(`${base}/`));
  });
}

function normalizeManifest(raw) {
  const normalized = {};
  const managedRoots = [HARNESS_ROOT, FHF_ROOT, BASELINE_ROOT, ...Object.values(SUB_REPOS)].filter(Boolean);
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!path.isAbsolute(key)) {
      normalized[key] = value;
      continue;
    }
    const keyPath = path.resolve(key);
    const knownRoot = managedRoots.some(
      (root) => keyPath === root || keyPath.startsWith(`${root}${path.sep}`),
    );
    if (knownRoot) normalized[manifestKey(keyPath)] = value;
  }
  return normalized;
}

function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}

// Generated content is authored LF-only, but a clone with core.autocrlf=true checks the same
// bytes out as CRLF. Hashing raw bytes therefore reported an EOL-only checkout as a hand-edit
// and blocked the sync. Track content, not line endings — the same normalization
// check-loader-drift.mjs already applies on both sides of its comparison.
function normalizeEol(content) {
  return content.replace(/\r\n/g, "\n");
}

function contentHash(content) {
  return hash(normalizeEol(content));
}

// Manifests written before contentHash() stored raw-byte hashes. Accept those too so upgrading
// doesn't block every file at once and push the operator toward --force, which is precisely the
// blind overwrite this guard exists to prevent. Entries migrate as each file is next synced.
function matchesLastSynced(content, lastSynced) {
  return contentHash(content) === lastSynced || hash(content) === lastSynced;
}

// Returns true if it's safe to write; records the guard failure and returns false otherwise.
function guardWrite(filePath, newContent) {
  if (FORCE || !fs.existsSync(filePath)) return true;
  const current = fs.readFileSync(filePath, "utf8");
  const lastSynced = manifest[manifestKey(filePath)];
  if (!lastSynced && FIRST_SYNC_GENERATED.has(filePath)) return true;
  if (!lastSynced || !matchesLastSynced(current, lastSynced)) {
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
  const gitMarker = path.join(repositoryRoot, ".git");
  let gitDirectory = gitMarker;
  if (fs.existsSync(gitMarker) && fs.statSync(gitMarker).isFile()) {
    const match = /^gitdir:\s*(.+)\s*$/im.exec(fs.readFileSync(gitMarker, "utf8"));
    if (!match) throw new Error(`Invalid Git worktree pointer: ${gitMarker}`);
    gitDirectory = path.resolve(repositoryRoot, match[1]);
  }
  const directory = path.join(gitDirectory, "fhf-sync", transaction);
  transactionDirs.add(directory);
  return path.join(directory, `${hash(filePath).slice(0, 24)}.${suffix}`);
}

function stageWrite(filePath, content) {
  const temporary = transactionPath(filePath, "tmp");
  fs.mkdirSync(path.dirname(temporary), { recursive: true });
  fs.writeFileSync(temporary, content, "utf8");
  // The temp name is derived from filePath, so staging one destination twice (harness root and
  // FHF root coincide in a local aggregation workspace) would queue two publishes of one temp
  // file and the second rename would ENOENT. Last write wins; keep a single pending entry.
  const already = pendingWrites.find((entry) => entry.filePath === filePath);
  if (already) return;
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
  manifest[manifestKey(filePath)] = contentHash(normalized);
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
      // Normalize on write like writeText does, so projected bytes don't depend on whether
      // this harness clone checked the source out as LF or CRLF.
      const content = normalizeEol(fs.readFileSync(s, "utf8"));
      if (!guardWrite(d, content)) continue;
      if (preflight) continue;
      stageWrite(d, content);
      manifest[manifestKey(d)] = contentHash(content);
    }
  }
  // Remove generated entries whose source no longer exists — same divergence guard applies.
  const srcNames = new Set(srcEntries.map((e) => e.name));
  for (const name of destExistingNames) {
    if (srcNames.has(name)) continue;
    const dpath = path.join(dest, name);
    if (isLaneLocal(dpath)) continue;
    if (!FORCE && fs.existsSync(dpath)) {
      if (fs.statSync(dpath).isDirectory()) {
        blocked.push(`${dpath} (would be deleted — directory ownership is untracked)`);
        continue;
      }
      const current = fs.readFileSync(dpath, "utf8");
      const lastSynced = manifest[manifestKey(dpath)];
      if (!lastSynced || !matchesLastSynced(current, lastSynced)) {
        blocked.push(`${dpath} (would be deleted — diverged since last sync)`);
        continue;
      }
    }
    if (preflight) continue;
    pendingDeletes.push({ filePath: dpath, backup: transactionPath(dpath, "bak") });
    delete manifest[manifestKey(dpath)];
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
  return claudeSettingsText();
}

function syncHarnessRoot() {
  writeText(path.join(HARNESS_ROOT, ".claude", "settings.json"), harnessSettings());
}

function syncRuntimeEvidence(repoPath, lane) {
  writeText(path.join(repoPath, ".harness", "portable-runtime-state.mjs"), PORTABLE_RUNTIME_STATE_TEXT);
  writeText(path.join(repoPath, ".harness", "record-loop-event.mjs"), RECORD_LOOP_EVENT_TEXT);
  writeText(path.join(repoPath, ".harness", "task-protocol-lib.mjs"), TASK_PROTOCOL_LIB_TEXT);
  writeText(path.join(repoPath, ".harness", "task-protocol.mjs"), TASK_PROTOCOL_CLI_TEXT);
  if (lane === "root") {
    writeText(path.join(repoPath, ".harness", "backend-task-runner.mjs"), BACKEND_TASK_RUNNER_TEXT);
  }
  writeText(path.join(repoPath, ".harness", "setup.mjs"), WORKSPACE_SETUP_TEXT);
  writeText(path.join(repoPath, ".harness", "jira-access-doctor.mjs"), JIRA_ACCESS_DOCTOR_TEXT);
  writeText(path.join(repoPath, ".harness", "capability-doctor.mjs"), CAPABILITY_DOCTOR_TEXT);
  writeText(path.join(repoPath, ".harness", "lane.json"), laneMarker(lane));
  writeText(path.join(repoPath, ".harness", "workspace.example.json"), workspaceExample(lane));
  if (lane === "e2e" || lane === "smoke") {
    writeText(path.join(repoPath, ".harness", "prepare-execution.mjs"), EXECUTION_SETUP_TEXT);
    writeText(path.join(repoPath, ".harness", "execution.example.json"), executionProfileExample(lane));
    const pkg = lanePackage(lane);
    if (pkg) writeText(path.join(repoPath, pkg, ".npmrc.example"), npmrcExample(lane));
  }
}

function syncFhfRoot() {
  for (const sub of CLAUDE_SUBFOLDERS) {
    copyDirSync(path.join(HARNESS_ROOT, ".claude", sub), path.join(FHF_ROOT, ".claude", sub));
  }
  writeText(path.join(FHF_ROOT, ".claude", "settings.json"), harnessSettings());
  writeText(path.join(FHF_ROOT, ".claude", "harness.config.json"), HARNESS_CONFIG_TEXT);
  writeText(path.join(FHF_ROOT, ".cursor", "hooks.json"), `${JSON.stringify(CURSOR_HOOKS, null, 2)}\n`);
  writeText(path.join(FHF_ROOT, ".github", "copilot-instructions.md"), parentCopilotInstructions());
  writeText(path.join(FHF_ROOT, "GEMINI.md"), parentGeminiInstructions());
  writeText(path.join(FHF_ROOT, ".harness", "verify.mjs"), CONSUMER_VERIFIER_TEXT);
  writeText(path.join(FHF_ROOT, ".harness", "README.md"), consumerVerifierReadme("root"));
  syncRuntimeEvidence(FHF_ROOT, "root");
}

function syncBaseline() {
  if (!BASELINE_ROOT) throw new Error("--only-baseline requires FHF_BASELINE_TARGET.");
  for (const sub of CLAUDE_SUBFOLDERS) {
    copyDirSync(path.join(HARNESS_ROOT, ".claude", sub), path.join(BASELINE_ROOT, ".claude", sub));
  }
  writeText(path.join(BASELINE_ROOT, ".claude", "settings.json"), portableSettings("root"));
  writeText(path.join(BASELINE_ROOT, ".claude", "harness.config.json"), HARNESS_CONFIG_TEXT);
  writeText(path.join(BASELINE_ROOT, ".cursor", "hooks.json"), `${JSON.stringify(CURSOR_HOOKS, null, 2)}\n`);
  writeText(path.join(BASELINE_ROOT, ".github", "copilot-instructions.md"), baselineCopilotInstructions());
  writeText(path.join(BASELINE_ROOT, "GEMINI.md"), baselineGeminiInstructions());
  writeText(path.join(BASELINE_ROOT, "CLAUDE.md"), baselineClaude());
  writeText(path.join(BASELINE_ROOT, "AGENTS.md"), baselineAgents());
  writeText(path.join(BASELINE_ROOT, "README.md"), baselineReadme());
  writeText(path.join(BASELINE_ROOT, "ARCHITECTURE.md"), baselineArchitecture());
  writeText(path.join(BASELINE_ROOT, "CONTRIBUTING.md"), baselineContributing());
  writeText(path.join(BASELINE_ROOT, "docs", "README.md"), baselineDocsReadme());
  writeText(path.join(BASELINE_ROOT, ".harness", "verify.mjs"), CONSUMER_VERIFIER_TEXT);
  writeText(path.join(BASELINE_ROOT, ".harness", "README.md"), consumerVerifierReadme("root"));
  syncRuntimeEvidence(BASELINE_ROOT, "root");
}

// Managed Cypress lanes vendor and commit the full generated tree. Engineers clone these repos
// without fhf-harness-os, so an absolute path off this machine would leave every hook broken.
// Vendored content stays generated: this repo is the only author, and check-loader-drift.mjs
// fails if a lane copy is edited directly.
function syncSubRepo(repoPath, lane) {
  writeText(path.join(repoPath, "docs", "README.md"), docsReadme(lane));
  writeText(path.join(repoPath, "README.md"), rootReadme(lane));
  writeText(path.join(repoPath, "ARCHITECTURE.md"), architectureOverlay(lane));
  writeText(path.join(repoPath, "CONTRIBUTING.md"), contributingOverlay(lane));
  for (const sub of CLAUDE_SUBFOLDERS) {
    copyDirSync(path.join(HARNESS_ROOT, ".claude", sub), path.join(repoPath, ".claude", sub));
  }
  writeText(path.join(repoPath, ".claude", "settings.json"), portableSettings(lane));
  writeText(path.join(repoPath, ".claude", "harness.config.json"), HARNESS_CONFIG_TEXT);
  writeText(
    path.join(repoPath, ".cursor", "hooks.json"),
    `${JSON.stringify(cursorHooks(VENDORED_HOOKS, lane), null, 2)}\n`,
  );
  writeText(path.join(repoPath, ".github", "copilot-instructions.md"), copilotInstructions(lane));
  writeText(path.join(repoPath, "GEMINI.md"), geminiInstructions(lane));
  writeText(path.join(repoPath, ".harness", "verify.mjs"), CONSUMER_VERIFIER_TEXT);
  writeText(path.join(repoPath, ".harness", "README.md"), consumerVerifierReadme(lane));
  syncRuntimeEvidence(repoPath, lane);
}

// Backend is a full harness sync consumer — same as E2E/smoke lanes. Backend-specific agents,
// rules, and skills live in the harness and are generated here; nothing is backend-authoritative.
function syncBackend() {
  for (const sub of CLAUDE_SUBFOLDERS) {
    copyDirSync(path.join(HARNESS_ROOT, ".claude", sub), path.join(SUB_REPOS.backend, ".claude", sub));
  }
  writeText(path.join(SUB_REPOS.backend, ".claude", "harness.config.json"), HARNESS_CONFIG_TEXT);
  writeText(path.join(SUB_REPOS.backend, ".claude", "settings.json"), portableSettings("backend"));
}

function removeEmptyLegacyCodexDirectory(repoPath) {
  const directory = path.join(repoPath, ".codex");
  if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) {
    fs.rmdirSync(directory);
  }
}

withFileLock(MANIFEST_PATH, () => {
  if (
    (SKIP_E2E && (ONLY_E2E || ONLY_SMOKE || ONLY_ROOT || ONLY_BASELINE || ONLY_BACKEND)) ||
    [ONLY_E2E, ONLY_SMOKE, ONLY_ROOT, ONLY_BASELINE, ONLY_BACKEND].filter(Boolean).length > 1
  ) {
    throw new Error("Use only one scoped sync mode.");
  }
  manifest = fs.existsSync(MANIFEST_PATH)
    ? normalizeManifest(JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")))
    : {};
  if (ONLY_E2E) {
    syncSubRepo(SUB_REPOS.e2e, "e2e");
  } else if (ONLY_SMOKE) {
    syncSubRepo(SUB_REPOS.smoke, "smoke");
  } else if (ONLY_BACKEND) {
    syncBackend();
  } else if (ONLY_BASELINE) {
    syncBaseline();
  } else if (ONLY_ROOT) {
    syncFhfRoot();
  } else {
    syncHarnessRoot();
    syncFhfRoot();
    if (!SKIP_E2E) syncSubRepo(SUB_REPOS.e2e, "e2e");
    syncSubRepo(SUB_REPOS.smoke, "smoke");
    syncBackend();
  }

  if (blocked.length) {
    console.error("Sync blocked for files that changed since the last sync (hand-edited, not just stale):");
    for (const f of blocked) console.error(`  - ${f}`);
    console.error("\nPort the fix into the canonical source in this repo, then re-run sync.");
    console.error("Or re-run with --force to discard the target-side changes and overwrite anyway.");
    process.exitCode = 1;
  } else {
    preflight = false;
    if (ONLY_E2E) {
      syncSubRepo(SUB_REPOS.e2e, "e2e");
      removeEmptyLegacyCodexDirectory(SUB_REPOS.e2e);
    } else if (ONLY_SMOKE) {
      syncSubRepo(SUB_REPOS.smoke, "smoke");
      removeEmptyLegacyCodexDirectory(SUB_REPOS.smoke);
    } else if (ONLY_BACKEND) {
      syncBackend();
    } else if (ONLY_BASELINE) {
      syncBaseline();
    } else if (ONLY_ROOT) {
      syncFhfRoot();
    } else {
      syncHarnessRoot();
      syncFhfRoot();
      if (!SKIP_E2E) syncSubRepo(SUB_REPOS.e2e, "e2e");
      syncSubRepo(SUB_REPOS.smoke, "smoke");
      syncBackend();
      removeEmptyLegacyCodexDirectory(FHF_ROOT);
      if (!SKIP_E2E) removeEmptyLegacyCodexDirectory(SUB_REPOS.e2e);
      removeEmptyLegacyCodexDirectory(SUB_REPOS.smoke);
    }
    for (const file of Object.keys(manifest)) {
      if (/[\\/]\.codex[\\/]hooks\.json$/i.test(file)) delete manifest[file];
    }
    publishSync();
    console.log(
      ONLY_E2E
        ? "Synced loader shims for E2E repo only."
        : ONLY_SMOKE
        ? "Synced loader shims for Smoke repo only."
        : ONLY_BACKEND
        ? "Synced loader shims for backend repo only."
        : ONLY_BASELINE
        ? "Synced loader shims for master baseline only."
        : ONLY_ROOT
        ? "Synced loader shims for FHF root only."
        : `Synced loader shims for FHF root and ${SKIP_E2E ? "Smoke" : "E2E and Smoke"} repos.`,
    );
  }
});
