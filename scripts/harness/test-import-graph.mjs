// Fixture-based checks for the component → service → endpoint traversal.
// The barrel-narrowing case is the one that matters: without it every component
// that imports anything from services/common inherits every endpoint in the app.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildGraph, makeResolver, parseAliases, parseModule, reachableEndpoints } from "./import-graph-lib.mjs";

let failures = 0;
const check = (cond, msg) => {
  if (!cond) { console.error(`FAIL ${msg}`); failures += 1; }
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fhf-import-graph-"));
const src = path.join(root, "src");
const write = (rel, text) => {
  const full = path.join(src, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
};

// A page whose own module calls one endpoint, and which also pulls a single
// named helper out of a shared barrel that re-exports two unrelated services.
const page = write("modules/titles/RemarketingTitles.tsx", `
import React from 'react';
import { useRows } from './hooks/useRows';
import { formatMoney } from 'services/common';
export const RemarketingTitles = () => null;
`);
write("modules/titles/hooks/useRows.ts", `
import { networkEndpoints } from 'constants/network';
export const useRows = () => networkEndpoints.GET_REMARKETING_ROWS;
`);
write("services/common/index.ts", `
export * from './money';
export * from './unrelated';
`);
write("services/common/money.ts", `
export const formatMoney = (n) => n;
`);
write("services/common/unrelated.ts", `
import { networkEndpoints } from 'constants/network';
export const unrelatedCall = () => networkEndpoints.SHOULD_NOT_BE_ATTRIBUTED;
`);
// Cycle: two files importing each other must not hang the walk.
write("modules/titles/a.ts", `import { b } from './b';\nexport const a = b;\n`);
write("modules/titles/b.ts", `import { a } from './a';\nexport const b = a;\n`);
write("constants/network.js", `export const networkEndpoints = { GET_REMARKETING_ROWS: 'x' };\n`);

const aliases = parseAliases(`
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      services: path.resolve(__dirname, './src/services'),
      constants: path.resolve(__dirname, './src/constants'),
      modules: path.resolve(__dirname, './src/modules'),
    },
  }
`, root);
check(aliases.get("services") === path.join(root, "src/services"), "alias map not parsed from vite config");
check(aliases.size === 4, `alias count ${aliases.size}`);

const resolve = makeResolver(aliases);
check(resolve("services/common", page) === path.join(src, "services/common/index.ts"), "barrel index not resolved");
check(resolve("./hooks/useRows", page) === path.join(src, "modules/titles/hooks/useRows.ts"), "relative import not resolved");
check(resolve("react", page) === null, "node_modules specifier must not resolve");

const graph = buildGraph(src);
const found = reachableEndpoints(graph, page, resolve);

check(found.has("networkEndpoints.GET_REMARKETING_ROWS"), "own-module endpoint not reached");
check(
  !found.has("networkEndpoints.SHOULD_NOT_BE_ATTRIBUTED"),
  "barrel leaked an unrelated service's endpoint — named narrowing broken",
);
check(found.get("networkEndpoints.GET_REMARKETING_ROWS")?.confidence === "module", "own-module reach should be module confidence");

// Same barrel entered without a name list (namespace import) must widen, and say so.
const broadPage = write("modules/titles/Broad.tsx", `import * as common from 'services/common';\n`);
const broadGraph = buildGraph(src);
const broadFound = reachableEndpoints(broadGraph, broadPage, resolve);
// A barrel entered without names cannot be narrowed, so it is dropped rather
// than expanded — expanding it is what collapses the graph.
check(!broadFound.has("networkEndpoints.SHOULD_NOT_BE_ATTRIBUTED"), "namespace barrel import must not widen");
check(broadFound.unnarrowedBarrels.length === 1, `unnarrowed barrel not recorded: ${broadFound.unnarrowedBarrels}`);

const cycleFound = reachableEndpoints(broadGraph, path.join(src, "modules/titles/a.ts"), resolve);
check(cycleFound.size === 0, "cycle fixture should reach no endpoints");

const parsed = parseModule(`
import D, { a, b as c } from 'x';
import * as ns from 'y';
import 'z';
export { helper } from './h';
export const local = 1;
`);
check(parsed.imports.length === 3, `import count ${parsed.imports.length}`);
check(parsed.imports[0].names.join(",") === "a,b", "named imports with alias not read");
check(parsed.imports[1].kind === "namespace" && parsed.imports[2].kind === "side-effect", "import kinds misread");
check(parsed.isBarrel === true && parsed.localExports.has("local"), "reexport/localExport detection wrong");

fs.rmSync(root, { recursive: true, force: true });

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log("import-graph tests ok");
