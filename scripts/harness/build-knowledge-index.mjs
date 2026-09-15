#!/usr/bin/env node
// Read-only knowledge index: joins application specs (UI/business rules) to
// automation (Cypress specs, pytest), API endpoints, and Oracle tables/views.
// Emits nodes + edges + a linkage gap report. Derives edges only from what is
// already declared; it never infers a link from name similarity.
//
// ponytail: regex-scanned YAML/Python, not parsed. No yaml/AST dependency for a
// read-only report. Switch to a real parser if edge extraction starts needing
// nesting depth or anchors.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspacePathsConfig, resolveConsumerRoot, resolveLaneRoot } from "./workspace-paths.mjs";
import { parseRuleTraces } from "../../.claude/hooks/lib/spec-linkage.mjs";

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const paths = loadWorkspacePathsConfig(harnessRoot);
const consumerRoot = resolveConsumerRoot(harnessRoot);

const BR_ID = /\bBR-[A-Z]{2,}-\d+\b/g;
const SPEC_REF = /\bspecs\/[A-Za-z0-9._/-]+\.yaml\b/g;
const TEST_EXT = /\.(cy\.js|cy\.ts|py)$/;
const IGNORE_DIRS = new Set(["node_modules", "venv", "site-packages", "reports", "allure-results"]);
// Backend lane: only first-party test + client code, never the interpreter's own libs.
const IS_AUTOMATION = (relPath) => !relPath.endsWith(".py") || /^(tests|api|dao|db|util|commons)\//.test(relPath);

function walk(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(e.name) || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, filter, out);
    else if (filter(e.name)) out.push(full);
  }
  return out;
}

const read = (f) => fs.readFileSync(f, "utf8");
const uniq = (xs) => [...new Set(xs)];
const matches = (text, re) => uniq(text.match(re) ?? []);
const rel = (root, f) => path.relative(root, f).split(path.sep).join("/");

// ---- application-intelligence specs: nodes + declared UI edges ----
const specsRoot = path.resolve(consumerRoot, paths.applicationIntelligence);
const specFiles = walk(specsRoot, (n) => n.endsWith(".yaml"));

// Per-rule `traces:` parsing lives in .claude/hooks/lib/spec-linkage.mjs so this reporter and
// validate-spec-linkage.mjs cannot disagree about what "traced" means. See that file for the shape.
const specs = specFiles.map((file) => {
  const text = read(file);
  const field = (key) => text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1].trim() ?? null;
  const block = (key) => {
    const start = text.indexOf(`\n${key}:`);
    if (start < 0) return "";
    const rest = text.slice(start + 1);
    const end = rest.search(/\n[a-z_]+:/);
    return end < 0 ? rest : rest.slice(0, end);
  };
  return {
    id: field("id") ?? rel(specsRoot, file),
    file: rel(specsRoot, file),
    kind: file.includes(`${path.sep}components${path.sep}`) ? "component" : "module-spec",
    module: field("module"),
    subModule: field("sub_module"),
    componentKey: field("component_key"),
    status: field("status"),
    businessRules: matches(text, BR_ID),
    rules: parseRuleTraces(text),
    dependsOnComponents: matches(block("depends_on_components"), /^\s*-\s*([a-z0-9-]+)/gm)
      .map((m) => m.replace(/^\s*-\s*/, "")),
    componentInheritance: matches(block("component_inheritance"), /^\s{2,}([a-z0-9-]+):/gm)
      .map((m) => m.trim().replace(/:$/, "")),
    specRefs: matches(text, SPEC_REF),
  };
});

// ---- automation: which specs/rules any test actually references ----
const laneRoots = Object.fromEntries(
  Object.keys(paths.lanes).map((lane) => [lane, resolveLaneRoot(harnessRoot, consumerRoot, lane)]),
);

const tests = Object.entries(laneRoots).flatMap(([lane, root]) =>
  walk(root, (n) => TEST_EXT.test(n)).map((file) => rel(root, file)).filter(IS_AUTOMATION).map((relPath) => {
    const text = read(path.join(root, relPath));
    return {
      lane,
      file: relPath,
      businessRules: matches(text, BR_ID),
      specRefs: matches(text, SPEC_REF),
      endpointEnvs: matches(text, /\b[A-Z][A-Z0-9_]*_ENDPOINT\b/g),
      dbObjects: matches(text, /\b[A-Z][A-Z0-9_]{4,}\b/g),
    };
  }),
);

// ---- API + DB nodes from the backend lane's committed templates ----
// Never read tests/.env — example_env is the placeholder template (.claude/rules/security.md).
const backendRoot = laneRoots.backend;
const envTemplate = path.join(backendRoot, "tests", "example_env");
const endpoints = fs.existsSync(envTemplate)
  ? matches(read(envTemplate), /^[A-Z][A-Z0-9_]*_ENDPOINT(?==)/gm)
  : [];

