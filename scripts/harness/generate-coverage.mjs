// Computed 5-layer coverage ledger — scans all lanes and emits one JSON source.
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
const FHF_ROOT = process.env.FHF_CONSUMER_ROOT
  ? path.resolve(process.env.FHF_CONSUMER_ROOT)
  : path.resolve(HARNESS_ROOT, "..", "FHF");
const OUT_JSON = path.join(FHF_ROOT, "docs", "evidence", "coverage-computed.json");
const CONTROL_PLANE_CONFIG_PATH = path.join(HARNESS_ROOT, "config", "qa-control-plane.json");
const CONTROL_PLANE = JSON.parse(fs.readFileSync(CONTROL_PLANE_CONFIG_PATH, "utf8"));
const BACKEND_EVIDENCE = CONTROL_PLANE.paths?.optionalReadOnlyEvidence?.backend;
const BACKEND_ROOT = BACKEND_EVIDENCE
  ? path.join(FHF_ROOT, BACKEND_EVIDENCE.root)
  : null;
const consentIndex = process.argv.indexOf("--consent");
const consent = consentIndex >= 0 ? process.argv[consentIndex + 1] : null;

function workspaceSetup() {
  const file = path.resolve(
    FHF_ROOT,
    process.env.FHF_HARNESS_WORKSPACE_CONFIG ?? CONTROL_PLANE.workspaceContract?.setupFile ?? ".harness/workspace.local.json",
  );
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed?.optional && typeof parsed.optional === "object"
      ? { ...parsed, ...parsed.optional }
      : parsed;
  } catch {
    return {};
  }
}

const SETUP = workspaceSetup();
function laneCypressRoot(lane) {
  const laneConfig = CONTROL_PLANE.paths.lanes[lane] ?? {};
  const configured = laneConfig.root
    ?? (laneConfig.rootEnv ? process.env[laneConfig.rootEnv] : null)
    ?? SETUP[`${lane}Root`];
  if (!configured) return null;
  const repoRoot = path.isAbsolute(configured) ? path.resolve(configured) : path.resolve(FHF_ROOT, configured);
  return path.join(repoRoot, laneConfig.package ?? "", "cypress");
}

const LANES = Object.fromEntries(
  Object.keys(CONTROL_PLANE.paths.lanes ?? {})
    .map((lane) => [lane, laneCypressRoot(lane)])
    .filter(([, root]) => root),
);

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
function backendModule(file) {
  const n = norm(file);
  if (n.includes("repoinvoice") || n.includes("auctioninvoice")) return "loss-mitigation";
  if (n.includes("ancillary") || n.includes("acd") || n.includes("apd")) return "ancillary";
  if (n.includes("unifi") || n.includes("payix")) return "unifi";
  return null;
}

function collectBackendEvidence() {
  if (!BACKEND_ROOT || !fs.existsSync(BACKEND_ROOT)) {
    return { availability: "unavailable", access: "read-only", rubric: BACKEND_LAYERS, modules: {} };
  }

  const modules = Object.fromEntries(MODULES.map((module) => [module, {}]));
  for (const client of walk(path.join(BACKEND_ROOT, "api"), ".py")) {
    if (["base_client.py", "__init__.py"].includes(path.basename(client))) continue;
    const module = backendModule(client);
    if (module) modules[module].client = true;
  }
  for (const test of walk(path.join(BACKEND_ROOT, "tests"), ".py")) {
    if (!path.basename(test).startsWith("test_")) continue;
    const module = backendModule(test);
    if (!module) continue;
    const content = fs.readFileSync(test, "utf8");
    const state = modules[module];
    state.tests = true;
    state.testFiles = (state.testFiles ?? 0) + 1;
    state.testCount = (state.testCount ?? 0) + (content.match(/^\s*def\s+test_/gm) ?? []).length;
    if (/assert_response_schema|assert_response_body|assert_response_status/.test(content)) state.contract = true;
    if (/assert_api_db_sync|execute_query|db_query|BaseDB/.test(content)) state.db = true;
    const ids = content.match(/\[C\d+\]/g) ?? [];
    state.testrailCount = (state.testrailCount ?? 0) + ids.length;
    if (ids.length) state.testrail = true;
  }
  return {
    availability: "available",
    access: "read-only",
    rubric: BACKEND_LAYERS,
    modules: Object.fromEntries(displayOrder.map((module) => {
      const state = modules[module];
      const present = BACKEND_LAYERS.filter((layer) => state[layer]).length;
      return [module, { ...state, state: present === BACKEND_LAYERS.length ? "FULL" : present ? "PARTIAL" : "NONE" }];
    })),
  };
}

const displayOrder = [...MODULES].sort();
const generatedAt = new Date().toISOString();
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
    backendEvidence: collectBackendEvidence(),
  },
  unmapped: [...new Set(unmapped)].sort(),
};
publishEvidenceBundle({
  consent,
  command: "generate-coverage",
  harnessRoot: HARNESS_ROOT,
  consumerRoot: FHF_ROOT,
  evidenceDir: path.dirname(OUT_JSON),
  runtimeFiles: ["coverage-computed.json"],
}, [
  { file: OUT_JSON, content: `${JSON.stringify(json, null, 2)}\n` },
]);
console.log(`Wrote ${path.relative(FHF_ROOT, OUT_JSON)} (${displayOrder.length} modules, ${unmapped.length} unmapped entries).`);
