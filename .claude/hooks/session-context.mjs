#!/usr/bin/env node
// SessionStart — inject the tool-neutral harness contract and a fresh durable handoff.
import { readFileSync } from "node:fs";
import { loadHarnessConfig } from "./lib/harness-config.mjs";
import { emitContext } from "./lib/hook-runtime.mjs";
import { readFreshHandoff } from "./lib/memory-state.mjs";

let payload = {};
try { payload = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }

const config = loadHarnessConfig();
const { context, memory, harness, loops } = config.engineering;
const handoff = readFreshHandoff(payload, memory);
const lines = [
  "[fhf-harness] Tool-neutral runtime contract:",
  `- Authority: .claude/harness.config.json; context mode=${context.mode}.`,
  "- For each prompt, evaluate engineering.context.routes by highest priority; task intent breaks ties.",
  `- Session scope=${memory.sessionScope}; preserve only configured exact facts in ${memory.handoffFile}.`,
  `- Application source boundary=${harness.boundaries.applicationSource.mode}; shell and file writes are guarded.`,
  `- Same-failure limit=${loops.sameFailureLimit}; terminal states=${loops.terminalStates.join(", ")}.`,
];

if (handoff?.facts && Object.keys(handoff.facts).length > 0) {
  lines.push(`- Fresh handoff facts: ${JSON.stringify(handoff.facts)}`);
}

emitContext(payload, "SessionStart", lines.join("\n").slice(0, 5000));
