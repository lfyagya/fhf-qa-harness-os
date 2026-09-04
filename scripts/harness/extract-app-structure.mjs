#!/usr/bin/env node
// Read-only extraction of application structure from source: URL routes, their
// Okta access groups, the page component each mounts, and the API endpoint
// constants. Structure is DERIVED, never authored — rerun after any pull and
// the output is current by construction.
//
// Joins the app's real route list against each Cypress lane's own
// cypress/configs/app/routes.js so the two directions of drift are visible:
// a dashboard the suite has never heard of, and a lane path that no longer exists.
//
// Application source is read-only here (.claude/hooks/protect-app-source.mjs);
// this script only reads. Output is runtime evidence, not policy.
//
// ponytail: regex, not a TS AST. Exact for the declarative forms this app uses
// (`path={routes.X}`, string-template route constants). A route path assembled
// by a helper call or picked by a ternary is reported as unresolved rather than
// guessed — see counts.unresolved. Reach for ts-morph only if that list grows.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspacePathsConfig, resolveConsumerRoot, resolveLaneRoot } from "./workspace-paths.mjs";
import { buildGraph, makeResolver, parseAliases, reachableEndpoints } from "./import-graph-lib.mjs";

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const paths = loadWorkspacePathsConfig(harnessRoot);
const consumerRoot = resolveConsumerRoot(harnessRoot);
const appRoot = path.resolve(consumerRoot, paths.applicationRoot);

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);
const uniq = (xs) => [...new Set(xs)];
// Params differ in name between app and lane configs (:id vs :applicationId).
const normalize = (p) => p.replace(/:[A-Za-z0-9_]+/g, ":param").replace(/\/+$/, "") || "/";

