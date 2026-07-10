import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURSOR_HOOKS,
  docsReadme,
  rootReadme,
  architectureOverlay,
  contributingOverlay,
  copilotInstructions,
} from "./loader-templates.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HARNESS_ROOT = path.resolve(__dirname, "..", "..");
const FHF_ROOT = path.resolve(HARNESS_ROOT, "..", "FHF");

const SUB_REPOS = {
  e2e: path.join(FHF_ROOT, "AG Frontend Automation", "front-end-automation"),
  smoke: path.join(FHF_ROOT, "ProdSmokeExecution", "front-end-automation"),
};

// FHF root gets the full generated .claude tree — it's the project root Claude Code
// sessions actually launch from, so it needs agent/rule/skill discovery, not just hooks.
const CLAUDE_SUBFOLDERS = ["hooks", "agents", "rules", "skills"];

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content.replace(/\r?\n/g, "\n"), "utf8");
}

function copyDirSync(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
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
}

syncFhfRoot();
syncSubRepo(SUB_REPOS.e2e, "e2e");
syncSubRepo(SUB_REPOS.smoke, "smoke");

console.log("Synced loader shims for FHF root, E2E repo, and Smoke repo.");
