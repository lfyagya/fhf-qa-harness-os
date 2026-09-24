#!/usr/bin/env node
// PreToolUse:Task and SubagentStart — retired agent names stay blocked.
// general-purpose and explore (including generalPurpose and Explore) may start.
// They stay inside the one active task. Exit 0 allows the spawn. Exit 2 blocks a retired name.
// SubagentStart cannot stop a spawn; a retired name is a WARNING there.
import { readFileSync } from "fs";
import path from "node:path";
import { loadHarnessConfig } from "./lib/harness-config.mjs";
import { enforceWorkspaceReady } from "./lib/workspace-contract.mjs";
import { resolveActiveTask, taskRoot } from "./lib/task-protocol.mjs";

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  payload = {};
}

enforceWorkspaceReady({ root: payload.cwd ?? process.cwd() });

const isSubagentStart = payload.hook_event_name === "SubagentStart";
const rawType = String(
  payload.agent_type ??
  payload.tool_input?.subagent_type ??
  payload.tool_input?.subagentType ??
  payload.subagent_type ??
  payload.subagentType ??
  "",
);

function canonicalAgent(value) {
  const compact = String(value ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (compact === "generalpurpose") return "general-purpose";
  if (compact === "explore") return "explore";
  return String(value ?? "").toLowerCase();
}

const config = loadHarnessConfig();
const harness = config.engineering.harness;
const GENERIC = new Set(harness.genericAgents.map((name) => name.toLowerCase()));
const FORBIDDEN = harness.forbiddenAgents.map((name) => name.toLowerCase());
const subagentType = canonicalAgent(rawType);

function taskScope() {
  try {
    const root = taskRoot(payload);
    const resolved = resolveActiveTask({
      root,
      config,
      sessionId: payload.session_id ?? null,
    });
    if (resolved.file) {
      const focus = resolved.focus ?? {};
      const label = focus.id ?? focus.key ?? path.basename(resolved.file);
      return `TASK SCOPE: this subagent stays inside the active task ${label} (${resolved.file}). It does not create or switch a task. Writes and pytest still wait for the selected path and a non-production environment.`;
    }
    if (resolved.focus?.quick?.title) {
      return `TASK SCOPE: this subagent stays inside the quick task "${resolved.focus.quick.title}". It does not create or switch a task. Writes wait for the owner confirm.`;
    }
  } catch {
    // A missing task still allows the spawn. Writes remain gated elsewhere.
  }
  return "TASK SCOPE: this subagent stays inside the one active task for this session. It does not create or switch a task. Writes still wait until a task selects the path.";
}

function allowGeneric() {
  const context = taskScope();
  const event = isSubagentStart ? "SubagentStart" : "PreToolUse";
  const hookSpecificOutput = { hookEventName: event, additionalContext: context };
  if (!isSubagentStart) hookSpecificOutput.permissionDecision = "allow";
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput })}\n`);
  console.error(context);
  process.exit(0);
}

if (GENERIC.has(subagentType)) allowGeneric();

for (const name of FORBIDDEN) {
  if (subagentType === name) {
    const verb = isSubagentStart
      ? `WARNING: agent "${name}" is retired — spawned via Workflow, so this hook cannot block it (SubagentStart is non-blocking). Flagging only.`
      : `BLOCKED: agent "${name}" is retired.`;
    console.error(verb);
    console.error(
      `"${name}" no longer exists. Use cypress-generator, cypress-gate, cypress-debugger, cypress-shipper, or qa-automation-generator — see .claude/rules/agent-spawning-gate.md.`,
    );
    process.exit(2);
  }
}
process.exit(0);
