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

function failureDetail(value) {
  if (!value || typeof value !== "object") return "";
  if (value.is_error === true || value.isError === true) {
    return String(value.error ?? value.message ?? value.stderr ?? "tool error");
  }
  const code = value.exit_code ?? value.exitCode;
  if (typeof code === "number" && code !== 0) {
    return String(value.stderr ?? value.error ?? value.output ?? `exit ${code}`);
  }
  if (typeof value.error === "string" && value.error.trim()) return value.error;
  return "";
}

const eventName = String(payload.hook_event_name ?? payload.hookEventName ?? "");
const failed = /posttoolusefailure/i.test(eventName)
  || String(payload.error ?? payload.error_message ?? "").trim() !== ""
  || failureDetail(payload.tool_response) !== "";
if (!failed) {
  emitEmpty(payload);
  process.exit(0);
}
if (!payload.error && !payload.error_message) {
  const detail = failureDetail(payload.tool_response);
  if (detail) payload.error_message = detail;
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
    /posttoolusefailure/i.test(eventName) ? "PostToolUseFailure" : "PostToolUse",
    `Harness loop limit reached: the same ${payload.tool_name ?? "tool"} failure occurred ` +
      `${count} times. Stop retrying this strategy, preserve the evidence, and escalate to the owner.`,
  );
} else {
  emitEmpty(payload);
}
