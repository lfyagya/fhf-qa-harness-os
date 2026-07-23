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
  geminiInstructions,
  parentCopilotInstructions,
  parentGeminiInstructions,
} from "./loader-templates.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HARNESS_ROOT = path.resolve(__dirname, "..", "..");
const FHF_ROOT = path.resolve(HARNESS_ROOT, "..", "FHF");

const SUB_REPOS = {
  e2e: path.join(FHF_ROOT, "AG Frontend Automation", "front-end-automation"),
  smoke: path.join(FHF_ROOT, "ProdSmokeExecution", "front-end-automation"),
};

const CLAUDE_SUBFOLDERS = ["hooks", "agents", "rules", "skills"];

const issues = [];

function requireFile(filePath) {
  if (!fs.existsSync(filePath)) {
    issues.push(`Missing required file: ${filePath}`);
  }
}

function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

function checkAllowedEntries(dirPath, allowed) {
  if (!fs.existsSync(dirPath)) {
    issues.push(`Missing required directory: ${dirPath}`);
    return;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true }).map((d) => d.name);
  for (const entry of entries) {
    if (!allowed.includes(entry)) {
      issues.push(`Unexpected entry in ${dirPath}: ${entry}`);
    }
  }
}

function checkExactText(actualPath, expectedText) {
  if (!fs.existsSync(actualPath)) {
    return;
  }
  const actual = normalize(fs.readFileSync(actualPath, "utf8"));
  const expected = normalize(expectedText);
  if (actual !== expected) {
    issues.push(`Drift detected: ${actualPath} content is out of sync`);
  }
}

function dirsMatch(srcDir, destDir, prefix) {
  if (!fs.existsSync(destDir)) {
    issues.push(`Missing generated directory: ${destDir}`);
    return;
  }
  const ignored = new Set([".sweep-retries"]);
  const srcEntries = fs
    .readdirSync(srcDir, { withFileTypes: true })
    .filter((entry) => !ignored.has(entry.name));
  const destNames = new Set(
    fs.readdirSync(destDir).filter((name) => !ignored.has(name)),
  );
  const srcNames = new Set(srcEntries.map((entry) => entry.name));
  for (const name of destNames) {
    if (!srcNames.has(name)) {
      issues.push(`Unexpected generated entry: ${path.join(destDir, name)}`);
    }
  }
  for (const entry of srcEntries) {
    const label = `${prefix}/${entry.name}`;
    if (!destNames.has(entry.name)) {
      issues.push(`Missing generated entry: ${path.join(destDir, entry.name)} (source: ${label})`);
      continue;
    }
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      dirsMatch(s, d, label);
    } else {
      checkExactText(d, fs.readFileSync(s, "utf8"));
    }
  }
}

// FHF root: full generated .claude tree must match this repo's canonical .claude/ exactly.
function checkFhfRoot() {
  const claudeDir = path.join(FHF_ROOT, ".claude");
  const cursorHooksPath = path.join(FHF_ROOT, ".cursor", "hooks.json");
  const copilotPath = path.join(FHF_ROOT, ".github", "copilot-instructions.md");
  const geminiPath = path.join(FHF_ROOT, "GEMINI.md");
  requireFile(path.join(claudeDir, "settings.json"));
  requireFile(cursorHooksPath);
  requireFile(copilotPath);
  requireFile(geminiPath);
  const actualSettings = path.join(claudeDir, "settings.json");
  if (fs.existsSync(actualSettings)) {
    checkExactText(actualSettings, fs.readFileSync(path.join(HARNESS_ROOT, ".claude", "settings.json"), "utf8"));
  }
  for (const sub of CLAUDE_SUBFOLDERS) {
    dirsMatch(path.join(HARNESS_ROOT, ".claude", sub), path.join(claudeDir, sub), `.claude/${sub}`);
  }
  checkExactText(cursorHooksPath, `${JSON.stringify(CURSOR_HOOKS, null, 2)}\n`);
  checkExactText(copilotPath, parentCopilotInstructions());
  checkExactText(geminiPath, parentGeminiInstructions());
}

