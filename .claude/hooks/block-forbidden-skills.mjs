#!/usr/bin/env node
// PreToolUse:Skill — allow only skills listed in engineering.harness.skills.
// exit 2 = BLOCK the Skill invocation.
import { readFileSync } from "fs";
import { engineeringConfig } from "./lib/harness-config.mjs";

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const skill = String(payload.tool_input?.skill ?? "").toLowerCase();
if (!skill) process.exit(0);

const allowed = new Set(engineeringConfig().harness.skills.map((s) => s.toLowerCase()));
if (allowed.has(skill)) process.exit(0);

console.error(`BLOCKED: skill "${skill}" is not in the FHF allowlist.`);
console.error(`Allowed: ${[...allowed].join(", ")}`);
console.error("See .claude/rules/agent-spawning-gate.md for the routing roster.");
process.exit(2);
