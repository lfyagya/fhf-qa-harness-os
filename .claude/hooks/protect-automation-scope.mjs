#!/usr/bin/env node
// PreToolUse:Edit|Write — allow backend automation writes only inside the active task scope.
import { readFileSync } from "node:fs";
import { loadHarnessConfig } from "./lib/harness-config.mjs";
import { hookFilePath } from "./lib/hook-payload.mjs";
import { emitAllow } from "./lib/hook-runtime.mjs";
import { authorizeAutomationWrite } from "./lib/task-scope.mjs";
import { enforceWorkspaceReady } from "./lib/workspace-contract.mjs";

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  emitAllow(payload);
  process.exit(0);
}

const config = loadHarnessConfig();
const cwd = payload.cwd ?? process.cwd();
enforceWorkspaceReady({ root: cwd, config });
const decision = authorizeAutomationWrite({
  filePath: hookFilePath(payload),
  cwd,
  config,
  sessionId: payload.session_id ?? null,
});
if (decision.applies && !decision.allowed) {
  console.error(`BLOCKED: ${decision.reason}`);
  if (!decision.ask) {
    console.error("The active task's manifest must select this path in grounding.repositories and plan.changeUnits.");
  }
  process.exit(2);
}
emitAllow(payload);
