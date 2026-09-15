#!/usr/bin/env node
// Backfill `traces:` for business rules that have none, as reviewable patches.
//
// Why this exists (2026-09-16): 617 rules carry no declared edge and only 33 of them (5%, all in
// recon.yaml) can be derived mechanically - the rest need judgement about which test, endpoint or
// table actually verifies the rule. That is Anthropic's "parallelization / sectioning" shape:
// known, independent subtasks fanned out and converged, not an agent discovering its own steps.
//
// Three things keep this portable rather than bound to one assistant:
//   1. The orchestrator is plain Node. It runs wherever node runs.
//   2. The model step is a CLI adapter read from config, so Claude, Codex, Cursor or anything else
//      that accepts a prompt file and prints JSON can be the worker.
//   3. The verifier is code, not a model. resolveTraces() answers "does this thing exist?"
//      objectively, so the checker cannot agree with a worker's mistake - stronger than a second
//      model reviewing the first, and free.
//
// It never edits a spec. It emits a patch for review.
//
// Usage:
//   node scripts/harness/backfill-traces.mjs --module loss-mitigation [--spec recon.yaml]
//   node scripts/harness/backfill-traces.mjs --module loss-mitigation --proposals props.json
//
// Without --proposals it writes one context bundle per spec and stops; that bundle is the prompt
// any adapter consumes. With --proposals it verifies and emits the patch.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveConsumerRoot } from "./workspace-paths.mjs";
import { parseRuleTraces, loadTraceUniverse, resolveTraces } from "../../.claude/hooks/lib/spec-linkage.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FHF_ROOT = resolveConsumerRoot(HARNESS_ROOT);
const CONFIG = JSON.parse(fs.readFileSync(path.join(HARNESS_ROOT, "config", "qa-control-plane.json"), "utf8"));

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};

const moduleName = arg("module");
const onlySpec = arg("spec");
const proposalsFile = arg("proposals");
const outDir = path.resolve(arg("out", path.join(FHF_ROOT, "docs", "evidence", "backfill")));

if (!moduleName) {
  console.error("usage: --module <name> [--spec <file.yaml>] [--proposals <file.json>] [--out <dir>]");
  process.exit(1);
}

const specRefs = (CONFIG.moduleSpecPaths ?? {})[moduleName];
if (!specRefs) {
  console.error(`No spec route for module "${moduleName}". Known: ${Object.keys(CONFIG.moduleSpecPaths ?? {}).join(", ")}`);
  process.exit(1);
}

// ---- evidence the module could legitimately trace to --------------------------------------------
const backendRel = CONFIG.paths?.automationLanes?.backend?.root ?? CONFIG.paths?.lanes?.backend?.root ?? null;
const backendRoot = backendRel ? path.resolve(FHF_ROOT, backendRel) : null;
const laneRoots = Object.values(CONFIG.paths?.lanes ?? {})
  .map((lane) => (lane?.root ? path.resolve(FHF_ROOT, lane.root, lane.package ?? "") : null))
  .filter(Boolean);

const universe = loadTraceUniverse({ backendRoot, laneRoots });

function walk(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

// Candidate evidence is filtered by module token, not guessed at by similarity to a rule. A worker
// gets the whole candidate set and decides; narrowing it here with a heuristic would quietly hide
// the correct answer.
function candidates(tokenList) {
  const list = Array.isArray(tokenList) ? tokenList : [tokenList];
  const re = new RegExp(list.map((t) => String(t).trim().replace(/[-_\s]+/g, "[-_ ]?")).join("|"), "i");
  const endpoints = [...(universe.endpoints ?? [])].filter((name) => re.test(name));
  const tables = [...(universe.dbObjects ?? [])].filter((name) => re.test(name));
  const tests = [];
  if (backendRoot) {
    for (const file of walk(path.join(backendRoot, "tests"), ".py")) {
      if (!path.basename(file).startsWith("test_")) continue;
      const rel = path.relative(backendRoot, file).split(path.sep).join("/");
      if (re.test(rel)) tests.push(`backend:${rel}`);
    }
  }
  const ui = [];
  for (const root of laneRoots) {
    for (const file of walk(path.join(root, "cypress", "tests"), ".cy.js")) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      if (re.test(rel)) ui.push(rel);
    }
  }
  return { endpoints, tables, tests, ui };
}

