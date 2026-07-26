// Computed 5-layer coverage ledger — scans both repos, emits docs/evidence/coverage-computed.md.
// The Evidence Registry idea from the paper OS reduced to one script: coverage state is
// derived from the repos, never hand-maintained.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  publishEvidenceBundle,
} from "./evidence-export-policy.mjs";

// This script is harness engine code (lives in fhf-harness-os) but scans and writes into
// the FHF consumer repo, which is a sibling directory, not a subdirectory of this repo.
const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FHF_ROOT = path.resolve(HARNESS_ROOT, "..", "FHF");
const OUT = path.join(FHF_ROOT, "docs", "evidence", "coverage-computed.md");
const OUT_JSON = path.join(FHF_ROOT, "docs", "evidence", "coverage-computed.json");
const BACKEND_ROOT = path.join(FHF_ROOT, "fhf-backend-automation");
const consentIndex = process.argv.indexOf("--consent");
const consent = consentIndex >= 0 ? process.argv[consentIndex + 1] : null;

const LANES = {
  e2e: path.join(FHF_ROOT, "AG Frontend Automation", "front-end-automation", "CypressFHF", "fhf-dashboards", "cypress"),
  smoke: path.join(FHF_ROOT, "ProdSmokeExecution", "front-end-automation", "CypressFHF", "fhf-dashboards", "cypress"),
};

// Canonical tokens, longest-normalized first so prefix matching can't collide
// (post-funding before funding, doc-repository before anything shorter).
const MODULES = [
  "loss-mitigation", "doc-repository", "post-funding", "call-reports",
  "complaints", "custodian", "insurance", "ancillary", "contracts",
  "letters", "funding", "checks", "titles", "unifi",
].sort((a, b) => norm(b).length - norm(a).length);

// Sub-module aliases → canonical module
const ALIASES = { collections: "unifi", servicing: "unifi", rereg: "titles" };
// Cross-cutting platform layers — shared by all modules, not coverage of any one
const SHARED = new Set([
  "common", "notes", "events", "email", "contacts", "contactmanagement",
  "communications", "notification", "loandetails", "replicant", "callcenter",
  "crmoutbox", "autosquared", "autosuggest", "lostlien", "auth", "login",
]);

function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function toModule(entryName) {
  const n = norm(entryName.replace(/\.(api|ui|commands|scenarios)\.js$/, "").replace(/\.js$/, ""));
  if (SHARED.has(n)) return "shared";
  if (ALIASES[n]) return ALIASES[n];
  return MODULES.find((m) => n === norm(m) || n.startsWith(norm(m))) ?? null;
}
function listEntries(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}
function walk(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, ext));
    else if (e.name.endsWith(ext)) out.push(full);
  }
  return out;
}

function backendModule(file) {
  const n = norm(file);
  if (n.includes("repoinvoice") || n.includes("auctioninvoice")) return "loss-mitigation";
  if (n.includes("ancillary") || n.includes("acd") || n.includes("apd")) return "ancillary";
  if (n.includes("unifi") || n.includes("payix")) return "unifi";
  return null;
}

const unmapped = [];
function collect(dir, layer, lane, bucket) {
  for (const entry of listEntries(dir)) {
    if (/^(_|index\.js$|.*registry.*|.*config\.js$|helpers$|shared$|smoke$|modules$)/i.test(entry)) continue;
    const mod = toModule(entry);
    if (mod && mod !== "shared") bucket(mod);
    else if (!mod) unmapped.push(`${lane}/${layer}: ${entry}`);
  }
}

const state = {}; // state[module][lane] = { scenario, api, ui, commands, spec, specFiles, its }
for (const m of MODULES) state[m] = { e2e: {}, smoke: {} };
const mark = (lane, layer) => (m) => { state[m][lane][layer] = true; };

