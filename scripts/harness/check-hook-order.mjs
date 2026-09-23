#!/usr/bin/env node
// ADR-0041. Hook order is a static property of the control plane, checked here rather than
// by another runtime hook. One class list, one classification map, and the same phase order
// the adapters emit. A hook may not run before a hook of an earlier class on a shared tool.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hookChains } from "./loader-templates.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "qa-control-plane.json"), "utf8"));
const order = config.engineering?.harness?.hookOrder ?? {};
const classes = order.classes ?? [];
const classified = order.hooks ?? {};
const rank = new Map(classes.map((name, index) => [name, index]));
const declared = config.engineering?.harness?.hooks ?? {};
const issues = [];

const scripts = [...new Set(Object.values(declared).flatMap((list) => list ?? []))];
for (const script of scripts) {
  const hookClass = classified[script];
  if (!rank.has(hookClass)) {
    issues.push(`${script} has no hookOrder class`);
  }
}
for (const script of Object.keys(classified)) {
  if (!scripts.includes(script)) issues.push(`${script} is classified but not declared in engineering.harness.hooks`);
}
if (JSON.stringify(classes) !== JSON.stringify(["boundary", "scope", "roster", "content", "ergonomic"])) {
  issues.push("hookOrder.classes must stay boundary, scope, roster, content, ergonomic");
}

function inversions(lane) {
  const found = [];
  const byTool = new Map();
  for (const chain of hookChains(lane)) {
    for (const tool of chain.tools) {
      const list = byTool.get(tool) ?? [];
      for (const script of chain.scripts) list.push({ script, phase: chain.phase });
      byTool.set(tool, list);
    }
  }
  for (const [tool, list] of byTool) {
    let previous = null;
    for (const item of list) {
      const hookClass = classified[item.script];
      if (previous && rank.has(hookClass) && rank.get(hookClass) < rank.get(previous.hookClass)) {
        found.push(
          `${lane} ${tool}: ${previous.script} (${previous.hookClass}) runs before ${item.script} (${hookClass})`,
        );
      }
      previous = { ...item, hookClass };
    }
  }
  return found;
}

for (const lane of ["root", "e2e"]) issues.push(...inversions(lane));

if (issues.length) {
  console.error(issues.join("\n"));
  process.exit(1);
}
console.log("Hook order matches the declared classes.");