// moduleAliases is the authoritative vocabulary for a module and is what the prompt router
// already matches on. The module NAME only appears in file paths - endpoint and table names use
// domain tokens (RECON, AUCTION, REPO_STATUS), so filtering by the name alone returned 26 ui
// files and zero endpoints or tables. Reusing the alias list fixes that without inventing a
// second vocabulary that would drift from the router.
const aliases = [moduleName, ...(CONFIG.moduleAliases?.[moduleName] ?? [])];
const specToken = onlySpec ? path.basename(onlySpec, path.extname(onlySpec)) : null;
const tokens = [...new Set([...aliases, specToken].filter(Boolean))];
const evidence = candidates(tokens);

// ---- select the work ----------------------------------------------------------------------------
const targets = [];
for (const rel of specRefs) {
  if (onlySpec && !rel.endsWith(onlySpec)) continue;
  const full = path.join(FHF_ROOT, rel);
  if (!fs.existsSync(full)) continue;
  const text = fs.readFileSync(full, "utf8");
  const untraced = parseRuleTraces(text).filter((rule) => !rule.traced);
  if (untraced.length === 0) continue;
  targets.push({ rel, full, text, untraced });
}

if (targets.length === 0) {
  console.log(`Nothing to backfill for ${moduleName}${onlySpec ? ` / ${onlySpec}` : ""}.`);
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });

// Persistent run state. The Loop Engineering study of 36,710 repositories found that almost
// none commit the state files the pattern prescribes, and the cost is exactly this: a crashed
// or interrupted run restarts from zero. The harness already does this for agent loops
// (engineering.context.runtime.stateFile); this is the same idea scoped to a backfill run, so
// a resumed run skips specs whose patch was already produced.
const STATE_FILE = path.join(outDir, `${moduleName}.backfill-state.json`);
function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (parsed.schema === "fhf-harness/backfill-state/v1") return parsed;
  } catch {}
  return {
    schema: "fhf-harness/backfill-state/v1",
    module: moduleName,
    startedAt: new Date().toISOString(),
    specs: {},
    totals: { proposed: 0, kept: 0, dropped: 0 },
  };
}
function saveState(state) {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}
const runState = loadState();

// ---- without proposals: emit the bundles an adapter consumes -------------------------------------
if (!proposalsFile) {
  const adapters = CONFIG.engineering?.harness?.backfill?.adapters ?? {};
  for (const target of targets) {
    const name = path.basename(target.rel, path.extname(target.rel));
    const bundle = {
      schema: "fhf-harness/backfill-bundle/v1",
      module: moduleName,
      spec: target.rel,
      instruction:
        "For each rule below, declare where it is verified. Use ONLY names from `evidence`. "
        + "Omit a rule entirely rather than guess - an unresolvable trace is worse than none, "
        + "because it reports as covered while nothing verifies the rule. "
        + "Return JSON: { \"proposals\": [ { \"id\": \"BR-...\", \"traces\": { \"ui\": [], \"api\": [], \"db\": [], \"tests\": [] } } ] }",
      evidence,
      rules: target.untraced.map((rule) => {
        const match = target.text.match(new RegExp(`- id:\\s*${rule.id}[\\s\\S]{0,600}?(?=\\n  - id:|\\n[a-z_]+:)`, "m"));
        return { id: rule.id, text: (match?.[0] ?? "").trim() };
      }),
    };
    const file = path.join(outDir, `${moduleName}.${name}.bundle.json`);
    fs.writeFileSync(file, `${JSON.stringify(bundle, null, 2)}\n`);
    console.log(`bundle: ${path.relative(FHF_ROOT, file)}  (${bundle.rules.length} rules)`);
  }
  console.log("");
  console.log(`Evidence available: ${evidence.ui.length} ui, ${evidence.tests.length} tests, `
    + `${evidence.endpoints.length} endpoints, ${evidence.tables.length} tables.`);
  console.log("Run an adapter over each bundle, then re-run with --proposals <file.json>.");
  console.log(`Configured adapters: ${Object.keys(adapters).join(", ") || "(none; any CLI that reads the bundle and prints the JSON shape works)"}`);
  process.exit(0);
}

// ---- with proposals: verify, then emit a patch ---------------------------------------------------
const proposals = JSON.parse(fs.readFileSync(path.resolve(proposalsFile), "utf8")).proposals ?? [];
const byId = new Map(proposals.map((p) => [p.id, p.traces ?? {}]));

// Keep rate is the metric that decides whether the worker is worth running, so its denominator
// must be proposals for THIS spec. One combined proposals file across several specs otherwise
// counts the other specs' rules as misses and reports a false 45%.
const targetIds = new Set(targets.flatMap((t) => t.untraced.map((r) => r.id)));
const relevant = proposals.filter((p) => targetIds.has(p.id));

let kept = 0;
let dropped = 0;
const dropReasons = [];
const patches = [];

