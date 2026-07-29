#!/usr/bin/env node
// PreCompact|SessionEnd — persist a bounded checkpoint without copying conversation text.
import { readFileSync } from "node:fs";
import { engineeringConfig } from "./lib/harness-config.mjs";
import { emitEmpty } from "./lib/hook-runtime.mjs";
import { mergeHandoff, workspaceRoot } from "./lib/memory-state.mjs";

let payload = {};
try { payload = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }

mergeHandoff(payload, engineeringConfig().memory, {
  checkpointAt: new Date().toISOString(),
  checkpointReason:
    payload.trigger ?? payload.reason ?? payload.source ?? payload.hook_event_name ?? "unknown",
  workspace: workspaceRoot(payload),
});
emitEmpty(payload);
