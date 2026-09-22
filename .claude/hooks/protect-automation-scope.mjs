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
});
if (decision.applies && !decision.allowed) {
  console.error(`BLOCKED: ${decision.reason}`);
  console.error("Provide the sprint task: SERV ticket, module, and the pytest remainder Cypress does not already cover (REST, service, Oracle, or Python workflow).");
  console.error("The task manifest records that choice. Routing continues from the task. This write waits until that manifest names the selected path and a non-production environment.");
  process.exit(2);
}
emitAllow(payload);
