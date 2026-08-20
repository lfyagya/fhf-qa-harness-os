#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const root = path.resolve(process.env.CLAUDE_PROJECT_DIR ?? process.env.CURSOR_PROJECT_DIR ?? process.cwd());
const target = path.join(root, ".harness", "workspace.local.json");
const laneFile = path.join(root, ".harness", "lane.json");

const LANE_META = {
  e2e: { name: "E2E", rootField: "e2eRoot", rootLabel: "E2E repository root" },
  smoke: { name: "Smoke", rootField: "smokeRoot", rootLabel: "Smoke repository root" },
  root: { name: "baseline", rootField: null, rootLabel: null },
};

let lane = "unknown";
try {
  lane = JSON.parse(fs.readFileSync(laneFile, "utf8")).lane;
} catch {
  console.error("Harness lane configuration is missing or invalid: .harness/lane.json must declare root, e2e, or smoke.");
  process.exit(2);
}

const meta = LANE_META[lane];
if (!meta) {
  console.error("Harness lane configuration is missing or invalid: .harness/lane.json must declare root, e2e, or smoke.");
  process.exit(2);
}

let existing = {};
if (fs.existsSync(target)) {
  try {
    existing = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    console.error(`Workspace setup is invalid at ${path.relative(root, target).replaceAll("\\", "/")}: ${error.message}`);
    console.error("Repair or remove that local file, then rerun node .harness/setup.mjs. No automatic repair was applied.");
    process.exit(2);
  }
}
const rl = readline.createInterface({ input, output });

async function ask(label, current = "") {
  const answer = await rl.question(`${label}${current ? ` [${current}]` : ""}: `);
  return answer.trim() || current;
}

async function askBoolean(label, current = false) {
  const answer = await ask(`${label} (y/N)`, current ? "y" : "n");
  return /^(y|yes|1|true)$/i.test(answer);
}

try {
  console.log(`FHF ${meta.name} workspace setup`);
  console.log("Paths are local configuration only. Do not enter credentials or tokens.");
  const values = {
    consumerRoot: await ask("FHF workspace root", existing.consumerRoot),
    moduleSpecsRoot: await ask("Application specs repository root", existing.moduleSpecsRoot),
    optional: {
      backendRoot: await ask("Read-only backend repository root (optional)", existing.optional?.backendRoot ?? ""),
      jiraMcp: await askBoolean("Jira MCP/OAuth is configured", existing.optional?.jiraMcp ?? false),
      confluenceMcp: await askBoolean("Confluence MCP/OAuth is configured", existing.optional?.confluenceMcp ?? false),
      cypressCloud: await askBoolean("Cypress Cloud metadata access is configured", existing.optional?.cypressCloud ?? false),
    },
  };
  if (meta.rootField) {
    values[meta.rootField] = await ask(meta.rootLabel, existing[meta.rootField] ?? root);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(values, null, 2)}\n`, "utf8");
  console.log(`Wrote ${path.relative(root, target).replaceAll("\\", "/")}`);
  console.log(`Run node .harness/verify.mjs to validate the complete ${meta.name} workspace.`);
} finally {
  rl.close();
}