for (const target of targets) {
  let updated = target.text;
  let changedHere = 0;

  for (const rule of target.untraced) {
    const traces = byId.get(rule.id);
    if (!traces) continue;

    // The verifier is code. A proposal survives only if every name it declares resolves.
    const probe = { id: rule.id, traces: { ui: traces.ui ?? [], api: traces.api ?? [], db: traces.db ?? [], tests: traces.tests ?? [] } };
    const nonEmpty = Object.values(probe.traces).some((v) => v.length > 0);
    if (!nonEmpty) continue;
    const { unresolved } = resolveTraces(probe, universe);
    if (unresolved.length > 0) {
      dropped += 1;
      dropReasons.push(`${rule.id}: ${unresolved.join("; ")}`);
      continue;
    }

    const lines = ["    traces:"];
    for (const key of ["ui", "api", "db", "tests"]) {
      const list = probe.traces[key];
      if (list.length) lines.push(`      ${key}: [${list.join(", ")}]`);
    }
    // No "m" flag: with it, $ matches the end of every line, so the lazy body stopped at the
    // first newline and traces: landed above statement:. Anchor on a newline instead of ^ and
    // let $ mean end-of-file, so the whole rule block is captured and traces: appends after it.
    const anchor = new RegExp(`(
  - id:\\s*${rule.id}\\b[\\s\\S]*?)(?=\\n  - id:|\\n[a-z_]+:|$)`);
    const match = updated.match(anchor);
    if (!match) continue;
    updated = updated.replace(anchor, `${match[1].replace(/\s*$/, "")}\n${lines.join("\n")}\n`);
    kept += 1;
    changedHere += 1;
  }

  if (changedHere > 0) patches.push({ rel: target.rel, before: target.text, after: updated, count: changedHere });
}

// Unified diff, written as a file rather than applied. 584 unreviewed spec edits is not a patch,
// it is a rewrite.
// ponytail: git computes the diff. The hand-rolled version here spun forever the moment one
// side ran out of lines - writing a diff algorithm to avoid shelling out to the tool that
// already has one was the wrong trade.
function diff(rel, before, after) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-diff-"));
  const a = path.join(dir, "a");
  const b = path.join(dir, "b");
  try {
    fs.writeFileSync(a, before);
    fs.writeFileSync(b, after);
    const result = spawnSync("git", ["diff", "--no-index", "--unified=3", "--", a, b], {
      encoding: "utf8",
      timeout: 20000,
    });
    const text = result.stdout ?? "";
    // git labels the temp paths; relabel to the real spec so the patch is applicable by hand.
    return text
      .split("\n")
      .map((line) => (line.startsWith("--- ") ? `--- a/${rel}` : line.startsWith("+++ ") ? `+++ b/${rel}` : line))
      .filter((line) => !line.startsWith("diff --git") && !line.startsWith("index "))
      .join("\n")
      .trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const patchFile = path.join(outDir, `${moduleName}${onlySpec ? `.${path.basename(onlySpec, ".yaml")}` : ""}.patch`);
fs.writeFileSync(patchFile, `${patches.map((p) => diff(p.rel, p.before, p.after)).join("\n")}\n`);

for (const p of patches) {
  runState.specs[p.rel] = {
    rules: p.count,
    patchedAt: new Date().toISOString(),
  };
}
runState.totals = {
  proposed: runState.totals.proposed + proposals.length,
  kept: runState.totals.kept + kept,
  dropped: runState.totals.dropped + dropped,
};
saveState(runState);

const reportFile = path.join(outDir, `${moduleName}.report.json`);
fs.writeFileSync(reportFile, `${JSON.stringify({
  module: moduleName,
  spec: onlySpec ?? null,
  proposed: relevant.length,
  kept,
  dropped,
  keepRate: relevant.length ? Math.round((kept / relevant.length) * 100) : 0,
  dropReasons,
  specs: patches.map((p) => ({ spec: p.rel, rules: p.count })),
}, null, 2)}\n`);

console.log(`proposed ${relevant.length}, kept ${kept}, dropped ${dropped} `
  + `(keep rate ${relevant.length ? Math.round((kept / relevant.length) * 100) : 0}%)`);
for (const reason of dropReasons.slice(0, 10)) console.log(`  dropped ${reason}`);
console.log(`\npatch : ${path.relative(FHF_ROOT, patchFile)}`);
console.log(`report: ${path.relative(FHF_ROOT, reportFile)}`);
console.log(`state : ${path.relative(FHF_ROOT, STATE_FILE)}`);
const done = Object.keys(runState.specs);
if (done.length > 1) console.log(`specs with a patch so far: ${done.length}`);
console.log("Review the patch before applying. Nothing was written to a spec.");
