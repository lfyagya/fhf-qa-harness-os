#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG = path.join(ROOT, "config", "qa-control-plane.json");
const ROUTER = path.join(ROOT, ".claude", "hooks", "prompt-router.mjs");
const SKILL_HOOK = path.join(ROOT, ".claude", "hooks", "block-forbidden-skills.mjs");
const DRIFT = path.join(ROOT, "scripts", "harness", "check-loader-drift.mjs");

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
const ROUTED_SKILLS = Object.keys(SKILL_LANES);
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
};
const NEW_ROUTES = [
  {
    id: "ralph-loop",
    priority: 89,
    match: "\\b(ralph loop|ralph-loop)\\b",
    lanes: ["root"],
    invoke: { kind: "skill", name: "ralph-loop" },
    hint: "Ralph loop → stay in parent and read the ralph-loop skill. Bound the request to engineering.loops. Do not start an unbounded retry. Root lane only.",
  },
  {
    id: "claude-md-improver",
    priority: 88,
    match: "\\b(claude-?md(?:-improver)?|audit CLAUDE\\.md|improve CLAUDE\\.md)\\b",
    lanes: ["root"],
    invoke: { kind: "skill", name: "claude-md-improver" },
    hint: "CLAUDE.md audit → stay in parent and read the claude-md-improver skill. Engine CLAUDE.md only. Do not edit generated consumer pointers. Root lane only.",
  },
  {
    id: "hookify",
    priority: 87,
    match: "\\b(hookify|create a hookify rule|write a hook rule|configure hookify)\\b",
    lanes: ["root"],
    invoke: { kind: "skill", name: "hookify" },
    hint: "Hookify → stay in parent and read the hookify skill. Draft one hook-rule proposal. Do not edit hooks or the control plane. Root lane only. ADR required to land a hook.",
  },
  {
    id: "ponytail-review",
    priority: 87,
    match: "\\b(ponytail(?:-(?:review|audit|help))?|over-?engineering review)\\b",
    lanes: ["root"],
    invoke: { kind: "skill", name: "ponytail-review" },
    hint: "Ponytail → stay in parent and read the ponytail-review skill. Read-only review of harness-os engine code. Do not edit application source or consumer tests. Root lane only.",
  },
  {
    id: "skill-creator",
    priority: 87,
    match: "\\b(skill-?creator|create a (new )?skill|author a skill)\\b",
    lanes: ["root"],
    invoke: { kind: "skill", name: "skill-creator" },
    hint: "Skill creator → stay in parent and read the skill-creator skill. Draft an ADR-0022 proposal. Do not write consumer skills or add an allow-list name. Root lane only.",
  },
];

function readNormalized(file) {
  const raw = fs.readFileSync(file, "utf8");
  return { text: raw.replace(/\r\n/g, "\n"), eol: raw.includes("\r\n") ? "\r\n" : "\n" };
}

function writeNormalized(file, text, eol) {
  fs.writeFileSync(file, eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text);
}

function patchFile(file, { already, needle, replacement, label }) {
  const { text, eol } = readNormalized(file);
  if (already(text)) {
    console.log(`${label}: already applied`);
    return;
  }
  if (!text.includes(needle)) {
    throw new Error(`${label}: patch site not found in ${path.relative(ROOT, file)}`);
  }
  writeNormalized(file, text.replace(needle, replacement), eol);
  console.log(`${label}: patched`);
}

if (process.env.FHF_ALLOW_HARNESS_EDIT !== "1") {
  throw new Error("Set FHF_ALLOW_HARNESS_EDIT=1 to apply ADR-0029 (writes control plane and hooks).");
}

const config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
const harness = config.engineering.harness;
const routes = config.engineering.context.routes;
harness.spawnBudget = SPAWN_BUDGET;
harness.modelTiers = MODEL_TIERS;
harness.skillInvocation = SKILL_INVOCATION;
harness.skillLanes = SKILL_LANES;
harness.skills = [...new Set([...harness.skills, ...ROUTED_SKILLS])];
for (const route of routes) {
  if (ROUTE_INVOKE[route.id]) route.invoke = ROUTE_INVOKE[route.id];
}
for (const route of NEW_ROUTES) {
  const index = routes.findIndex((entry) => entry.id === route.id);
  if (index === -1) routes.push(route);
  else routes[index] = { ...routes[index], ...route };
}
const missing = routes.filter((route) => !route.invoke).map((route) => route.id);
if (missing.length) throw new Error(`Routes missing invoke: ${missing.join(", ")}`);
fs.writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);

