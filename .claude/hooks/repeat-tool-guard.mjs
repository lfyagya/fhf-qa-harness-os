#!/usr/bin/env node
// Why this exists (2026-09-22): the model treats "do not retry" as advice. This hook
// compares the next tool call with the last recorded call and output, and refuses
// the repeat so the recorded output is the input to the next step.
import { readFileSync } from "node:fs";
import { loadHarnessConfig } from "./lib/harness-config.mjs";
import { recordLastTool, repeatBlock } from "./lib/last-tool.mjs";

let payload = {};
try { payload = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }

const event = String(payload.hook_event_name ?? payload.hookEventName ?? "");
let config = null;
try { config = loadHarnessConfig(); } catch { config = null; }
const cwd = payload.cwd ?? process.cwd();

if (event === "PostToolUse" || event === "PostToolUseFailure") {
  recordLastTool(cwd, config, payload);
  process.exit(0);
}

const block = repeatBlock(cwd, config, payload);
if (block) {
  console.error(block);
  process.exit(2);
}
process.exit(0);
