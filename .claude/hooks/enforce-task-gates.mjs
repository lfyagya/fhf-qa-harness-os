#!/usr/bin/env node
// PreToolUse:Edit|Write — when a task is active, block the next step until its current gate is stamped.
import { readFileSync } from "node:fs";
import { loadHarnessConfig } from "./lib/harness-config.mjs";
import { emitAllow } from "./lib/hook-runtime.mjs";
import { inspectActiveTaskGates } from "./lib/task-protocol.mjs";

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  emitAllow(payload);
  process.exit(0);
}

const config = loadHarnessConfig();
const inspection = inspectActiveTaskGates(config);
if (inspection.active && inspection.error) {
  console.error(`BLOCKED: ${inspection.error}`);
  process.exit(2);
}
if (inspection.block) {
  console.error(`BLOCKED: ${inspection.block.reason}`);
  process.exit(2);
}
emitAllow(payload);
