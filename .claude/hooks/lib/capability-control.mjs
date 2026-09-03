import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { workspaceConnectorDeclarations } from "./workspace-contract.mjs";

function policyFor(config, id) {
  const policy = config?.engineering?.capabilityControl;
  const capability = policy?.capabilities?.[id];
  if (!policy || !capability) throw new Error(`Unknown harness capability: ${id}`);
  return { policy, capability };
}

function safeStateFile(root, policy, id, subject) {
  const directory = String(policy.stateDirectory ?? "").trim();
  if (!directory || path.isAbsolute(directory) || directory.split(/[\\/]/).includes("..")) {
    throw new Error("Capability stateDirectory must be a safe relative workspace path");
  }
  const key = createHash("sha256").update(`${id}\n${subject}`).digest("hex");
  return path.resolve(root, directory, id, `${key}.json`);
}

function readState(file) {
  if (!fs.existsSync(file)) return null;
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  if (state?.schema !== "fhf-harness/capability-state/v1") throw new Error(`Invalid capability state: ${file}`);
  return state;
}

function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function declared(root, config, capability) {
  if (!capability.workspaceDeclaration) return true;
  return Boolean(workspaceConnectorDeclarations({ root, config })[capability.workspaceDeclaration]);
}

// Statuses only the owner can clear. On these the agent stops and asks the
// owner; it must not retry, silently degrade, or substitute a fallback on its
// own initiative. Retryable/unavailable is deliberately absent — recovering
// from transient connector failure stays the agent's job.
export const OWNER_ACTION_STATUSES = Object.freeze([
  "access-request-required",
  "blocked-authentication",
  "blocked-authorization",
  "escalated",
]);

export const isOwnerAction = (status) => OWNER_ACTION_STATUSES.includes(status);

function decision({ policy, capability, state, isDeclared }) {
  if (!isDeclared) return {
    status: "access-request-required", exitCode: 2,
    reason: `${capability.label} is not declared in this local workspace.`, requiredInput: capability.accessRequest,
  };
  if (!state) return {
    status: "live-probe-required", exitCode: 2,
    reason: `${capability.label} is declared but no observed probe result is recorded for this task subject.`, requiredInput: capability.liveProbe,
  };
  const outcome = capability.outcomes?.[state.outcome];
  if (!outcome) throw new Error(`Unsupported recorded capability outcome: ${state.outcome}`);
  if (outcome.retryable && state.attempts <= policy.maxRetryableUnavailable) return {
    status: "retry-required", exitCode: 2,
    reason: `${outcome.reason} Retry ${state.attempts} of ${policy.maxRetryableUnavailable}.`, requiredInput: outcome,
  };
  if (outcome.retryable) return {
    status: "escalated", exitCode: 2,
    reason: `${outcome.reason} Retry budget is exhausted.`, requiredInput: capability.escalation,
  };
  return { status: outcome.status, exitCode: outcome.status === "ready" ? 0 : 2, reason: outcome.reason, requiredInput: outcome };
}

export function capabilityStatus({ id, subject, root, config } = {}) {
  if (typeof subject !== "string" || !subject.trim()) throw new Error("Capability subject is required");
  const { policy, capability } = policyFor(config, id);
  const file = safeStateFile(root, policy, id, subject.trim());
  const verdict = decision({ policy, capability, state: readState(file), isDeclared: declared(root, config, capability) });
  return {
    schema: "fhf-harness/capability-status/v1", id, subject: subject.trim(), label: capability.label,
    stateFile: path.relative(root, file).replaceAll("\\", "/"),
    ...verdict,
    ownerAction: isOwnerAction(verdict.status),
  };
}

export function recordCapabilityOutcome({ id, subject, root, config, outcome } = {}) {
  if (typeof subject !== "string" || !subject.trim()) throw new Error("Capability subject is required");
  const { policy, capability } = policyFor(config, id);
  if (!capability.outcomes?.[outcome]) throw new Error(`Unsupported capability outcome: ${outcome}`);
  const file = safeStateFile(root, policy, id, subject.trim());
  const previous = readState(file);
  const state = {
    schema: "fhf-harness/capability-state/v1", id, subject: subject.trim(), outcome,
    attempts: (previous?.attempts ?? 0) + 1, updatedAt: new Date().toISOString(),
  };
  writeState(file, state);
  return state;
}

export function formatCapabilityStatus(result) {
  const lines = [
    result.exitCode === 0 ? "CAPABILITY READY" : "CAPABILITY BLOCKED",
    ...(result.ownerAction
      ? ["OWNER ACTION REQUIRED: stop work and ask the owner. Do not retry, degrade, or pick a fallback unprompted."]
      : []),
    `Capability: ${result.id} (${result.label})`, `Subject: ${result.subject}`, `Reason: ${result.reason}`,
  ];
  for (const step of result.requiredInput?.nextSteps ?? result.requiredInput?.steps ?? []) lines.push(`- ${step}`);
  if (result.requiredInput?.fallback) lines.push(`- Fallback: ${result.requiredInput.fallback}`);
  return lines.join("\n");
}
