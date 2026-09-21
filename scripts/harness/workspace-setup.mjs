#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const root = path.resolve(process.env.CLAUDE_PROJECT_DIR ?? process.env.CURSOR_PROJECT_DIR ?? process.cwd());
const target = path.join(root, ".harness", "workspace.local.json");
const laneFile = path.join(root, ".harness", "lane.json");

const KNOWN_LANES = "root, e2e, smoke, or backend";
const LANE_META = {
  e2e: { name: "E2E", rootField: "e2eRoot", rootLabel: "E2E repository root" },
  smoke: { name: "Smoke", rootField: "smokeRoot", rootLabel: "Smoke repository root" },
  backend: { name: "Backend", rootField: "backendRoot", rootLabel: "Backend automation repository root" },
  root: { name: "baseline", rootField: null, rootLabel: null },
};

let lane = "unknown";
try {
  lane = JSON.parse(fs.readFileSync(laneFile, "utf8")).lane;
} catch {
  console.error(`Harness lane configuration is missing or invalid: .harness/lane.json must declare ${KNOWN_LANES}.`);
  process.exit(2);
}

const meta = LANE_META[lane];
if (!meta) {
  console.error(`Harness lane configuration is missing or invalid: .harness/lane.json must declare ${KNOWN_LANES}.`);
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
  const existingBackendRoot = existing.backendRoot ?? existing.optional?.backendRoot ?? "";
  const values = {
    consumerRoot: await ask("FHF workspace root", existing.consumerRoot),
    moduleSpecsRoot: await ask("Application specs repository root", existing.moduleSpecsRoot),
    backendRoot: await ask(
      "Backend automation repository root",
      meta.rootField === "backendRoot" ? (existingBackendRoot || root) : existingBackendRoot,
    ),
    optional: {
      jiraMcp: await askBoolean("Jira MCP/OAuth is configured", existing.optional?.jiraMcp ?? existing.jiraMcp ?? false),
      confluenceMcp: await askBoolean("Confluence MCP/OAuth is configured", existing.optional?.confluenceMcp ?? existing.confluenceMcp ?? false),
      cypressCloud: await askBoolean("Cypress Cloud metadata access is configured", existing.optional?.cypressCloud ?? existing.cypressCloud ?? false),
      figmaMcp: await askBoolean("Figma MCP/OAuth read access is configured", existing.optional?.figmaMcp ?? existing.figmaMcp ?? false),
      testRail: await askBoolean("TestRail read/reporting access is configured", existing.optional?.testRail ?? existing.testRail ?? false),
      teamworkGraphCli: await askBoolean("Teamwork Graph CLI is installed and twg doctor is green (not merely allow-listed)", existing.optional?.teamworkGraphCli ?? existing.teamworkGraphCli ?? false),
    },
  };
  if (meta.rootField && meta.rootField !== "backendRoot") {
    values[meta.rootField] = await ask(meta.rootLabel, existing[meta.rootField] ?? root);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(values, null, 2)}\n`, "utf8");
  console.log(`Wrote ${path.relative(root, target).replaceAll("\\", "/")}`);
  console.log(
    values.optional.jiraMcp
      ? "Jira is declared configured. Ticket intake still requires a live read probe: node .harness/capability-doctor.mjs --capability jira-ticket-read --subject <SERV-ID>."
      : "Jira ticket intake will request OAuth Jira Browse/Read access or a sanitized ticket export: node .harness/capability-doctor.mjs --capability jira-ticket-read --subject <SERV-ID>.",
  );
  console.log(
    values.optional.teamworkGraphCli
      ? "Teamwork Graph CLI is declared. It is still overlay-only: node .harness/capability-doctor.mjs --capability teamwork-graph-cli --subject <SERV-ID>."
      : "Teamwork Graph CLI stays undeclared. Jira MCP remains the ticket oracle; do not treat twg skills as ready.",
  );
  console.log(`Run node .harness/verify.mjs to validate the complete ${meta.name} workspace.`);
} finally {
  rl.close();
}
