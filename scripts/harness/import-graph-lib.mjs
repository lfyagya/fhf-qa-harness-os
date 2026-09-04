// Import-graph traversal for the component → service → endpoint hop.
//
// This is the one hop in the app's chain with no declarative source: React has
// no construct linking a page to the API calls it makes, so the import graph is
// the only evidence. Two things make naive traversal wrong, and both are handled
// here explicitly:
//
//   1. Barrels. `export * from './x'` re-export files mean following every edge
//      out of `services/common` would attribute every endpoint in the app to
//      every component importing anything from it. Named imports are narrowed to
//      the file that actually defines the name.
//   2. Shared components. A page reaching an endpoint only through
//      `components/common` is weaker evidence than one whose own module does the
//      call, so every result carries the import chain that produced it and a
//      confidence derived from that chain.
//
// ponytail: regex module parsing, file-level attribution. An endpoint referenced
// anywhere in a reached file is attributed to the reaching component, even if the
// specific imported symbol never calls it. That over-approximates within a file
// and is the accepted granularity — per-symbol dataflow is a different tool.
// The fix if it ever matters is ts-morph, not a better regex.

import fs from "node:fs";
import path from "node:path";

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const ENDPOINT_REF = /\b([a-zA-Z][A-Za-z0-9]*Endpoints)\.([A-Z0-9_]+)\b/g;

