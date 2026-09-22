#!/usr/bin/env node
// PreToolUse:Read — keep a single file read from refilling the conversation.
import { existsSync, readFileSync, statSync } from "node:fs";
import { engineeringConfig } from "./lib/harness-config.mjs";
import { hookFilePath, hookReadLimit } from "./lib/hook-payload.mjs";
import { emitAllow } from "./lib/hook-runtime.mjs";

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  emitAllow();
  process.exit(0);
}
process.on("exit", (code) => code === 0 && emitAllow(payload));

const filePath = hookFilePath(payload);
const policy = engineeringConfig().context.readOutput;
const limit = hookReadLimit(payload);
const isBounded = limit !== null && limit <= policy.maxLines;
const isSmall =
  filePath &&
  existsSync(filePath) &&
  statSync(filePath).size <= policy.unboundedReadMaxBytes;
const normalizedPath = String(filePath ?? "").replaceAll("\\", "/");
const fullContextPaths = policy.fullContextPaths ?? ["docs/framework/", "docs/adr/"];
const isDeclaredContext = fullContextPaths.some((entry) =>
  normalizedPath.includes(String(entry).replaceAll("\\", "/")),
);

if (isBounded || isSmall || isDeclaredContext) process.exit(0);

console.error(
  `BLOCKED: bound this Read to ${policy.maxLines} lines or fewer to prevent context thrashing. ` +
    `Use limit: ${policy.maxLines}, then inspect the next chunk only if needed.`,
);
process.exit(2);
