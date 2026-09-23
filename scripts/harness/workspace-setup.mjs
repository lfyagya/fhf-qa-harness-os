#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const root = path.resolve(process.env.CLAUDE_PROJECT_DIR ?? process.env.CURSOR_PROJECT_DIR ?? process.cwd());
const target = path.join(root, ".harness", "workspace.local.json");
const laneFile = path.join(root, ".harness", "lane.json");
const FORM = process.argv.includes("--form");

const KNOWN_LANES = "root, e2e, smoke, or backend";
const LANE_META = {
  e2e: { name: "E2E", rootField: "e2eRoot", rootLabel: "E2E repository root" },
  smoke: { name: "Smoke", rootField: "smokeRoot", rootLabel: "Smoke repository root" },
  backend: { name: "Backend", rootField: "backendRoot", rootLabel: "Backend automation repository root" },
  root: { name: "baseline", rootField: null, rootLabel: null },
};
const LANE_FOLDERS = {
  e2e: "front-end-automation-e2e",
  smoke: "front-end-automation-smoke",
  backend: "fhf-backend-automation",
};
const SPECS_FOLDER = "Test-Case-Automation-Using-Claude-Agents";

function isDir(value) {
  return typeof value === "string" && value !== "" && fs.existsSync(value) && fs.statSync(value).isDirectory();
}

function readLane(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, ".harness", "lane.json"), "utf8")).lane;
  } catch {
    return null;
  }
}

function laneFromFolder(dir) {
  const base = path.basename(dir);
  if (base === LANE_FOLDERS.e2e) return "e2e";
  if (base === LANE_FOLDERS.smoke) return "smoke";
  if (base === LANE_FOLDERS.backend) return "backend";
  return "root";
}

let lane = readLane(root) ?? laneFromFolder(root);
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