// Vite owns the alias map; read it rather than restating it here.
export function parseAliases(viteConfigText, appRoot) {
  const block = viteConfigText.match(/alias:\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
  const aliases = new Map();
  for (const m of block.matchAll(/['"]?([@A-Za-z0-9_-]+)['"]?\s*:\s*path\.resolve\(__dirname,\s*['"]\.\/([^'"]+)['"]\)/g)) {
    aliases.set(m[1], path.join(appRoot, m[2]));
  }
  return aliases;
}

export function parseModule(text) {
  const imports = [];
  // `import X from 'y'`, `import { a, b as c } from 'y'`, `import * as ns from 'y'`,
  // `import D, { a } from 'y'`, and bare `import 'y'`.
  // The clause may span lines but never crosses a statement end or a quote —
  // without that guard a bare `import 'z'` swallows the next statement's `from`.
  for (const m of text.matchAll(/import\s+(?:([^;'"]*?)\s+from\s+)?['"]([^'"]+)['"]/g)) {
    const [, clause, specifier] = m;
    if (!clause) { imports.push({ specifier, names: [], kind: "side-effect" }); continue; }
    if (/^\*\s+as\s+/.test(clause.trim())) { imports.push({ specifier, names: [], kind: "namespace" }); continue; }
    const named = clause.match(/\{([\s\S]*?)\}/)?.[1] ?? "";
    const names = named.split(",").map((n) => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    const hasDefault = /^\s*[A-Za-z0-9_$]+\s*(?:,|$)/.test(clause.replace(/\{[\s\S]*?\}/, ""));
    imports.push({ specifier, names, kind: hasDefault && names.length === 0 ? "default" : "named" });
  }

  const reexports = [];
  for (const m of text.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
    reexports.push({ specifier: m[1], names: null });
  }
  for (const m of text.matchAll(/export\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]/g)) {
    const names = m[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean);
    reexports.push({ specifier: m[2], names });
  }

  const localExports = new Set();
  // Type declarations count: `types/index.ts` is the app's largest barrel, and a
  // name it cannot account for is the difference between narrowing one edge and
  // widening into the entire type tree.
  for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:const|let|var|function|class|async\s+function|interface|type|enum)\s+([A-Za-z0-9_$]+)/g)) {
    localExports.add(m[1]);
  }
  for (const m of text.matchAll(/export\s+\{([^}]*)\}\s*;?\s*(?!from)/g)) {
    for (const n of m[1].split(",")) {
      const name = n.trim().split(/\s+as\s+/).pop().trim();
      if (name) localExports.add(name);
    }
  }

  // A file that exports the endpoint map is DEFINING those endpoints, not calling
  // them. constants/network.js cross-references its own maps and is imported by
  // ~185 files, so counting its refs as call sites attributes nearly every
  // endpoint in the app to nearly every screen.
  const endpointRefs = new Set(
    [...text.matchAll(ENDPOINT_REF)]
      .filter((m) => !localExports.has(m[1]))
      .map((m) => `${m[1]}.${m[2]}`),
  );

  return { imports, reexports, localExports, endpointRefs, isBarrel: reexports.length > 0 };
}

export function makeResolver(aliases) {
  const asFile = (candidate) => {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    for (const ext of EXTENSIONS) {
      if (fs.existsSync(candidate + ext)) return candidate + ext;
    }
    for (const ext of EXTENSIONS) {
      const index = path.join(candidate, `index${ext}`);
      if (fs.existsSync(index)) return index;
    }
    return null;
  };

  return function resolve(specifier, fromFile) {
    if (specifier.startsWith(".")) return asFile(path.resolve(path.dirname(fromFile), specifier));
    const segments = specifier.split("/");
    const aliasRoot = aliases.get(segments[0]);
    if (!aliasRoot) return null; // node_modules or unmapped — not app source.
    return asFile(path.join(aliasRoot, ...segments.slice(1)));
  };
}

// Which file in a barrel actually provides `name`. Returns null when it cannot
// be pinned down, and the caller widens rather than silently dropping the edge.
function providersFor(name, parsed, file, resolve, graph) {
  if (parsed.localExports.has(name)) return [file];
  const explicit = parsed.reexports.filter((r) => r.names?.includes(name));
  if (explicit.length) return explicit.map((r) => resolve(r.specifier, file)).filter(Boolean);
  const wildcards = parsed.reexports.filter((r) => r.names === null).map((r) => resolve(r.specifier, file)).filter(Boolean);
  const owning = wildcards.filter((target) => graph.get(target)?.localExports.has(name));
  return owning.length ? owning : null;
}

// The screen's own feature module: `src/modules/<domain>/...` collapses to
// `src/modules/<domain>`, anything else to the file's own directory.
export function moduleRootOf(file) {
  const parts = file.split(path.sep);
  const i = parts.lastIndexOf("modules");
  return i >= 0 && parts.length > i + 1 ? parts.slice(0, i + 2).join(path.sep) : path.dirname(file);
}

/**
 * Endpoint constants a screen calls, bounded deliberately: files inside the
 * screen's own feature module are expanded, files outside it are leaves that
 * contribute their endpoints but not their imports.
 *
 * Transitive closure was tried first and is useless on this codebase — expanding
 * through shared components and hub barrels attributed ~200 endpoints to every
 * screen (14k edges, 477 of 490 endpoints "reachable" from something). The bound
 * is what makes the answer mean anything: "what this screen's own code and the
 * modules it imports actually call".
 *
 * `confidence` is "module" for a call site inside the feature module, "imported"
 * for one in a directly-imported module outside it.
 */
export function reachableEndpoints(graph, startFile, resolve, { maxDepth = 10 } = {}) {
  const moduleRoot = moduleRootOf(startFile);
  const inModule = (f) => f === moduleRoot || f.startsWith(moduleRoot + path.sep);
  const found = new Map();
  const unpinned = new Set();
  const unnarrowedBarrels = new Set();
  const seen = new Set([startFile]);
  let frontier = [{ file: startFile, names: null, chain: [startFile] }];

  for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
    const next = [];
    for (const node of frontier) {
      const parsed = graph.get(node.file);
      if (!parsed) continue;

      const confidence = inModule(node.file) ? "module" : "imported";
      for (const ref of parsed.endpointRefs) {
        const existing = found.get(ref);
        // Keep the strongest, then shortest, explanation for each endpoint.
        if (!existing || (existing.confidence === "imported" && confidence === "module")
          || (existing.confidence === confidence && node.chain.length < existing.chain.length)) {
          found.set(ref, { confidence, depth, chain: node.chain });
        }
      }

      // Leaf rule: a file outside the feature module contributes its endpoints
      // but not its imports. Without this, shared components and hub barrels
      // pull the whole app in behind them.
      //
      // A barrel is pure indirection rather than a call site, so it is still
      // traversed when the import names it — that resolves `{ Table } from
      // 'components/common'` to the one file defining Table. Entered without
      // names (namespace/default) it cannot be narrowed and is dropped, since
      // expanding it means the whole re-export tree.
      const isNarrowableBarrel = parsed.isBarrel && node.names?.length > 0;
      if (!inModule(node.file) && !isNarrowableBarrel) {
        if (parsed.isBarrel) unnarrowedBarrels.add(path.relative(moduleRoot, node.file));
        continue;
      }

      // A barrel entered by name contributes only the files defining those names.
      // Entered any other way (namespace, default, side-effect) it contributes
      // everything it re-exports.
      let edges = [
        ...parsed.imports,
        ...(node.names?.length ? [] : parsed.reexports.map((r) => ({ specifier: r.specifier, names: [], kind: "wildcard" }))),
      ];
      if (parsed.isBarrel && node.names?.length) {
        edges = [];
        for (const name of node.names) {
          const providers = providersFor(name, parsed, node.file, resolve, graph);
          if (providers) {
            for (const p of providers) edges.push({ specifier: null, resolved: p, names: [name], kind: "named" });
          } else {
            // Unpinnable name: drop the edge and count it. Widening through every
            // re-export instead turns one unknown into thousands of false edges.
            unpinned.add(`${path.basename(node.file)}:${name}`);
          }
        }
      }

      for (const edge of edges) {
        const target = edge.resolved ?? (edge.specifier ? resolve(edge.specifier, node.file) : null);
        if (!target || seen.has(target)) continue;
        seen.add(target);
        next.push({
          file: target,
          names: edge.kind === "named" ? edge.names : null,
          chain: [...node.chain, target],
        });
      }
    }
    frontier = next;
  }
  found.unpinnedNames = [...unpinned];
  found.unnarrowedBarrels = [...unnarrowedBarrels];
  return found;
}

export function buildGraph(rootDir, { ignore = ["node_modules", "__tests__", "mock", "dev"] } = {}) {
  const graph = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") || ignore.includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (EXTENSIONS.includes(path.extname(e.name))) graph.set(full, parseModule(fs.readFileSync(full, "utf8")));
    }
  };
  walk(rootDir);
  return graph;
}
