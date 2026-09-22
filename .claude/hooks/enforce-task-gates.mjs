#!/usr/bin/env node
// PreToolUse:Edit|Write — when a task is active, block the next step until its current gate is stamped.
//
// Why this exists (2026-09-21): a model will keep implementing after the first missing stamp.
// stampGate only records who approved; this hook is the fail-closed Edit/Write stop when
// FHF_ACTIVE_TASK is set and the current gate is missing or stale. It is not the requirement
// to have a task — that is automationSource via protect-automation-scope (ADR-0039).
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
const inspection = inspectActiveTaskGates(config, process.env, payload);
if (inspection.active && inspection.error) {
  console.error(`BLOCKED: ${inspection.error}`);
  process.exit(2);
}
if (inspection.block) {
  console.error(`BLOCKED: ${inspection.block.reason}`);
  process.exit(2);
}
emitAllow(payload);