patchFile(ROUTER, {
  label: "prompt-router.mjs",
  already: (text) => text.includes("[router] invoke:"),
  needle: `function appendRoute(route) {
  lines.push(\`[router:\${route.id}] \${route.hint}\`);
  if (Array.isArray(route.sourceBundles) && route.sourceBundles.length > 0) {
    lines.push(\`[router] Source bundle seed: \${route.sourceBundles.join(", ")}. Expand only with a recorded topology reason.\`);
  }
}`,
  replacement: `function formatInvoke(invoke) {
  if (!invoke || typeof invoke !== "object") return "stay in parent";
  const parts = [];
  if (invoke.kind === "agent" && invoke.name) parts.push(\`spawn agent \${invoke.name}\`);
  else if (invoke.kind === "skill" && invoke.name) parts.push(\`stay in parent; read skill \${invoke.name}\`);
  else parts.push("stay in parent");
  if (invoke.prefer?.kind === "skill" && invoke.prefer.name) {
    parts.push(\`prefer skill \${invoke.prefer.name} when \${invoke.prefer.when ?? "applicable"}\`);
  }
  return parts.join("; ");
}

function appendRoute(route) {
  lines.push(\`[router:\${route.id}] \${route.hint}\`);
  if (route.invoke) lines.push(\`[router] invoke: \${formatInvoke(route.invoke)}\`);
  if (Array.isArray(route.sourceBundles) && route.sourceBundles.length > 0) {
    lines.push(\`[router] Source bundle seed: \${route.sourceBundles.join(", ")}. Expand only with a recorded topology reason.\`);
  }
}`,
});

patchFile(SKILL_HOOK, {
  label: "block-forbidden-skills.mjs",
  already: (text) => text.includes("skillLanes"),
  needle: `const allowed = new Set(engineeringConfig().harness.skills.map((s) => s.toLowerCase()));
if (allowed.has(skill)) process.exit(0);

console.error(\`BLOCKED: skill "\${skill}" is not in the FHF allowlist.\`);
console.error(\`Allowed: \${[...allowed].join(", ")}\`);
console.error("See .claude/rules/agent-spawning-gate.md for the routing roster.");
process.exit(2);`,
  replacement: `const harness = engineeringConfig().harness;
const allowed = new Set(harness.skills.map((s) => s.toLowerCase()));
if (!allowed.has(skill)) {
  console.error(\`BLOCKED: skill "\${skill}" is not in the FHF allowlist.\`);
  console.error(\`Allowed: \${[...allowed].join(", ")}\`);
  console.error("See .claude/rules/agent-spawning-gate.md for the routing roster.");
  process.exit(2);
}
const { detectLane } = await import("./lib/harness-config.mjs");
const lanes = harness.skillLanes?.[skill] ?? harness.skillLanes?.[payload.tool_input?.skill];
if (Array.isArray(lanes) && lanes.length > 0) {
  const lane = detectLane(payload.cwd ?? process.cwd());
  if (!lanes.includes(lane)) {
    console.error(\`BLOCKED: skill "\${skill}" is routed only for lanes: \${lanes.join(", ")} (current: \${lane}).\`);
    process.exit(2);
  }
}
process.exit(0);`,
});

patchFile(DRIFT, {
  label: "check-loader-drift.mjs",
  already: (text) => text.includes("parentAgents,"),
  needle: "  geminiInstructions,\n  parentCopilotInstructions,",
  replacement: "  geminiInstructions,\n  parentAgents,\n  parentCopilotInstructions,",
});

console.log(`Updated control plane. Routes: ${routes.length}. Skills: ${harness.skills.join(", ")}`);