// ---- object-literal symbol table -------------------------------------------
// Collects `export const NAME = { KEY: 'value' }` string entries as NAME.KEY.
export function collectConstants(text) {
  const table = new Map();
  // Standalone string consts (`const FIRST_HELP_COLL = 'firsthelp_coll'`) are the
  // base segments the endpoint maps interpolate, so they must be in the table too.
  for (const m of text.matchAll(/(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(['"`])([^'"`]*)\2\s*;?/g)) {
    table.set(m[1], m[3]);
  }
  const objects = text.matchAll(/(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:Object\.freeze\()?\{/g);
  for (const m of objects) {
    const name = m[1];
    // Walk braces from the opening one so nested objects terminate correctly.
    let depth = 0;
    let i = text.indexOf("{", m.index);
    const start = i;
    for (; i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") { depth -= 1; if (depth === 0) break; }
    }
    const body = text.slice(start + 1, i);
    // Entries may share a line (`{ ROOT: 'x', REPO: 'y' }`), so do not anchor to newlines.
    for (const entry of body.matchAll(/['"]?([A-Za-z0-9_ -]+)['"]?\s*:\s*(['"`])([^'"`]*)\2/g)) {
      table.set(`${name}.${entry[1].trim()}`, entry[3]);
    }
  }
  return table;
}

// Resolves `${OBJ.KEY}` references, chained, against the symbol table.
export function resolveTemplates(table, maxPasses = 6) {
  const out = new Map(table);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    for (const [key, value] of out) {
      if (!value.includes("${")) continue;
      const next = value.replace(/\$\{([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)?)\}/g, (whole, ref) => out.get(ref) ?? whole);
      if (next !== value) { out.set(key, next); changed = true; }
    }
    if (!changed) break;
  }
  return out;
}

// ---- app routes -------------------------------------------------------------
const routesFile = path.join(appRoot, "src", "constants", "routes.js");
const routesText = read(routesFile);
if (!routesText) throw new Error(`Cannot read app route constants at ${routesFile}`);
const routeConstants = resolveTemplates(collectConstants(routesText));

// Keys of the aggregate map the JSX refers to as `routes.X`. The file exports
// per-domain maps plus a combined one; index by bare KEY, preferring a resolved
// absolute path.
const routeByKey = new Map();
for (const [qualified, value] of routeConstants) {
  const key = qualified.split(".")[1];
  // `*` is the react-router catch-all, not a dashboard URL.
  if (value !== "*" && !value.startsWith("/")) continue;
  if (!routeByKey.has(key) || routeByKey.get(key).includes("${")) routeByKey.set(key, value);
}

// ---- mounted routes (JSX) ---------------------------------------------------
const routeDir = path.join(appRoot, "src", "routes");
const routeFiles = [
  path.join(appRoot, "src", "Router.tsx"),
  ...(fs.existsSync(routeDir) ? fs.readdirSync(routeDir).filter((f) => f.endsWith(".tsx")).map((f) => path.join(routeDir, f)) : []),
].filter((f) => fs.existsSync(f));

// One JSX element per <...Route ... /> block; attributes are order-independent.
export function parseRouteElements(text) {
  const found = [];
  for (const m of text.matchAll(/<([A-Za-z]*(?:SecureRoute|Route))\b([\s\S]*?)\/>/g)) {
    const [, guard, attrs] = m;
    const routeKey = attrs.match(/path=\{routes\.([A-Za-z0-9_]+)\}/)?.[1] ?? null;
    const literalPath = attrs.match(/path=(['"])(\/[^'"]*)\1/)?.[2] ?? null;
    if (!routeKey && !literalPath) continue;
    found.push({
      guard,
      routeKey,
      literalPath,
      component: attrs.match(/component=\{([A-Za-z0-9_]+)\}/)?.[1] ?? null,
      // Two forms in use: `dashboardAccessGroups.MODULE.TIER` and an array of
      // flat `accessGroups.SOME_GROUP` (possibly spanning lines).
      accessGroups: uniq([...attrs.matchAll(/\b(dashboardAccessGroups|accessGroups)\.([A-Za-z0-9_]+)(?:\.([A-Za-z0-9_]+))?/g)]
        .map((g) => (g[3] ? `${g[2]}.${g[3]}` : g[2]))),
      exact: /\bexact\b/.test(attrs),
    });
  }
  return found;
}

const importSource = (text, symbol) =>
  text.match(new RegExp(`import\\s+(?:\\{[^}]*\\b${symbol}\\b[^}]*\\}|${symbol})\\s+from\\s+['"]([^'"]+)['"]`))?.[1] ?? null;

// Components exported from src/routes/ are nested routers, not screens. A route
// that mounts one is a container: its own path renders nothing and its access
// control lives on the children, so it must not be counted as an untested
// dashboard or as a route missing an access group.
const containerComponents = new Set(
  routeFiles.flatMap((f) => [...(read(f) ?? "").matchAll(/export\s+const\s+([A-Za-z0-9_]+)/g)].map((m) => m[1])),
);

const routes = [];
const unresolved = [];
for (const file of routeFiles) {
  const text = read(file);
  const mountedIn = path.relative(appRoot, file).split(path.sep).join("/");
  for (const el of parseRouteElements(text)) {
    const routePath = el.literalPath ?? routeByKey.get(el.routeKey) ?? null;
    if (!routePath || routePath.includes("${")) {
      unresolved.push({ mountedIn, routeKey: el.routeKey, reason: routePath ? "unresolved-template" : "unknown-route-constant" });
      continue;
    }
    routes.push({
      path: routePath,
      normalizedPath: normalize(routePath),
      constant: el.routeKey,
      component: el.component,
      componentSource: el.component ? importSource(text, el.component) : null,
      guard: el.guard,
      accessGroups: el.accessGroups,
      exact: el.exact,
      isContainer: el.component ? containerComponents.has(el.component) : false,
      isDevOnly: routePath.startsWith("/__dev__"),
      isCatchAll: routePath === "*",
      mountedIn,
    });
  }
}

// A route constant that exists but is never mounted is either dead config or a
// screen reachable only by redirect — both are worth a QA look.
const mountedKeys = new Set(routes.map((r) => r.constant).filter(Boolean));
const unmountedConstants = [...routeByKey]
  .filter(([key, value]) => !mountedKeys.has(key) && !value.includes("${"))
  .map(([key, value]) => ({ constant: key, path: value }));

// ---- API endpoint constants -------------------------------------------------
const networkFile = path.join(appRoot, "src", "constants", "network.js");
const networkText = read(networkFile);
// Only the endpoint maps — network.js also holds httpConstants (content types,
// status codes), which are not API paths.
const frontendEndpoints = networkText
  ? [...resolveTemplates(collectConstants(networkText))]
      .filter(([qualified, value]) => /^[A-Za-z0-9_]*endpoints\./i.test(qualified) && value && !value.includes("${"))
      .map(([qualified, value]) => {
        const p = `/${value.replace(/^\//, "")}`;
        return { constant: qualified, path: p, normalizedPath: normalize(p) };
      })
      // A path that is a strict prefix of another is a base segment (mainEndpoints.*),
      // not a callable endpoint.
      .filter((e, _i, all) => !all.some((other) => other !== e && other.path.startsWith(`${e.path}/`)))
  : [];

// Backend automation's committed endpoint template. example_env only — never .env.
const backendRoot = resolveLaneRoot(harnessRoot, consumerRoot, "backend");
const envText = read(path.join(backendRoot, "tests", "example_env")) ?? "";
const backendEndpoints = [...envText.matchAll(/^([A-Z][A-Z0-9_]*_ENDPOINT)=(\/.*)$/gm)]
  .map((m) => ({ name: m[1], path: m[2].trim(), normalizedPath: normalize(m[2].trim()) }));

// ---- lane route configs -----------------------------------------------------
const laneRoutes = [];
for (const lane of ["e2e", "smoke"]) {
  const laneRoot = resolveLaneRoot(harnessRoot, consumerRoot, lane);
  const configFile = path.join(laneRoot, paths.lanes[lane].package ?? "", "cypress", "configs", "app", "routes.js");
  const text = read(configFile);
  if (!text) continue;
  for (const [qualified, value] of collectConstants(text)) {
    if (!value.startsWith("/")) continue;
    laneRoutes.push({ lane, key: qualified, path: value, normalizedPath: normalize(value) });
  }
}

// ---- component → service → endpoint ----------------------------------------
// The only hop with no declarative source. See import-graph-lib.mjs for why
// barrels and shared components are handled the way they are.
const srcDir = path.join(appRoot, "src");
const aliases = parseAliases(read(path.join(appRoot, "vite.config.ts")) ?? "", appRoot);
const resolveModule = makeResolver(aliases);
const moduleGraph = aliases.size ? buildGraph(srcDir) : new Map();

// Endpoint constant name → resolved path, including base segments, so a
// reference can be reported even when only a prefix is statically known.
const endpointPathByConstant = new Map(
  networkText ? [...resolveTemplates(collectConstants(networkText))]
    .filter(([q, v]) => /^[A-Za-z0-9_]*endpoints\./i.test(q) && v && !v.includes("${"))
    .map(([q, v]) => [q, `/${v.replace(/^\//, "")}`]) : [],
);
const leafEndpointPaths = new Set(frontendEndpoints.map((e) => e.path));
const backendByPath = new Map(backendEndpoints.map((e) => [e.normalizedPath, e.name]));

for (const route of routes) {
  route.endpoints = [];
  route.baseEndpointRefs = [];
  if (!route.componentSource || !moduleGraph.size) continue;
  const from = path.join(srcDir, "routes", "x.tsx"); // route files all live one level under src/
  const componentFile = resolveModule(route.componentSource, from) ?? resolveModule(route.componentSource, path.join(srcDir, "x.tsx"));
  route.componentFile = componentFile ? path.relative(appRoot, componentFile).split(path.sep).join("/") : null;
  if (!componentFile) continue;

  for (const [constant, meta] of reachableEndpoints(moduleGraph, componentFile, resolveModule)) {
    const endpointPath = endpointPathByConstant.get(constant) ?? null;
    const entry = {
      constant,
      path: endpointPath,
      backendEndpoint: endpointPath ? backendByPath.get(normalize(endpointPath)) ?? null : null,
      confidence: meta.confidence,
      hops: meta.chain.length - 1,
    };
    // A base segment reached on its own means the real path is composed at call
    // time — report it as a lead, never as a known endpoint.
    if (endpointPath && !leafEndpointPaths.has(endpointPath)) route.baseEndpointRefs.push(entry);
    else route.endpoints.push(entry);
  }
  route.endpoints.sort((a, b) => a.constant.localeCompare(b.constant));
}

// ---- joins ------------------------------------------------------------------
const laneByPath = new Map();
for (const lr of laneRoutes) laneByPath.set(lr.normalizedPath, [...(laneByPath.get(lr.normalizedPath) ?? []), `${lr.lane}:${lr.key}`]);
// A lane path counts as "still in the app" if ANY route constant declares it —
// mounted or not. Comparing against mounted routes alone would report a route
// this extractor simply failed to parse as deleted, which is worse than silence.
const declaredPaths = new Set([
  ...routes.map((r) => r.normalizedPath),
  ...[...routeByKey.values()].filter((v) => !v.includes("${")).map(normalize),
]);
const appPaths = new Set(routes.map((r) => r.normalizedPath));
const backendPaths = new Set(backendEndpoints.map((e) => e.normalizedPath));
const frontendPaths = new Set(frontendEndpoints.map((e) => e.normalizedPath));

// Screens: what a QA engineer can actually open and assert against.
const screens = routes.filter((r) => !r.isContainer && !r.isCatchAll && !r.isDevOnly);

// Lane configs store detail routes as the base path and append the id at call
// time (`/titles/release/details` for `/titles/release/details/:id`). Only the
// trailing params may differ — an extra literal segment means a different route.
export function isSatisfiedByParamRoute(lanePath, declared) {
  return declared.some((d) => d.startsWith(`${lanePath}/`)
    && d.slice(lanePath.length + 1).split("/").every((seg) => seg.startsWith(":")));
}
const declaredList = [...declaredPaths];
const satisfiedByParamRoute = (lanePath) => isSatisfiedByParamRoute(lanePath, declaredList);

// Same rule from the other direction: a lane that knows the detail base knows the route.
export function stripTrailingParams(p) {
  const segments = p.split("/");
  while (segments.length > 1 && segments[segments.length - 1].startsWith(":")) segments.pop();
  return segments.join("/") || "/";
}
const laneKnows = (r) => laneByPath.has(r.normalizedPath) || laneByPath.has(stripTrailingParams(r.normalizedPath));

const gaps = {
  // Lane configs enumerate dashboard URLs, so a parameterised detail screen
  // absent from them may still be covered by click-through navigation. Split the
  // two: a missing dashboard entry is a real hole, a missing detail entry is a lead.
  dashboardsUnknownToLanes: screens.filter((r) => !laneKnows(r) && !r.path.includes(":"))
    .map((r) => ({ path: r.path, component: r.component, accessGroups: r.accessGroups })),
  detailScreensUnknownToLanes: screens.filter((r) => !laneKnows(r) && r.path.includes(":"))
    .map((r) => ({ path: r.path, component: r.component, accessGroups: r.accessGroups })),
  // `/` is a lane convenience constant satisfied by a <Redirect>, which this
  // extractor does not parse — excluded rather than reported as dead.
  laneRoutesNotInApp: uniq(laneRoutes
    .filter((lr) => lr.normalizedPath !== "/" && !declaredPaths.has(lr.normalizedPath) && !satisfiedByParamRoute(lr.normalizedPath))
    .map((lr) => `${lr.lane}:${lr.path}`)),
  guardedRoutesWithoutAccessGroup: screens.filter((r) => r.guard !== "Route" && r.accessGroups.length === 0).map((r) => r.path),
  frontendEndpointsNotInBackend: frontendEndpoints.filter((e) => !backendPaths.has(e.normalizedPath)).map((e) => e.constant),
  screensWithUnreadableComponent: screens.filter((r) => r.componentSource && !r.componentFile).map((r) => r.path),
  screensReachingNoEndpoint: screens.filter((r) => r.componentFile && r.endpoints.length === 0).map((r) => r.path),
  // Per-screen version of the endpoint gap: this screen calls it, backend
  // automation has never heard of it.
  screenEndpointsMissingBackendCoverage: screens
    .map((r) => ({ path: r.path, endpoints: r.endpoints.filter((e) => !e.backendEndpoint).map((e) => e.constant) }))
    .filter((r) => r.endpoints.length > 0),
  backendEndpointsNotInFrontend: backendEndpoints.filter((e) => !frontendPaths.has(e.normalizedPath)).map((e) => e.name),
};

const structure = {
  schema: "fhf-harness/app-structure/v1",
  generatedAt: new Date().toISOString(),
  appRoot,
  counts: {
    routeConstants: routeByKey.size,
    mountedRoutes: routes.length,
    screens: screens.length,
    containerRoutes: routes.filter((r) => r.isContainer).length,
    unmountedConstants: unmountedConstants.length,
    unresolved: unresolved.length,
    accessGroupBindings: uniq(routes.flatMap((r) => r.accessGroups)).length,
    components: uniq(routes.map((r) => r.component).filter(Boolean)).length,
    frontendEndpoints: frontendEndpoints.length,
    backendEndpoints: backendEndpoints.length,
    laneRoutePaths: uniq(laneRoutes.map((lr) => lr.normalizedPath)).length,
    sourceFilesParsed: moduleGraph.size,
    screenEndpointEdges: screens.reduce((n, r) => n + r.endpoints.length, 0),
    screenEndpointEdgesModuleConfidence: screens.reduce((n, r) => n + r.endpoints.filter((e) => e.confidence === "module").length, 0),
    screensWithEndpoints: screens.filter((r) => r.endpoints.length > 0).length,
    endpointsReachedFromSomeScreen: uniq(screens.flatMap((r) => r.endpoints.map((e) => e.constant))).length,
  },
  nodes: { routes, unmountedConstants, unresolved, frontendEndpoints, backendEndpoints, laneRoutes },
  gaps,
};

if (process.argv.includes("--selftest")) {
  const a = (cond, msg) => { if (!cond) { console.error(`FAIL ${msg}`); process.exitCode = 1; } };

  const fixture = `
export const lossMitigationRoute = { ROOT: 'loss-mitigation', REPO: 'repo' };
export const lmRoutes = {
  LM_REPO: \`/\${lossMitigationRoute.ROOT}/\${lossMitigationRoute.REPO}\`,
  LM_DETAIL: \`/\${lossMitigationRoute.ROOT}/details/:id\`,
};
`;
  const resolved = resolveTemplates(collectConstants(fixture));
  a(resolved.get("lmRoutes.LM_REPO") === "/loss-mitigation/repo", `template chain unresolved: ${resolved.get("lmRoutes.LM_REPO")}`);
  a(resolved.get("lmRoutes.LM_DETAIL") === "/loss-mitigation/details/:id", "param path mangled");
  a(normalize("/a/details/:applicationId") === normalize("/a/details/:id"), "param normalization asymmetric");

  const jsx = `
      <DashboardsSecureRoute
        allowedGroups={dashboardAccessGroups.ANCILLARY.PRIMARY}
        key={routes.ANCILLARY_NOT_FILED}
        path={routes.ANCILLARY_NOT_FILED}
        component={AncillaryNotFiled}
      />
      <Route path={routes.LOGIN} component={Login} />
      <Route path='/literal' component={Lit} exact />
      <DashboardsSecureRoute
        allowedGroups={[accessGroups.COLLECTION_CALL_LOG_WRITE, accessGroups.SERVICING_CALL_LOG_WRITE]}
        path={routes.CALL_LOG_PAYMENT}
        component={PaymentLayoutWrapper}
      />
      <Redirect from={routes.OLD} to={routes.NEW} />
`;
  const els = parseRouteElements(jsx);
  a(els.length === 4, `route element count ${els.length} (Redirect must not count)`);
  a(els[3].accessGroups.length === 2 && els[3].accessGroups[0] === "COLLECTION_CALL_LOG_WRITE", `flat accessGroups array missed: ${els[3].accessGroups}`);
  a(els[0].accessGroups[0] === "ANCILLARY.PRIMARY" && els[0].component === "AncillaryNotFiled", "guarded route attrs missed");
  a(els[1].accessGroups.length === 0 && els[1].guard === "Route", "unguarded route misclassified");
  a(els[2].literalPath === "/literal" && els[2].exact === true, "literal path / exact flag missed");

  a(structure.counts.mountedRoutes > 0, "no mounted routes found — app route files moved?");
  a(structure.counts.containerRoutes > 0, "container detection found no nested routers");
  a(structure.counts.screens < structure.counts.mountedRoutes, "screens must exclude containers");
  a(!gaps.dashboardsUnknownToLanes.some((r) => r.path === "/titles"), "container route leaked into coverage gap");
  a(isSatisfiedByParamRoute("/titles/release/details", ["/titles/release/details/:param"]), "param-tail match failed");
  a(!isSatisfiedByParamRoute("/post-funding", ["/post-funding/summary"]), "extra literal segment must not match");
  a(stripTrailingParams("/a/details/:param") === "/a/details", "trailing param strip wrong");
  a(stripTrailingParams("/a/b") === "/a/b", "strip mangled param-free path");
  a(structure.counts.frontendEndpoints > 0, "no frontend endpoint constants extracted");
  a(structure.counts.laneRoutePaths > 0, "no lane route config paths extracted");
  // Route/endpoint paths legitimately contain param names like `lockToken=:lockToken`;
  // what must never appear is a literal secret value.
  a(!/(password|secret|api[_-]?key|bearer)\s*[:=]\s*["']?[A-Za-z0-9+/_-]{8,}/i.test(JSON.stringify(structure)), "possible credential in output");

  if (!process.exitCode) console.log("selftest ok");
  process.exit(process.exitCode ?? 0);
}

const outDir = path.resolve(consumerRoot, paths.evidenceDir);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "app-structure.json"), `${JSON.stringify(structure, null, 2)}\n`);

const c = structure.counts;
const list = (xs, n = 12) => (xs.length === 0 ? "_none_" : xs.slice(0, n).map((x) => `\`${typeof x === "string" ? x : x.path}\``).join(", ") + (xs.length > n ? ` … +${xs.length - n}` : ""));
const report = `# Application Structure — extracted from source

Generated ${structure.generatedAt} from \`${paths.applicationRoot}\`. Derived, not authored: rerun after any pull.

| Node | Count |
|---|---|
| Route constants declared | ${c.routeConstants} |
| Routes actually mounted | ${c.mountedRoutes} |
| — of those, openable screens | ${c.screens} |
| — of those, nested-router containers | ${c.containerRoutes} |
| Route constants never mounted | ${c.unmountedConstants} |
| Page components mounted | ${c.components} |
| Distinct Okta access-group bindings | ${c.accessGroupBindings} |
| Frontend API endpoint constants | ${c.frontendEndpoints} |
| Backend automation endpoints | ${c.backendEndpoints} |
| Route paths known to Cypress lane configs | ${c.laneRoutePaths} |
| Source files parsed for the import graph | ${c.sourceFilesParsed} |
| Screen → endpoint edges | ${c.screenEndpointEdges} |
| — call site inside the screen's own feature module | ${c.screenEndpointEdgesModuleConfidence} |
| — call site in a module the screen imports | ${c.screenEndpointEdges - c.screenEndpointEdgesModuleConfidence} |
| Screens with at least one endpoint | ${c.screensWithEndpoints} of ${c.screens} |
| Distinct endpoints reached from some screen | ${c.endpointsReachedFromSomeScreen} of ${c.frontendEndpoints} |
| Route paths unresolvable by static read | ${c.unresolved} |

## Gaps

**Dashboards no Cypress lane config knows about — ${gaps.dashboardsUnknownToLanes.length}**
${list(gaps.dashboardsUnknownToLanes)}

**Detail screens no lane config names — ${gaps.detailScreensUnknownToLanes.length}** (may be covered by click-through)
${list(gaps.detailScreensUnknownToLanes)}

**Lane config paths that no longer exist in the app — ${gaps.laneRoutesNotInApp.length}**
${list(gaps.laneRoutesNotInApp)}

**Guarded routes with no access group declared — ${gaps.guardedRoutesWithoutAccessGroup.length}**
${list(gaps.guardedRoutesWithoutAccessGroup)}

**Frontend endpoints absent from backend automation — ${gaps.frontendEndpointsNotInBackend.length} of ${c.frontendEndpoints}**
${list(gaps.frontendEndpointsNotInBackend, 8)}

**Backend automation endpoints the frontend never calls — ${gaps.backendEndpointsNotInFrontend.length} of ${c.backendEndpoints}**
${list(gaps.backendEndpointsNotInFrontend, 8)}

**Screens whose component file could not be resolved — ${gaps.screensWithUnreadableComponent.length}**
${list(gaps.screensWithUnreadableComponent)}

**Screens reaching no endpoint at all — ${gaps.screensReachingNoEndpoint.length}** (static screens, or a traversal miss)
${list(gaps.screensReachingNoEndpoint)}

**Screens calling endpoints absent from backend automation — ${gaps.screenEndpointsMissingBackendCoverage.length} screens**
${gaps.screenEndpointsMissingBackendCoverage.slice(0, 10).map((r) => `- \`${r.path}\` → ${r.endpoints.length} endpoint(s): ${r.endpoints.slice(0, 4).map((e) => `\`${e}\``).join(", ")}${r.endpoints.length > 4 ? " …" : ""}`).join("\n")}

## Parse coverage

${c.unresolved} route element(s) could not be resolved statically and are absent from every
list above. Treat the gaps as a floor, not a census, until this reaches zero.
${structure.nodes.unresolved.slice(0, 10).map((u) => `- \`${u.mountedIn}\` → \`routes.${u.routeKey}\` (${u.reason})`).join("\n")}
`;
fs.writeFileSync(path.join(outDir, "app-structure.md"), report);
console.log(report);
