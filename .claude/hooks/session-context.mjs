#!/usr/bin/env node
// SessionStart — inject the tool-neutral harness contract and a fresh durable handoff.
import { readFileSync } from "node:fs";
import { loadHarnessConfig, detectLane } from "./lib/harness-config.mjs";
import { emitContext } from "./lib/hook-runtime.mjs";
import { readFreshHandoff } from "./lib/memory-state.mjs";
import { formatWorkspacePreflight, workspacePreflight } from "./lib/workspace-contract.mjs";

let payload = {};
try { payload = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }

const config = loadHarnessConfig();
const { context, memory, harness, loops } = config.engineering;
const lane = detectLane(payload.cwd ?? process.cwd(), config);
const workspace = workspacePreflight({ root: payload.cwd ?? process.cwd(), config });
const handoff = readFreshHandoff(payload, memory);
const lines = [
  "[fhf-harness] Tool-neutral runtime contract:",
  `- Authority: .claude/harness.config.json; context mode=${context.mode}; lane=${lane}.`,
  "- For each prompt, evaluate engineering.context.routes by highest priority; task intent breaks ties.",
  "- Task protocol: do not plan or author tests until grounding.intentVsBuilt is classified; node .harness/task-protocol.mjs next is the next action.",
  `- Session scope=${memory.sessionScope}; preserve only configured exact facts in ${memory.handoffFile}.`,
  `- Application source boundary=${harness.boundaries.applicationSource.mode}; shell and file writes are guarded.`,
  `- Backend automation boundary=${harness.boundaries.automationSource.mode}; active manifest env=${harness.boundaries.automationSource.activeManifestEnv}.`,
  `- Same-failure limit=${loops.sameFailureLimit}; terminal states=${loops.terminalStates.join(", ")}.`,
];

if (!workspace.ready) lines.push(formatWorkspacePreflight(workspace, config));
else if (workspace.warnings.length > 0) lines.push(`- Optional integrations: ${workspace.warnings.join(" ")}`);

if (handoff?.facts && Object.keys(handoff.facts).length > 0) {
  lines.push(`- Fresh handoff facts: ${JSON.stringify(handoff.facts)}`);
}

emitContext(payload, "SessionStart", lines.join("\n").slice(0, 5000));
