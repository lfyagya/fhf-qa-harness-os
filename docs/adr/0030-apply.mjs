#!/usr/bin/env node
// ADR-0030 check. The control plane is the policy. This script verifies the
// current decision: spawn budget, model tiers, skill lanes, route invoke,
// formatInvoke, and the bundle slice. It does not serialize the control plane.
// Usage: node docs/adr/0030-apply.mjs [--check]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG = path.join(ROOT, "config", "qa-control-plane.json");
const ROUTER = path.join(ROOT, ".claude", "hooks", "prompt-router.mjs");
const SKILL_HOOK = path.join(ROOT, ".claude", "hooks", "block-forbidden-skills.mjs");
const DRIFT = path.join(ROOT, "scripts", "harness", "check-loader-drift.mjs");
const checkOnly = process.argv.includes("--check");

const SPAWN_BUDGET = { maxSpecialists: 1, maxDepth: 1, concurrent: 1 };
const MODEL_TIERS = {
  default: "standard",
  unnamedSpecialist: "standard",
  frontier: {
    requiresAny: ["explicit-user-request", "verified-standard-insufficient"],
    allowedRouteIds: ["cloud-failure", "test-failure", "test-flake"],
  },
};
const SKILL_INVOCATION = {
  mode: "route-or-explicit",
  catalogListing: "allowlist-only",
  userScopePlugins: "route-mapped-only",
};
const SKILL_LANES = {
  hookify: ["root"],
  "ponytail-review": ["root"],
  "skill-creator": ["root"],
  "claude-md-improver": ["root"],
  "ralph-loop": ["root"],
};
const ROUTE_INVOKE = {
  "cross-layer-test-failure": { kind: "agent", name: "qa-automation-debugger" },
  "backend-test-failure": { kind: "agent", name: "qa-automation-debugger" },
  "cross-layer-test-generation": { kind: "agent", name: "qa-automation-generator" },
  "cross-layer-pre-merge": { kind: "agent", name: "qa-automation-gate" },
  "backend-pre-merge": { kind: "agent", name: "qa-automation-gate" },
  documentation: { kind: "parent" },
  "qa-control-plane": { kind: "parent" },
  "cypress-tap": { kind: "skill", name: "cypress-tap" },
  "cloud-failure": { kind: "agent", name: "cypress-debugger" },
  "test-failure": {
    kind: "agent",
    name: "cypress-debugger",
    prefer: { kind: "skill", name: "cypress-tap", when: "live-cypress-open-session" },
  },
  "test-flake": {
    kind: "agent",
    name: "cypress-debugger",
    prefer: { kind: "skill", name: "cypress-tap", when: "live-cypress-open-session" },
  },
  "cross-repository-change": { kind: "parent" },
  "work-item-intake": { kind: "parent" },
  "backend-test": { kind: "agent", name: "qa-automation-generator" },
  "legacy-migration": { kind: "agent", name: "cypress-generator" },
  "pre-merge": { kind: "agent", name: "cypress-gate" },
  "pull-request": { kind: "agent", name: "cypress-shipper" },
  "test-explanation": { kind: "skill", name: "cypress-explain" },
  "coverage-report": { kind: "agent", name: "cypress-shipper" },
  "new-test": { kind: "agent", name: "cypress-generator" },
  "api-interception": { kind: "parent" },
  "coverage-presence": { kind: "parent" },
  "full-chain": { kind: "parent" },
  planning: { kind: "parent" },
  "selector-gap": { kind: "parent" },
  "application-contract": { kind: "parent" },
  "product-question": { kind: "parent" },
  "oracle-change": { kind: "parent" },
  "agent-workflow": { kind: "parent" },
  "triage-night-brief": { kind: "parent" },
  "regression-sprint-records": { kind: "parent" },
  "ralph-loop": { kind: "skill", name: "ralph-loop" },
  "claude-md-improver": { kind: "skill", name: "claude-md-improver" },
  hookify: { kind: "skill", name: "hookify" },
  "ponytail-review": { kind: "skill", name: "ponytail-review" },
  "skill-creator": { kind: "skill", name: "skill-creator" },
};

function same(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function collect(config, router, skillHook, drift) {
  const issues = [];
  const harness = config.engineering?.harness ?? {};
  if (!same(harness.spawnBudget, SPAWN_BUDGET)) issues.push("engineering.harness.spawnBudget does not match ADR-0030");
  if (!same(harness.modelTiers, MODEL_TIERS)) issues.push("engineering.harness.modelTiers does not match ADR-0030");
  if (!same(harness.skillInvocation, SKILL_INVOCATION)) issues.push("engineering.harness.skillInvocation does not match ADR-0030");
  for (const [skill, lanes] of Object.entries(SKILL_LANES)) {
    if (!same(harness.skillLanes?.[skill], lanes)) issues.push(`skillLanes.${skill} is not ${JSON.stringify(lanes)}`);
    if (!Array.isArray(harness.skills) || !harness.skills.includes(skill)) issues.push(`skills allow-list is missing ${skill}`);
  }
  const routes = config.engineering?.context?.routes ?? [];
  for (const route of routes) {
    if (!route?.invoke || typeof route.invoke !== "object" || !route.invoke.kind) {
      issues.push(`route ${route?.id ?? "(missing id)"} has no invoke`);
    }
  }
  for (const [id, invoke] of Object.entries(ROUTE_INVOKE)) {
    const route = routes.find((item) => item.id === id);
    if (!route) issues.push(`route ${id} is missing`);
    else if (!same(route.invoke, invoke)) issues.push(`route ${id} invoke is not the ADR-0030 mapping`);
  }
  if (!router.includes("function formatInvoke") || !router.includes("[router] invoke:")) {
    issues.push("prompt-router.mjs is missing the current invoke emission");
  }
  if (!router.includes("formatBundleSlice")) {
    issues.push("prompt-router.mjs is missing the current bundle slice");
  }
  if (!skillHook.includes("skillLanes")) issues.push("block-forbidden-skills.mjs is missing skillLanes");
  if (!drift.includes("parentAgents")) issues.push("check-loader-drift.mjs is missing parentAgents");
  return issues;
}

const config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
const router = fs.readFileSync(ROUTER, "utf8");
const skillHook = fs.readFileSync(SKILL_HOOK, "utf8");
const drift = fs.readFileSync(DRIFT, "utf8");
const issues = collect(config, router, skillHook, drift);

if (issues.length === 0) {
  console.log(checkOnly ? "ADR-0030 check passed." : "ADR-0030 already applied.");
  process.exit(0);
}

for (const issue of issues) console.error(`- ${issue}`);
console.error("ADR-0030 policy drifted. Edit the control plane or the router, then re-run this check.");
console.error("This script does not rewrite the control plane; a full serialize would reorder it.");
process.exit(2);