for (const [lane, cy] of Object.entries(LANES)) {
  collect(path.join(cy, "configs", "scenarios"), "scenario", lane, mark(lane, "scenario"));
  collect(path.join(cy, "configs", "api"), "api", lane, mark(lane, "api"));
  collect(path.join(cy, "configs", "ui", "modules"), "ui", lane, mark(lane, "ui"));
  collect(path.join(cy, "configs", "ui"), "ui", lane, mark(lane, "ui")); // doc-repository sits at ui root
  const cmdRoots = [path.join(cy, "support", "commands", "modules"), path.join(cy, "support", "commands")];
  for (const r of cmdRoots) collect(r, "commands", lane, mark(lane, "commands"));

  const testRoot = path.join(cy, "tests");
  for (const spec of walk(testRoot, ".cy.js")) {
    const rel = path.relative(testRoot, spec).replace(/\\/g, "/");
    const mod = rel.split("/").map(toModule).find(Boolean);
    if (!mod || mod === "shared") { if (!mod) unmapped.push(`${lane}/spec: ${rel}`); continue; }
    const s = state[mod][lane];
    s.spec = true;
    s.specFiles = (s.specFiles ?? 0) + 1;
    s.its = (s.its ?? 0) + (fs.readFileSync(spec, "utf8").match(/^\s*it(\.\w+)?\(/gm) ?? []).length;
  }

  const scenarioRoot = path.join(cy, "configs", "scenarios");
  for (const scenarioFile of walk(scenarioRoot, ".js")) {
    const rel = path.relative(scenarioRoot, scenarioFile).replace(/\\/g, "/");
    const mod = rel.split("/").map(toModule).find(Boolean);
    if (!mod || mod === "shared") continue;
    const content = fs.readFileSync(scenarioFile, "utf8");
    const s = state[mod][lane];
    s.scenarios = (s.scenarios ?? 0) + (content.match(/\bid\s*:\s*['"`]/g) ?? []).length;
    s.jiraMapped = (s.jiraMapped ?? 0) +
      (content.match(/\bjiraId\s*:\s*['"`]SERV-\d+/g) ?? []).length;
  }
}

const LAYERS = ["scenario", "api", "ui", "commands", "spec"];
function verdict(laneState) {
  const have = LAYERS.filter((l) => laneState[l]).length;
  return have === LAYERS.length ? "FULL" : have === 0 ? "NONE" : "PARTIAL";
}

const BACKEND_LAYERS = ["client", "tests", "contract", "db", "testrail"];
const backendState = {};
for (const m of MODULES) backendState[m] = {};

// Reference-readiness signal — deliberately NOT one of BACKEND_LAYERS and never counted in
// backendVerdict(). It answers "is the API contract already mapped for whoever builds this,"
// not "does automation exist" — those are different questions and collapsing them into one
// State value would hide which one is true. Reuses qa-control-plane.json's own module→directory
// mapping (moduleSpecPaths) rather than a second, parallel mapping that could drift from it.
//
// Checks module-context.yaml for a top-level `backend_automation:` key — NOT a separate file.
// A standalone backend-automation-reference.md was tried first (2026-07-24) and reverted same
// day: this corpus was deliberately restructured to exactly two files per module (specs/*.yaml +
// module-context.yaml), and a third loosely-named file per module reintroduces the exact
// proliferation that restructure eliminated. String-matched, not full YAML-parsed — presence
// detection only, no need for a YAML dependency here.
const CONTROL_PLANE_CONFIG_PATH = path.join(HARNESS_ROOT, "config", "qa-control-plane.json");
const MODULE_SPEC_PATHS = fs.existsSync(CONTROL_PLANE_CONFIG_PATH)
  ? JSON.parse(fs.readFileSync(CONTROL_PLANE_CONFIG_PATH, "utf8")).moduleSpecPaths ?? {}
  : {};
function hasBackendRefDoc(moduleKey) {
  const specPaths = MODULE_SPEC_PATHS[moduleKey] ?? [];
  const dirs = [...new Set(specPaths.map((p) => path.dirname(p)))];
  return dirs.some((dir) => {
    const contextFile = path.join(FHF_ROOT, dir, "module-context.yaml");
    if (!fs.existsSync(contextFile)) return false;
    return /^backend_automation:/m.test(fs.readFileSync(contextFile, "utf8"));
  });
}
for (const m of MODULES) backendState[m].refDoc = hasBackendRefDoc(m);

for (const client of walk(path.join(BACKEND_ROOT, "api"), ".py")) {
  if (path.basename(client) === "base_client.py" || path.basename(client) === "__init__.py") continue;
  const mod = backendModule(client);
  if (mod) backendState[mod].client = true;
  else unmapped.push(`backend/client: ${path.relative(BACKEND_ROOT, client).replace(/\\/g, "/")}`);
}

for (const test of walk(path.join(BACKEND_ROOT, "tests"), ".py")) {
  if (!path.basename(test).startsWith("test_")) continue;
  const mod = backendModule(test);
  if (!mod) {
    if (!path.relative(path.join(BACKEND_ROOT, "tests"), test).startsWith("smoke")) {
      unmapped.push(`backend/test: ${path.relative(BACKEND_ROOT, test).replace(/\\/g, "/")}`);
    }
    continue;
  }
  const content = fs.readFileSync(test, "utf8");
  const s = backendState[mod];
  s.tests = true;
  s.testFiles = (s.testFiles ?? 0) + 1;
  s.testCount = (s.testCount ?? 0) + (content.match(/^\s*def\s+test_/gm) ?? []).length;
  if (/assert_response_schema|assert_response_body|assert_response_status/.test(content)) s.contract = true;
  if (/assert_api_db_sync|execute_query|db_query|BaseDB/.test(content)) s.db = true;
  const ids = content.match(/\[C\d+\]/g) ?? [];
  s.testrailCount = (s.testrailCount ?? 0) + ids.length;
  if (ids.length) s.testrail = true;
}

function backendVerdict(moduleState) {
  const have = BACKEND_LAYERS.filter((layer) => moduleState[layer]).length;
  return have === BACKEND_LAYERS.length ? "FULL" : have === 0 ? "NONE" : "PARTIAL";
}

const displayOrder = [...MODULES].sort();
const generatedAt = new Date().toISOString();
const lines = [
  "# Coverage — Computed Ledger",
  "",
  "> **Generated by `node scripts/harness/generate-coverage.mjs` — do not hand-edit.**",
  `> Scanned: E2E + Smoke Cypress trees and Backend pytest/API trees at ${generatedAt}.`,
  "",
];
for (const lane of ["e2e", "smoke"]) {
  lines.push(`## ${lane.toUpperCase()} lane`, "", "| Module | scenario | api | ui | commands | spec | Scenarios | Jira mapped | Spec files | it() | State |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const m of displayOrder) {
    const s = state[m][lane];
    const cell = (l) => (s[l] ? "✅" : "—");
    lines.push(`| ${m} | ${cell("scenario")} | ${cell("api")} | ${cell("ui")} | ${cell("commands")} | ${cell("spec")} | ${s.scenarios ?? 0} | ${s.jiraMapped ?? 0} | ${s.specFiles ?? 0} | ${s.its ?? 0} | ${verdict(s)} |`);
  }
  lines.push("");
}
lines.push(
  "## BACKEND lane",
  "",
  "> Backend uses its own rubric: typed API client → tests → API contract assertions → DB assertions → TestRail mapping.",
  "",
  "| Module | client | tests | contract | db | TestRail | Test files | test_* | mapped cases | State | Ref doc |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
);
for (const m of displayOrder) {
  const s = backendState[m];
  const cell = (layer) => (s[layer] ? "✅" : "—");
  lines.push(`| ${m} | ${cell("client")} | ${cell("tests")} | ${cell("contract")} | ${cell("db")} | ${cell("testrail")} | ${s.testFiles ?? 0} | ${s.testCount ?? 0} | ${s.testrailCount ?? 0} | ${backendVerdict(s)} | ${s.refDoc ? "✅" : "—"} |`);
}
lines.push("");
if (unmapped.length) {
  lines.push("## Unmapped entries (extend MODULES or naming standard)", "");
  for (const u of [...new Set(unmapped)].sort()) lines.push(`- \`${u}\``);
  lines.push("");
}

const json = {
  schemaVersion: 1,
  generatedAt,
  lanes: {
    e2e: {
      rubric: LAYERS,
      modules: Object.fromEntries(displayOrder.map((m) => [m, { ...state[m].e2e, state: verdict(state[m].e2e) }])),
    },
    smoke: {
      rubric: LAYERS,
      modules: Object.fromEntries(displayOrder.map((m) => [m, { ...state[m].smoke, state: verdict(state[m].smoke) }])),
    },
    backend: {
      rubric: BACKEND_LAYERS,
      modules: Object.fromEntries(displayOrder.map((m) => [m, { ...backendState[m], state: backendVerdict(backendState[m]) }])),
    },
  },
  unmapped: [...new Set(unmapped)].sort(),
};
publishEvidenceBundle({
  consent,
  command: "generate-coverage",
  harnessRoot: HARNESS_ROOT,
  consumerRoot: FHF_ROOT,
  evidenceDir: path.dirname(OUT),
  runtimeFiles: ["coverage-computed.md", "coverage-computed.json"],
}, [
  { file: OUT, content: lines.join("\n") },
  { file: OUT_JSON, content: `${JSON.stringify(json, null, 2)}\n` },
]);
console.log(`Wrote ${path.relative(FHF_ROOT, OUT)} and ${path.relative(FHF_ROOT, OUT_JSON)} (${displayOrder.length} modules, ${unmapped.length} unmapped entries).`);