const dbSchemaFile = path.join(backendRoot, "tests", "commons", "db_schema.py");
const dbObjects = fs.existsSync(dbSchemaFile)
  ? matches(read(dbSchemaFile), /"([A-Z][A-Z0-9_]{4,})"/g).map((m) => m.replace(/"/g, ""))
  : [];

// ---- edges ----
const specText = new Map(specFiles.map((f) => [rel(specsRoot, f), read(f)]));
const allSpecText = [...specText.values()].join("\n");
const testsByRule = new Map();
for (const t of tests) for (const br of t.businessRules) {
  testsByRule.set(br, [...(testsByRule.get(br) ?? []), `${t.lane}:${t.file}`]);
}

const declaredRules = uniq(specs.flatMap((s) => s.businessRules));
const edges = [
  ...specs.flatMap((s) => [...s.dependsOnComponents, ...s.componentInheritance].map((c) => ({
    from: s.file, to: `component:${c}`, type: "declares-component-dependency",
  }))),
  ...specs.flatMap((s) => s.specRefs.map((r) => ({ from: s.file, to: r, type: "references-spec" }))),
  ...[...testsByRule].flatMap(([br, files]) => files.map((f) => ({ from: f, to: br, type: "covers-business-rule" }))),
  ...tests.flatMap((t) => t.endpointEnvs.filter((e) => endpoints.includes(e))
    .map((e) => ({ from: `${t.lane}:${t.file}`, to: `endpoint:${e}`, type: "calls-endpoint" }))),
  ...tests.flatMap((t) => t.dbObjects.filter((o) => dbObjects.includes(o))
    .map((o) => ({ from: `${t.lane}:${t.file}`, to: `db:${o}`, type: "reads-db-object" }))),
  ...endpoints.filter((e) => allSpecText.includes(e)).map((e) => ({ from: `endpoint:${e}`, to: "specs", type: "named-in-spec" })),
  ...dbObjects.filter((o) => allSpecText.includes(o)).map((o) => ({ from: `db:${o}`, to: "specs", type: "named-in-spec" })),
];

// Declared traces become typed edges, and every target is validated — an edge
// that points at a non-existent endpoint/table/test file is worse than no edge.
const laneOf = (ref) => ref.split(":")[0];
const pathOf = (ref) => ref.slice(ref.indexOf(":") + 1);
const tracedRules = specs.flatMap((s) => s.rules.filter((r) => r.traced).map((r) => ({ ...r, spec: s.file })));
const traceEdges = [];
const traceErrors = [];
for (const r of tracedRules) {
  for (const e of r.traces.api) {
    traceEdges.push({ from: r.id, to: `endpoint:${e}`, type: "rule-traces-endpoint" });
    if (!endpoints.includes(e)) traceErrors.push(`${r.spec} ${r.id}: unknown endpoint ${e}`);
  }
  for (const o of r.traces.db) {
    traceEdges.push({ from: r.id, to: `db:${o}`, type: "rule-traces-db-object" });
    if (!dbObjects.includes(o)) traceErrors.push(`${r.spec} ${r.id}: unknown db object ${o}`);
  }
  for (const t of r.traces.tests) {
    traceEdges.push({ from: r.id, to: `test:${t}`, type: "rule-traces-test" });
    const root = laneRoots[laneOf(t)];
    if (!root) traceErrors.push(`${r.spec} ${r.id}: unknown lane in ${t}`);
    else if (!fs.existsSync(path.join(root, pathOf(t)))) traceErrors.push(`${r.spec} ${r.id}: missing test file ${t}`);
  }
}
edges.push(...traceEdges);

const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
const coveredRules = declaredRules.filter((br) => testsByRule.has(br));
const endpointsInSpecs = endpoints.filter((e) => allSpecText.includes(e));
const dbInSpecs = dbObjects.filter((o) => allSpecText.includes(o));

const index = {
  schema: "fhf-harness/knowledge-index/v1",
  generatedAt: new Date().toISOString(),
  roots: { specs: specsRoot, ...laneRoots },
  counts: {
    specs: specs.length,
    businessRules: declaredRules.length,
    tests: tests.length,
    endpoints: endpoints.length,
    dbObjects: dbObjects.length,
    edges: edges.length,
  },
  traceErrors,
  linkage: {
    rulesWithTraces: { n: tracedRules.length, of: declaredRules.length, pct: pct(tracedRules.length, declaredRules.length) },
    businessRulesWithTest: { n: coveredRules.length, of: declaredRules.length, pct: pct(coveredRules.length, declaredRules.length) },
    endpointsNamedInSpecs: { n: endpointsInSpecs.length, of: endpoints.length, pct: pct(endpointsInSpecs.length, endpoints.length) },
    dbObjectsNamedInSpecs: { n: dbInSpecs.length, of: dbObjects.length, pct: pct(dbInSpecs.length, dbObjects.length) },
    testsCitingAnySpec: { n: tests.filter((t) => t.businessRules.length || t.specRefs.length).length, of: tests.length },
  },
  nodes: { specs, tests, endpoints, dbObjects },
  edges,
};

if (process.argv.includes("--selftest")) {
  const a = (cond, msg) => { if (!cond) { console.error(`FAIL ${msg}`); process.exitCode = 1; } };
  a(index.counts.specs > 0, "no spec nodes found — applicationIntelligence path wrong?");
  a(index.counts.businessRules > 0, "no business rules extracted — BR_ID regex broke");
  a(index.counts.endpoints > 0, "no endpoints extracted from example_env");
  a(index.counts.dbObjects > 0, "no db objects extracted from db_schema.py");
  a(!JSON.stringify(index).includes("=") || !/[A-Z_]+ENDPOINT=/.test(JSON.stringify(index)), "endpoint values leaked — names only");
  a(edges.every((e) => e.from && e.to && e.type), "malformed edge");

  const fixture = `
business_rules:
  - id: BR-XX-001
    statement: inline form
    traces:
      api: [GET_ONE_ENDPOINT, GET_TWO_ENDPOINT]
      db: [SOME_VW]
  - id: BR-XX-002
    statement: block form
    traces:
      tests:
        - e2e:cypress/tests/a.cy.js
        - backend:tests/test_b.py
  - id: BR-XX-003
    statement: untraced
    priority: Low
next_key:
  - id: BR-XX-004
`;
  const parsed = parseRuleTraces(fixture);
  a(parsed.length === 3, `traces parser read past business_rules block (${parsed.length} rules)`);
  a(parsed[0].traces.api.length === 2 && parsed[0].traces.db[0] === "SOME_VW", "inline list form not parsed");
  a(parsed[1].traces.tests.length === 2, "dash list form not parsed");
  a(parsed[2].traced === false && parsed[0].traced === true, "traced flag wrong");
  if (!process.exitCode) console.log("selftest ok");
  process.exit(process.exitCode ?? 0);
}

const outDir = path.resolve(consumerRoot, paths.evidenceDir);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "knowledge-index.json"), `${JSON.stringify(index, null, 2)}\n`);

