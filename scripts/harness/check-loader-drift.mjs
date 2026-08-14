import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
} from "./loader-templates.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HARNESS_ROOT = path.resolve(__dirname, "..", "..");
const FHF_ROOT = process.env.FHF_SYNC_TARGET_ROOT
  ? path.resolve(process.env.FHF_SYNC_TARGET_ROOT)
  : path.resolve(HARNESS_ROOT, "..", "FHF");
const BASELINE_ROOT = process.env.FHF_BASELINE_TARGET
  ? path.resolve(process.env.FHF_BASELINE_TARGET)
  : null;
const SKIP_E2E = process.argv.includes("--skip-e2e");
const ONLY_E2E = process.argv.includes("--only-e2e");
const ONLY_SMOKE = process.argv.includes("--only-smoke");
const ONLY_ROOT = process.argv.includes("--only-root");
const ONLY_BASELINE = process.argv.includes("--only-baseline");

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

function checkConsumerVerifier(repoPath) {
  requireFile(path.join(repoPath, ".harness", "verify.mjs"));
  requireFile(path.join(repoPath, ".harness", "README.md"));
  requireFile(path.join(repoPath, ".harness", "portable-runtime-state.mjs"));
  requireFile(path.join(repoPath, ".harness", "record-loop-event.mjs"));
  checkExactText(path.join(repoPath, ".harness", "verify.mjs"), CONSUMER_VERIFIER_TEXT);
  checkExactText(path.join(repoPath, ".harness", "README.md"), consumerVerifierReadme());
  checkExactText(path.join(repoPath, ".harness", "portable-runtime-state.mjs"), PORTABLE_RUNTIME_STATE_TEXT);
  checkExactText(path.join(repoPath, ".harness", "record-loop-event.mjs"), RECORD_LOOP_EVENT_TEXT);
}

function checkHarnessRoot() {
  checkExactText(
    path.join(HARNESS_ROOT, ".claude", "settings.json"),
    claudeSettingsText(),
  );
}

// FHF root: full generated .claude tree must match this repo's canonical .claude/ exactly.
function checkFhfRoot() {
  const claudeDir = path.join(FHF_ROOT, ".claude");
  const cursorHooksPath = path.join(FHF_ROOT, ".cursor", "hooks.json");
  const copilotPath = path.join(FHF_ROOT, ".github", "copilot-instructions.md");
  const geminiPath = path.join(FHF_ROOT, "GEMINI.md");
  requireFile(path.join(claudeDir, "settings.json"));
  requireFile(path.join(claudeDir, "harness.config.json"));
  requireFile(cursorHooksPath);
  requireFile(copilotPath);
  requireFile(geminiPath);
  const actualSettings = path.join(claudeDir, "settings.json");
  if (fs.existsSync(actualSettings)) {
    checkExactText(actualSettings, claudeSettingsText());
  }
  checkExactText(path.join(claudeDir, "harness.config.json"), HARNESS_CONFIG_TEXT);
  for (const sub of CLAUDE_SUBFOLDERS) {
    dirsMatch(path.join(HARNESS_ROOT, ".claude", sub), path.join(claudeDir, sub), `.claude/${sub}`);
  }
  checkExactText(cursorHooksPath, `${JSON.stringify(CURSOR_HOOKS, null, 2)}\n`);
  checkExactText(copilotPath, parentCopilotInstructions());
  checkExactText(geminiPath, parentGeminiInstructions());
  checkConsumerVerifier(FHF_ROOT);
}

// Lane repos (E2E/Smoke): vendored .claude tree + portable shims + doc overlays.
// Only named generated files are owned. Sibling .cursor/* and .github/* files are
// consumer content and must not be treated as drift. architecture/ is never generated.
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
  requireFile(path.join(claudeDir, "harness.config.json"));
  requireFile(path.join(cursorDir, "hooks.json"));
  requireFile(path.join(githubDir, "copilot-instructions.md"));
  requireFile(geminiPath);
  requireFile(readmePath);
  requireFile(architecturePath);
  requireFile(contributingPath);

  const settingsPath = path.join(claudeDir, "settings.json");
  checkExactText(settingsPath, portableSettings(lane));
  checkExactText(path.join(claudeDir, "harness.config.json"), HARNESS_CONFIG_TEXT);
  if (fs.existsSync(settingsPath)) {
    const actual = fs.readFileSync(settingsPath, "utf8");
    if (/[A-Za-z]:[/\\]Users[/\\]/.test(actual)) {
      issues.push(`Non-portable path in ${settingsPath}: lane repos must not embed a machine-specific path`);
    }
  }

  for (const sub of CLAUDE_SUBFOLDERS) {
    dirsMatch(path.join(HARNESS_ROOT, ".claude", sub), path.join(claudeDir, sub), `.claude/${sub}`);
  }

  checkExactText(path.join(docsDir, "README.md"), docsReadme(lane));
  checkExactText(readmePath, rootReadme(lane));
  checkExactText(architecturePath, architectureOverlay(lane));
  checkExactText(contributingPath, contributingOverlay(lane));
  checkExactText(path.join(githubDir, "copilot-instructions.md"), copilotInstructions(lane));
  checkExactText(geminiPath, geminiInstructions(lane));
  checkExactText(path.join(cursorDir, "hooks.json"), `${JSON.stringify(cursorHooks(VENDORED_HOOKS, lane), null, 2)}\n`);
  checkConsumerVerifier(repoPath);
}

