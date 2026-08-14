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

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  if (!process.argv.includes("--deny-matched-subagent")) process.exit(0);
}

const isSubagentStart = payload.hook_event_name === "SubagentStart";
const subagentType = String(
  payload.agent_type ??
  payload.tool_input?.subagent_type ??
    payload.subagent_type ??
    payload.subagentType ??
    "",
).toLowerCase();
const harness = engineeringConfig().harness;
const GENERIC = new Set(harness.genericAgents.map((name) => name.toLowerCase()));
const FORBIDDEN = harness.forbiddenAgents.map((name) => name.toLowerCase());

// Cursor's subagentStart matcher has already selected a forbidden type. Keep the
// roster in one place above while sharing this hook with Claude Code's Task event.
if (process.argv.includes("--deny-matched-subagent")) {
  console.error("BLOCKED: this subagent type is forbidden by the FHF routing roster.");
  process.exit(2);
}

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
