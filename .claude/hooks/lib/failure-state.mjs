import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function sessionKey(payload) {
  const value = payload?.session_id ?? payload?.conversation_id ?? "local";
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

export function failureStatePath(payload) {
  return path.join(os.tmpdir(), `fhf-harness-failures-${sessionKey(payload)}.json`);
}

export function readFailureState(payload) {
  try {
    return JSON.parse(fs.readFileSync(failureStatePath(payload), "utf8"));
  } catch {
    return {};
  }
}

export function writeFailureState(payload, state) {
  fs.writeFileSync(failureStatePath(payload), `${JSON.stringify(state, null, 2)}\n`);
}

export function failureSignature(payload) {
  const error = String(payload?.error ?? payload?.error_message ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return crypto.createHash("sha256")
    .update(`${payload?.tool_name ?? "unknown"}\n${error}`)
    .digest("hex");
}
