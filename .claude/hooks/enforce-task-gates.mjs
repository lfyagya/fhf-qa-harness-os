#!/usr/bin/env node
// PreToolUse:Edit|Write — when a task is active, block the next step until its current gate is stamped.
// Why this exists (2026-09-22): the model treats an unstamped gate as a suggestion and plans the
// next step anyway. It also treats loop state as optional reading. A blocked or escalated run,
// or an unreadable state file, must stop the write. A missing state file is a first pass.
import { readFileSync } from "node:fs";
import { loadHarnessConfig } from "./lib/harness-config.mjs";
import { emitAllow } from "./lib/hook-runtime.mjs";
import { inspectActiveTaskGates } from "./lib/task-protocol.mjs";
import { loopWriteBlock } from "./lib/route-context.mjs";

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  emitAllow(payload);
  process.exit(0);
}

const config = loadHarnessConfig();
const inspection = inspectActiveTaskGates(config, process.env, payload);
if (inspection.active && inspection.error) {
  console.error(`BLOCKED: ${inspection.error}`);
  process.exit(2);
}
if (inspection.block) {
  console.error(`BLOCKED: ${inspection.block.reason}`);
  process.exit(2);
}
const loopBlock = loopWriteBlock(payload.cwd ?? process.cwd(), config);
if (loopBlock) {
  console.error(`BLOCKED: ${loopBlock}`);
  process.exit(2);
}
emitAllow(payload);
