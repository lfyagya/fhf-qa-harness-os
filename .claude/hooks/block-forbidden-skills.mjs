#!/usr/bin/env node
// PreToolUse:Skill — allow only skills listed in engineering.harness.skills.
// exit 2 = BLOCK the Skill invocation.
import { readFileSync } from "fs";
import { engineeringConfig } from "./lib/harness-config.mjs";
import { enforceWorkspaceReady } from "./lib/workspace-contract.mjs";

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const skill = String(payload.tool_input?.skill ?? "").toLowerCase();
if (!skill) process.exit(0);

enforceWorkspaceReady({ root: payload.cwd ?? process.cwd() });

const harness = engineeringConfig().harness;
const allowed = new Set(harness.skills.map((s) => s.toLowerCase()));
if (!allowed.has(skill)) {
  console.error(`BLOCKED: skill "${skill}" is not in the FHF allowlist.`);
  console.error(`Allowed: ${[...allowed].join(", ")}`);
  console.error("See .claude/rules/agent-spawning-gate.md for the routing roster.");
  process.exit(2);
}
const { detectLane } = await import("./lib/harness-config.mjs");
const lanes = harness.skillLanes?.[skill] ?? harness.skillLanes?.[payload.tool_input?.skill];
if (Array.isArray(lanes) && lanes.length > 0) {
  const lane = detectLane(payload.cwd ?? process.cwd());
  if (!lanes.includes(lane)) {
    console.error(`BLOCKED: skill "${skill}" is routed only for lanes: ${lanes.join(", ")} (current: ${lane}).`);
    process.exit(2);
  }
}
process.exit(0);
