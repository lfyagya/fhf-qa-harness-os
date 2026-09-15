// Shared parser for a spec's per-rule `traces:` block - the declared cross-layer edge.
//
// Rationale (2026-09-16): build-knowledge-index.mjs owned this parser privately and reported
// 0 of 611 business rules traced. A gate that re-implemented the same shape would drift from the
// reporter the first time either changed, and the two would disagree about what "traced" means
// while both looked green. One parser, two callers.
//
// Shape (all lists optional; at least one non-empty makes a rule traced):
//   business_rules:
//     - id: BR-RMT-029
//       traces:
//         api: [GET_REMARKETING_TITLES_ENDPOINT]   # names from tests/example_env
//         db: [TITLE_REMARKETING_TRACKER]          # constants from db_schema.py
//         tests: [backend:tests/smoke/.../test_x.py]

export const BR_ID_RE = /\bBR-[A-Z]{2,}-\d+\b/;
export const BR_ID_GLOBAL_RE = /\bBR-[A-Z]{2,}-\d+\b/g;

export function parseRuleTraces(text) {
  const start = text.indexOf("\nbusiness_rules:");
  if (start < 0) return [];
  const rest = text.slice(start + 1);
  const end = rest.search(/\n[a-z_]+:/);
  const body = end < 0 ? rest : rest.slice(0, end);
  return body
    .split(/\n(?=\s*-\s*id:\s*BR-)/)
    .map((entry) => {
      const id = entry.match(BR_ID_RE)?.[0];
      if (!id) return null;
      const list = (key) => {
        const inline = entry.match(new RegExp(`^\\s*${key}:\\s*\\[(.+)\\]\\s*$`, "m"));
        if (inline) {
          return inline[1]
            .split(",")
            .map((v) => v.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean);
        }
        const blockStart = entry.search(new RegExp(`^\\s*${key}:\\s*$`, "m"));
        if (blockStart < 0) return [];
        const after = entry.slice(blockStart).split("\n").slice(1);
        const items = [];
        for (const line of after) {
          const item = line.match(/^\s*-\s*(.+?)\s*$/);
          if (!item) break;
          items.push(item[1].replace(/^["']|["']$/g, ""));
        }
        return items;
      };
      const traces = { ui: list("ui"), api: list("api"), db: list("db"), tests: list("tests") };
      return { id, traces, traced: Object.values(traces).some((v) => v.length > 0) };
    })
    .filter(Boolean);
}

// Rules in this spec that are newly untraced - not covered by the baseline. The baseline is the
// ratchet: everything untraced when the gate landed is exempt, so the count can only fall.
export function untracedRules(text, baselineIds) {
  const exempt = baselineIds instanceof Set ? baselineIds : new Set(baselineIds ?? []);
  return parseRuleTraces(text)
    .filter((rule) => !rule.traced && !exempt.has(rule.id))
    .map((rule) => rule.id);
}

// A baselined rule that has gained traces must leave the baseline, or the ratchet silently
// stops tightening - the same "remove it from the list once it is documented" rule ADR-0027
// applied to hook rationales.
export function tracedButBaselined(text, baselineIds) {
  const exempt = baselineIds instanceof Set ? baselineIds : new Set(baselineIds ?? []);
  return parseRuleTraces(text)
    .filter((rule) => rule.traced && exempt.has(rule.id))
    .map((rule) => rule.id);
}

// ---------------------------------------------------------------------------------------------
// Resolution - the fake-edge test.
//
// A declared edge is not a real one until the thing it names exists. Without this a spec can
// satisfy the ratchet by naming an endpoint, table or test that was never there, and the linkage
// report counts it. Declaring is cheap; resolving is what makes the declaration mean something.
//
// Each category degrades independently: if a source cannot be read (no backend checkout, a lane
// absent on this machine) that category is skipped rather than failed. A missing local checkout is
// not an authoring error, and blocking on it would make the gate unusable on a partial workspace.

import fsNode from "node:fs";
import pathNode from "node:path";

function readIfPresent(file) {
  try { return fsNode.readFileSync(file, "utf8"); } catch { return null; }
}

function walkFiles(dir, ext, out = []) {
  let entries;
  try { entries = fsNode.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = pathNode.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, ext, out);
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

// Builds the set of names a trace may legitimately point at. Anything it cannot load is reported
// as unavailable so the caller can skip that category instead of rejecting every reference in it.
export function loadTraceUniverse({ backendRoot = null, laneRoots = [] } = {}) {
  const universe = { endpoints: null, dbObjects: null, roots: { backendRoot, laneRoots } };

  if (backendRoot) {
    const env = readIfPresent(pathNode.join(backendRoot, "tests", "example_env"));
    if (env !== null) {
      universe.endpoints = new Set([...env.matchAll(/^([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1]));
    }
    const schema = readIfPresent(pathNode.join(backendRoot, "tests", "commons", "db_schema.py"));
    if (schema !== null) {
      const names = new Set();
      for (const m of schema.matchAll(/^\s*([A-Z][A-Z0-9_]{3,})\s*[:=]/gm)) names.add(m[1]);
      for (const m of schema.matchAll(/["']([A-Za-z0-9_.]{4,})["']/g)) names.add(m[1].split(".").pop());
      universe.dbObjects = names;
    }
  }
  return universe;
}

// A tests:/ui: reference is "<prefix>:<path>" or a bare path. Resolution tries the prefix's root
// first, then every known root, because a path that exists somewhere real is the point - not
// whether the author picked the right prefix.
function resolveFileReference(ref, universe) {
  const [maybePrefix, ...rest] = String(ref).split(":");
  const hasPrefix = rest.length > 0 && !/^[\\/]/.test(rest[0]);
  const relative = hasPrefix ? rest.join(":") : String(ref);
  const { backendRoot, laneRoots } = universe.roots;

  const candidates = [];
  if (hasPrefix && maybePrefix === "backend" && backendRoot) candidates.push(backendRoot);
  else if (hasPrefix && backendRoot) candidates.push(backendRoot);
  if (backendRoot) candidates.push(backendRoot);
  candidates.push(...laneRoots);

  if (candidates.length === 0) return "unavailable";
  for (const root of candidates) {
    if (!root) continue;
    if (fsNode.existsSync(pathNode.resolve(root, relative))) return "resolved";
  }
  return "missing";
}

// Does the named test actually mention the rule? A file that exists but never names the rule is
// the article's fake edge: the arrow is drawn, no data flows along it. Reported separately from a
// missing file because the convention has almost no adoption yet (6 of 322 test files cite
// anything), so callers can warn on it rather than block.
function testCitesRule(ref, ruleId, universe) {
  const [maybePrefix, ...rest] = String(ref).split(":");
  const hasPrefix = rest.length > 0 && !/^[\\/]/.test(rest[0]);
  const relative = hasPrefix ? rest.join(":") : String(ref);
  const { backendRoot, laneRoots } = universe.roots;
  for (const root of [backendRoot, ...laneRoots]) {
    if (!root) continue;
    const full = pathNode.resolve(root, relative);
    const text = readIfPresent(full);
    if (text !== null) return text.includes(ruleId);
  }
  return null;
}

// Returns { unresolved, uncited } for one rule. unresolved entries name something that does not
// exist and should block; uncited entries resolve to a real file that never mentions the rule.
export function resolveTraces(rule, universe) {
  const unresolved = [];
  const uncited = [];
  if (!rule?.traces) return { unresolved, uncited };

  for (const name of rule.traces.api ?? []) {
    if (universe.endpoints === null) continue;
    if (!universe.endpoints.has(name)) unresolved.push(`api: ${name} is not a key in tests/example_env`);
  }
  for (const name of rule.traces.db ?? []) {
    if (universe.dbObjects === null) continue;
    const bare = String(name).split(".").pop();
    if (!universe.dbObjects.has(bare)) unresolved.push(`db: ${name} is not declared in tests/commons/db_schema.py`);
  }
  for (const ref of [...(rule.traces.tests ?? []), ...(rule.traces.ui ?? [])]) {
    const state = resolveFileReference(ref, universe);
    if (state === "missing") unresolved.push(`file: ${ref} does not exist`);
    if (state === "resolved" && testCitesRule(ref, rule.id, universe) === false) {
      uncited.push(`${ref} exists but never mentions ${rule.id}`);
    }
  }
  return { unresolved, uncited };
}
