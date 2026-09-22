#!/usr/bin/env node
// PreToolUse:Task — block forbidden agent types (Explore, general-purpose, deleted agents).
// exit 2 = BLOCK the Task spawn.
//
// Also wired to SubagentStart (settings.json) to catch Workflow-tool-spawned agents, which
// bypass this same check under PreToolUse (matcher is Task-only; Workflow's internal agent()
// calls don't go through Task at all — see agent-spawning-gate.md). SubagentStart's real field
// is `agent_type` (confirmed via Claude Code docs 2026-07-24 — NOT `subagent_type`, which this
// script's fallback chain used to omit, meaning an earlier wiring attempt would have silently
// matched nothing forever). Verified via the same docs: SubagentStart is non-blocking — exit 2
// only "shows stderr to user", the subagent starts regardless. Don't claim BLOCKED when running
// under SubagentStart; say what actually happened.
import { readFileSync } from "fs";
import { engineeringConfig } from "./lib/harness-config.mjs";
import { enforceWorkspaceReady } from "./lib/workspace-contract.mjs";

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

enforceWorkspaceReady({ root: payload.cwd ?? process.cwd() });

const isSubagentStart = payload.hook_event_name === "SubagentStart";
function canonicalAgent(name) {
  const compact = String(name).toLowerCase().replace(/[_\s-]/g, "");
  if (compact === "generalpurpose") return "general-purpose";
  if (compact === "explore") return "explore";
  return String(name).toLowerCase();
}

const subagentType = canonicalAgent(
  payload.agent_type ??
  payload.tool_input?.subagent_type ??
  payload.tool_input?.subagentType ??
  payload.subagent_type ??
  payload.subagentType ??
  "",
);
const harness = engineeringConfig().harness;
const GENERIC = new Set(harness.genericAgents.map((name) => name.toLowerCase()));
const FORBIDDEN = harness.forbiddenAgents.map((name) => canonicalAgent(name));

for (const name of FORBIDDEN) {
  if (subagentType === name) {
    const verb = isSubagentStart
      ? `WARNING: agent "${name}" is forbidden by the FHF routing roster — spawned via Workflow, so this hook cannot block it (SubagentStart is non-blocking). Flagging only.`
      : `BLOCKED: agent "${name}" is forbidden.`;
    console.error(verb);
    if (GENERIC.has(name))
      console.error(
        "Use Grep/Glob/Read for lookups. See .claude/rules/agent-spawning-gate.md.",
      );
    else
      console.error(
        `"${name}" no longer exists. Use cypress-generator, cypress-gate, cypress-debugger, or cypress-shipper — see .claude/rules/agent-spawning-gate.md.`,
      );
    process.exit(2);
  }
}
process.exit(0);
