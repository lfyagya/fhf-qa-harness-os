#!/usr/bin/env node
// PreToolUse:Task and SubagentStart.
// genericAgents (general-purpose, explore, and the Cursor aliases) start inside
// the one sprint task. The hook states that scope and exits 0.
// Retired names in forbiddenAgents still exit 2. SubagentStart cannot stop a
// spawn, so a retired name is a warning there.
import { readFileSync } from "fs";
import { engineeringConfig, loadHarnessConfig } from "./lib/harness-config.mjs";
import { enforceWorkspaceReady } from "./lib/workspace-contract.mjs";
import { emitScopedAllow } from "./lib/hook-runtime.mjs";
import { describeTaskScope } from "./lib/task-scope.mjs";

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
const GENERIC = new Set((harness.genericAgents ?? []).map((name) => canonicalAgent(name)));
const FORBIDDEN = (harness.forbiddenAgents ?? []).map((name) => canonicalAgent(name));

if (FORBIDDEN.includes(subagentType)) {
  const verb = isSubagentStart
    ? `WARNING: agent "${subagentType}" is retired — spawned via Workflow, so this hook cannot block it (SubagentStart is non-blocking). Flagging only.`
    : `BLOCKED: agent "${subagentType}" is retired.`;
  console.error(verb);
  console.error(
    `"${subagentType}" no longer exists. Use cypress-generator, cypress-gate, cypress-debugger, cypress-shipper, or qa-automation-generator — see rules/agent-spawning-gate.md.`,
  );
  process.exit(2);
}

if (GENERIC.has(subagentType)) {
  const config = loadHarnessConfig();
  const scope = describeTaskScope(config, process.env, payload.cwd ?? process.cwd());
  console.error(scope);
  emitScopedAllow(payload, scope);
}

process.exit(0);
