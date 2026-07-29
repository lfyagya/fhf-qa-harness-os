#!/usr/bin/env node
// PostToolUseFailure — count identical failures and enforce the configured escalation limit.
import { readFileSync } from "node:fs";
import { engineeringConfig } from "./lib/harness-config.mjs";
import {
  failureSignature,
  readFailureState,
  writeFailureState,
} from "./lib/failure-state.mjs";
import { emitContext, emitEmpty } from "./lib/hook-runtime.mjs";

let payload = {};
try { payload = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }

if (payload.is_interrupt) {
  emitEmpty(payload);
  process.exit(0);
}

const limit = engineeringConfig().loops.sameFailureLimit;
const signature = failureSignature(payload);
const previous = readFailureState(payload);
const count = previous.signature === signature ? (previous.count ?? 0) + 1 : 1;
writeFailureState(payload, {
  signature,
  count,
  limit,
  toolName: payload.tool_name ?? "unknown",
  lastError: String(payload.error ?? payload.error_message ?? "").slice(0, 1000),
  escalationIssued: previous.signature === signature && previous.escalationIssued === true,
  updatedAt: new Date().toISOString(),
});

if (count === limit) {
  emitContext(
    payload,
    "PostToolUseFailure",
    `Harness loop limit reached: the same ${payload.tool_name ?? "tool"} failure occurred ` +
      `${count} times. Stop retrying this strategy, preserve the evidence, and escalate to the owner.`,
  );
} else {
  emitEmpty(payload);
}