// Sub-repos (E2E/Smoke lanes): settings.json + doc overlays only — unchanged shape.
function checkSubRepo(repoPath, lane) {
  const docsDir = path.join(repoPath, "docs");
  const claudeDir = path.join(repoPath, ".claude");
  const cursorDir = path.join(repoPath, ".cursor");
  const githubDir = path.join(repoPath, ".github");
  const readmePath = path.join(repoPath, "README.md");
  const architecturePath = path.join(repoPath, "ARCHITECTURE.md");
  const contributingPath = path.join(repoPath, "CONTRIBUTING.md");
  const geminiPath = path.join(repoPath, "GEMINI.md");

  requireFile(path.join(docsDir, "README.md"));
  requireFile(path.join(claudeDir, "settings.json"));
  requireFile(path.join(cursorDir, "hooks.json"));
  requireFile(path.join(githubDir, "copilot-instructions.md"));
  requireFile(readmePath);
  requireFile(architecturePath);
  requireFile(contributingPath);
  requireFile(geminiPath);

  // Sub-repo settings are verbatim copies of harness settings (absolute hook paths)
  const settingsPath = path.join(claudeDir, "settings.json");
  if (fs.existsSync(settingsPath)) {
    const actual = normalize(fs.readFileSync(settingsPath, "utf8"));
    const expected = normalize(fs.readFileSync(path.join(HARNESS_ROOT, ".claude", "settings.json"), "utf8"));
    if (actual !== expected) issues.push(`Drift detected: ${settingsPath} differs from harness settings.json`);
  }

  checkAllowedEntries(docsDir, ["README.md"]);
  checkAllowedEntries(cursorDir, ["hooks.json"]);
  checkAllowedEntries(githubDir, ["copilot-instructions.md", "workflows"]);
  checkExactText(path.join(docsDir, "README.md"), docsReadme(lane));
  checkExactText(readmePath, rootReadme(lane));
  checkExactText(architecturePath, architectureOverlay(lane));
  checkExactText(contributingPath, contributingOverlay(lane));
  checkExactText(path.join(githubDir, "copilot-instructions.md"), copilotInstructions(lane));
  checkExactText(geminiPath, geminiInstructions(lane));
  checkExactText(path.join(cursorDir, "hooks.json"), `${JSON.stringify(CURSOR_HOOKS, null, 2)}\n`);

  const architectureDir = path.join(repoPath, "architecture");
  if (lane === "e2e" && fs.existsSync(architectureDir)) {
    checkAllowedEntries(architectureDir, ["README.md"]);
  }
}

// AGENTS.md is hand-maintained prose (by design — see harness-engineering.md §9), but its agent
// table is a *factual claim* about what's in .claude/agents/. Nothing else checks that claim
// against reality — this is exactly the blind spot that let it list the retired 13-agent roster
// silently until a human caught it by hand (2026-07-20). One-directional pointers from templates
// TO AGENTS.md don't substitute for a check OF it.
function checkAgentsRoster() {
  const agentsDir = path.join(HARNESS_ROOT, ".claude", "agents");
  const agentsMdPath = path.join(FHF_ROOT, "AGENTS.md");
  if (!fs.existsSync(agentsDir) || !fs.existsSync(agentsMdPath)) return;

  const realAgents = fs
    .readdirSync(agentsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));

  // Scope to table rows only (lines starting with "|") — prose explicitly documenting a
  // retired name (e.g. "cypress-bug-hunter no longer exists") is correct content, not a claim
  // that it's active, and must not be flagged as one.
  const text = fs.readFileSync(agentsMdPath, "utf8");
  const tableRows = text.split("\n").filter((line) => line.trim().startsWith("|"));
  const mentioned = new Set(
    tableRows.flatMap((line) => [...line.matchAll(/`(cypress-[a-z-]+)`/g)].map((m) => m[1]))
  );

  for (const name of mentioned) {
    if (!realAgents.includes(name)) {
      issues.push(`AGENTS.md references '${name}' — no matching file in .claude/agents/ (retired or never existed)`);
    }
  }
  for (const name of realAgents) {
    if (!mentioned.has(name)) {
      issues.push(`AGENTS.md never mentions '${name}' — a real agent (.claude/agents/${name}.md) but missing from the roster table`);
    }
  }
}

function checkHandMaintainedPointers() {
  const files = [
    path.join(SUB_REPOS.e2e, "AGENTS.md"),
    path.join(SUB_REPOS.smoke, "AGENTS.md"),
    path.join(SUB_REPOS.e2e, "architecture", "README.md"),
  ];
  const stale = /FHF[\\/]docs[\\/]architecture[\\/](?:CENTRALIZED-HARNESS|HARNESS)\.md/i;
  for (const file of files) {
    requireFile(file);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    if (stale.test(text)) {
      issues.push(`Stale harness pointer in ${file}: references removed FHF/docs/architecture content`);
    }
  }
}

checkFhfRoot();
checkSubRepo(SUB_REPOS.e2e, "e2e");
checkSubRepo(SUB_REPOS.smoke, "smoke");
checkAgentsRoster();
checkHandMaintainedPointers();

if (issues.length) {
  console.error("Harness drift detected:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Harness loader shims are clean and centralized.");