function inferConsumerRoot(start) {
  const fromEnv = process.env.FHF_CONSUMER_ROOT ?? process.env.FHF_SYNC_TARGET_ROOT;
  if (fromEnv) return path.resolve(fromEnv);
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    if (readLane(dir) === "root") return dir;
    if (Object.values(LANE_FOLDERS).some((folder) => isDir(path.join(dir, folder)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (Object.values(LANE_FOLDERS).includes(path.basename(start))) return path.dirname(start);
  return start;
}

function optionalFlags(source) {
  const optional = source.optional && typeof source.optional === "object" ? source.optional : {};
  return {
    jiraMcp: Boolean(optional.jiraMcp ?? source.jiraMcp),
    confluenceMcp: Boolean(optional.confluenceMcp ?? source.confluenceMcp),
    cypressCloud: Boolean(optional.cypressCloud ?? source.cypressCloud),
    figmaMcp: Boolean(optional.figmaMcp ?? source.figmaMcp),
    testRail: Boolean(optional.testRail ?? source.testRail),
    teamworkGraphCli: Boolean(optional.teamworkGraphCli ?? source.teamworkGraphCli),
  };
}

function buildValues({ consumerRoot, moduleSpecsRoot, backendRoot, laneRoot }) {
  const values = {
    schema: "fhf-harness/workspace-setup/v1",
    consumerRoot,
    moduleSpecsRoot,
    backendRoot,
    optional: optionalFlags(existing),
  };
  if (lane === "e2e") values.e2eRoot = laneRoot ?? root;
  if (lane === "smoke") values.smokeRoot = laneRoot ?? root;
  return values;
}

function writeSetup(dir, values) {
  const file = path.join(dir, ".harness", "workspace.local.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(values, null, 2)}\n`, "utf8");
  return file;
}

function warnMissing(values) {
  const missing = [];
  for (const [field, value] of Object.entries({
    consumerRoot: values.consumerRoot,
    moduleSpecsRoot: values.moduleSpecsRoot,
    backendRoot: values.backendRoot,
    ...(values.e2eRoot ? { e2eRoot: values.e2eRoot } : {}),
    ...(values.smokeRoot ? { smokeRoot: values.smokeRoot } : {}),
  })) {
    if (!isDir(value)) missing.push(`${field}: ${value}`);
  }
  for (const line of missing) console.error(`Missing directory: ${line}`);
  if (missing.some((line) => line.startsWith("moduleSpecsRoot:"))) {
    console.error(`Clone specs: git clone git@github.com:treacyandcoventures/${SPECS_FOLDER}.git "${values.moduleSpecsRoot}"`);
  }
  return missing.length === 0;
}

function writeLaneCopies(consumerRoot, base) {
  const written = [];
  for (const [name, folder] of Object.entries(LANE_FOLDERS)) {
    const laneRoot = path.join(consumerRoot, folder);
    if (!isDir(laneRoot)) continue;
    const values = {
      ...base,
      backendRoot: name === "backend" ? laneRoot : base.backendRoot,
    };
    delete values.e2eRoot;
    delete values.smokeRoot;
    if (name === "e2e") values.e2eRoot = laneRoot;
    if (name === "smoke") values.smokeRoot = laneRoot;
    written.push(writeSetup(laneRoot, values));
  }
  return written;
}

async function runForm() {
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
    const inferred = inferAuto();
    const consumerRoot = await ask("FHF workspace root", existing.consumerRoot || inferred.consumerRoot);
    const moduleSpecsRoot = await ask("Application specs repository root", existing.moduleSpecsRoot || inferred.moduleSpecsRoot);
    const backendRoot = await ask(
      "Backend automation repository root",
      existing.backendRoot || existing.optional?.backendRoot || inferred.backendRoot,
    );
    const values = buildValues({ consumerRoot, moduleSpecsRoot, backendRoot });
    values.optional = {
      jiraMcp: await askBoolean("Jira MCP/OAuth is configured", values.optional.jiraMcp),
      confluenceMcp: await askBoolean("Confluence MCP/OAuth is configured", values.optional.confluenceMcp),
      cypressCloud: await askBoolean("Cypress Cloud metadata access is configured", values.optional.cypressCloud),
      figmaMcp: await askBoolean("Figma MCP/OAuth read access is configured", values.optional.figmaMcp),
      testRail: await askBoolean("TestRail read/reporting access is configured", values.optional.testRail),
      teamworkGraphCli: await askBoolean("Teamwork Graph CLI is installed and twg doctor is green (not merely allow-listed)", values.optional.teamworkGraphCli),
    };
    if (meta.rootField && meta.rootField !== "backendRoot") {
      values[meta.rootField] = await ask(meta.rootLabel, existing[meta.rootField] ?? root);
    }
    return values;
  } finally {
    rl.close();
  }
}

function inferAuto() {
  const consumerRoot = existing.consumerRoot || inferConsumerRoot(root);
  return {
    consumerRoot,
    moduleSpecsRoot: existing.moduleSpecsRoot || path.join(consumerRoot, SPECS_FOLDER),
    backendRoot: lane === "backend"
      ? root
      : (existing.backendRoot || existing.optional?.backendRoot || path.join(consumerRoot, LANE_FOLDERS.backend)),
  };
}

const inferred = inferAuto();
const values = FORM
  ? await runForm()
  : buildValues(inferred);

const wrote = writeSetup(root, values);
console.log(`FHF ${meta.name} workspace setup`);
console.log(`Wrote ${path.relative(root, wrote).replaceAll("\\", "/")}`);
if (lane === "root") {
  for (const file of writeLaneCopies(values.consumerRoot, values)) {
    console.log(`Wrote ${file}`);
  }
}
const complete = warnMissing(values);
if (!FORM) {
  console.log("Re-run with --form only if a path should not follow the standard FHF folder layout.");
}
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
if (!complete) process.exit(2);
console.log("Setup is ready. Open the FHF workspace root in Cursor, not a single lane folder.");