function checkAgentsRoster() {
  const agentsDir = path.join(HARNESS_ROOT, ".claude", "agents");
  const agentsMdPath = path.join(FHF_ROOT, "AGENTS.md");
  if (!fs.existsSync(agentsDir) || !fs.existsSync(agentsMdPath)) return;

  const realAgents = fs
    .readdirSync(agentsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));

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
  if (ONLY_ROOT) return;
  const required = [
    path.join(SUB_REPOS.e2e, "AGENTS.md"),
    path.join(SUB_REPOS.smoke, "AGENTS.md"),
  ];
  const optional = [
    path.join(SUB_REPOS.e2e, "architecture", "README.md"),
  ];
  const stale = /FHF[\\/]docs[\\/]architecture[\\/](?:CENTRALIZED-HARNESS|HARNESS)\.md/i;
  for (const file of required) {
    if (ONLY_E2E && !file.startsWith(SUB_REPOS.e2e)) continue;
    if (ONLY_SMOKE && !file.startsWith(SUB_REPOS.smoke)) continue;
    if (SKIP_E2E && file.startsWith(SUB_REPOS.e2e)) continue;
    requireFile(file);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    if (stale.test(text)) {
      issues.push(`Stale harness pointer in ${file}: references removed FHF/docs/architecture content`);
    }
  }
  for (const file of optional) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    if (stale.test(text)) {
      issues.push(`Stale harness pointer in ${file}: references removed FHF/docs/architecture content`);
    }
  }
}

function checkBaseline() {
  if (!BASELINE_ROOT) throw new Error("--only-baseline requires FHF_BASELINE_TARGET.");
  const claudeDir = path.join(BASELINE_ROOT, ".claude");
  requireFile(path.join(claudeDir, "settings.json"));
  requireFile(path.join(claudeDir, "harness.config.json"));
  requireFile(path.join(BASELINE_ROOT, ".cursor", "hooks.json"));
  requireFile(path.join(BASELINE_ROOT, ".github", "copilot-instructions.md"));
  requireFile(path.join(BASELINE_ROOT, "GEMINI.md"));
  requireFile(path.join(BASELINE_ROOT, "CLAUDE.md"));
  requireFile(path.join(BASELINE_ROOT, "AGENTS.md"));
  requireFile(path.join(BASELINE_ROOT, "README.md"));
  requireFile(path.join(BASELINE_ROOT, "ARCHITECTURE.md"));
  requireFile(path.join(BASELINE_ROOT, "CONTRIBUTING.md"));
  requireFile(path.join(BASELINE_ROOT, "docs", "README.md"));
  checkExactText(path.join(claudeDir, "settings.json"), portableSettings("root"));
  checkExactText(path.join(claudeDir, "harness.config.json"), HARNESS_CONFIG_TEXT);
  for (const sub of CLAUDE_SUBFOLDERS) {
    dirsMatch(path.join(HARNESS_ROOT, ".claude", sub), path.join(claudeDir, sub), `.claude/${sub}`);
  }
  checkExactText(path.join(BASELINE_ROOT, ".cursor", "hooks.json"), `${JSON.stringify(CURSOR_HOOKS, null, 2)}\n`);
  checkExactText(path.join(BASELINE_ROOT, ".github", "copilot-instructions.md"), baselineCopilotInstructions());
  checkExactText(path.join(BASELINE_ROOT, "GEMINI.md"), baselineGeminiInstructions());
  checkExactText(path.join(BASELINE_ROOT, "CLAUDE.md"), baselineClaude());
  checkExactText(path.join(BASELINE_ROOT, "AGENTS.md"), baselineAgents());
  checkExactText(path.join(BASELINE_ROOT, "README.md"), baselineReadme());
  checkExactText(path.join(BASELINE_ROOT, "ARCHITECTURE.md"), baselineArchitecture());
  checkExactText(path.join(BASELINE_ROOT, "CONTRIBUTING.md"), baselineContributing());
  checkExactText(path.join(BASELINE_ROOT, "docs", "README.md"), baselineDocsReadme());
  checkConsumerVerifier(BASELINE_ROOT);
}

if (
  (SKIP_E2E && (ONLY_E2E || ONLY_SMOKE || ONLY_ROOT || ONLY_BASELINE)) ||
  [ONLY_E2E, ONLY_SMOKE, ONLY_ROOT, ONLY_BASELINE].filter(Boolean).length > 1
) {
  throw new Error("Use only one scoped drift-check mode.");
}
if (ONLY_ROOT) {
  checkFhfRoot();
  checkAgentsRoster();
} else if (ONLY_E2E) {
  checkSubRepo(SUB_REPOS.e2e, "e2e");
} else if (ONLY_SMOKE) {
  checkSubRepo(SUB_REPOS.smoke, "smoke");
} else if (ONLY_BASELINE) {
  checkBaseline();
} else {
  checkHarnessRoot();
  checkFhfRoot();
  if (!SKIP_E2E) checkSubRepo(SUB_REPOS.e2e, "e2e");
  checkSubRepo(SUB_REPOS.smoke, "smoke");
  checkAgentsRoster();
}
checkHandMaintainedPointers();

if (issues.length) {
  console.error("Harness drift detected:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log(
  ONLY_E2E
    ? "E2E harness loader shims are clean and centralized."
    : ONLY_SMOKE
    ? "Smoke harness loader shims are clean and centralized."
    : ONLY_BASELINE
    ? "Master baseline harness shims are clean and centralized."
    : ONLY_ROOT
    ? "FHF-root harness loader shims are clean and centralized."
    : SKIP_E2E
      ? "Harness loader shims are clean and centralized (E2E skipped)."
      : "Harness loader shims are clean and centralized.",
);