const l = index.linkage;
const report = `# Knowledge Index — linkage gaps

Generated ${index.generatedAt}. Source: declared references only; no inferred links.

| Nodes | Count |
|---|---|
| Application specs (module + component) | ${index.counts.specs} |
| Business rules (BR-*) declared in specs | ${index.counts.businessRules} |
| Automation test files (e2e/smoke/backend) | ${index.counts.tests} |
| API endpoints (backend example_env) | ${index.counts.endpoints} |
| Oracle tables/views (db_schema.py) | ${index.counts.dbObjects} |
| Declared edges | ${index.counts.edges} |

| Edge | Linked | Total | % |
|---|---|---|---|
| Business rule → declared \`traces:\` | ${l.rulesWithTraces.n} | ${l.rulesWithTraces.of} | ${l.rulesWithTraces.pct} |
| Business rule → any test | ${l.businessRulesWithTest.n} | ${l.businessRulesWithTest.of} | ${l.businessRulesWithTest.pct} |
| API endpoint → named in a spec | ${l.endpointsNamedInSpecs.n} | ${l.endpointsNamedInSpecs.of} | ${l.endpointsNamedInSpecs.pct} |
| DB table/view → named in a spec | ${l.dbObjectsNamedInSpecs.n} | ${l.dbObjectsNamedInSpecs.of} | ${l.dbObjectsNamedInSpecs.pct} |
| Test files citing a spec or rule | ${l.testsCitingAnySpec.n} | ${l.testsCitingAnySpec.of} | ${pct(l.testsCitingAnySpec.n, l.testsCitingAnySpec.of)} |

Unlinked business rules are not "untested" — they are **unaccounted for**: no
machine-checkable path exists from the rule to a test, endpoint, or table.
`;
fs.writeFileSync(path.join(outDir, "knowledge-index.md"), report);
console.log(report);

if (traceErrors.length) {
  console.error(`\n${traceErrors.length} broken trace edge(s):`);
  for (const e of traceErrors) console.error(`  ${e}`);
}
// --check is the gate shape: broken edges fail, missing edges do not (yet).
if (process.argv.includes("--check") && traceErrors.length) process.exit(1);
