import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.resolve(HERE, "..", "..", "..", ".harness", "task-protocol-lib.mjs"),
  path.resolve(HERE, "..", "..", "..", "scripts", "harness", "task-protocol-lib.mjs"),
];
const selected = candidates.find((file) => fs.existsSync(file));
if (!selected) {
  throw new Error("task-protocol-lib.mjs is not available beside this hook tree");
}

const protocol = await import(pathToFileURL(selected).href);

export const firstPendingGate = protocol.firstPendingGate;
export const nextStep = protocol.nextStep;
export const isAcceptedTicket = protocol.isAcceptedTicket;
export const containsAcceptedTicket = protocol.containsAcceptedTicket;
export const ticketKeyFromValue = protocol.ticketKeyFromValue;
export const ticketLabel = protocol.ticketLabel;
export const listedProjectKeys = protocol.listedProjectKeys;

export function gateOptions(config) {
  const approval = config.engineering?.taskProtocol?.approval ?? {};
  return {
    approvalFields: approval.boundFields,
    gates: approval.gates ?? [],
    legacySingleDigestSatisfies: approval.legacySingleDigestSatisfies ?? "plan",
  };
}

export function pendingHumanGate(manifest, config) {
  const options = gateOptions(config);
  if (!options.gates.length || !manifest?.approval?.required) return null;
  return firstPendingGate(manifest, options.gates, manifest.stage, options);
}

export function isActiveTaskManifestWrite(filePath, source) {
  if (!filePath || !source) return false;
  try {
    return path.resolve(filePath).replace(/\\/g, "/").toLowerCase()
      === path.resolve(source).replace(/\\/g, "/").toLowerCase();
  } catch {
    return false;
  }
}

export function humanApprovalBlock(manifest, config) {
  const pending = pendingHumanGate(manifest, config);
  if (!pending) return null;
  return {
    pending,
    reason: `human approval required for gate "${pending.gate.id}" (${pending.gate.label ?? pending.gate.id}); ${pending.state}. Stop implementation. Write review.${pending.gate.id} on the task manifest, then present the in-chat confirm UI. Do not dump a CLI approve command. Agents cannot approve.`,
  };
}

export function inspectActiveTaskGates(config, env = process.env, payload = {}) {
  const envName = config.engineering?.taskProtocol?.activeManifestEnv ?? "FHF_ACTIVE_TASK";
  const source = String(env[envName] ?? "").trim();
  if (!source) return { active: false, envName };
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(source, "utf8"));
  } catch (error) {
    return {
      active: true,
      envName,
      source,
      error: `active task manifest is unavailable or invalid: ${error.message}`,
    };
  }
  const pending = humanApprovalBlock(manifest, config);
  const filePath = payload?.tool_input?.file_path
    ?? payload?.input?.file_path
    ?? payload?.input?.path
    ?? payload?.tool_input?.path
    ?? "";
  return {
    active: true,
    envName,
    source,
    manifest,
    block: pending && !isActiveTaskManifestWrite(filePath, source) ? pending : null,
    next: nextStep(manifest, {
      ...gateOptions(config),
      repoIds: Object.keys(config.productTopology?.repositories ?? {}),
      bundleIds: Object.keys(config.productTopology?.sourceBundles ?? {}),
      bundles: config.productTopology?.sourceBundles ?? {},
      edges: config.productTopology?.edges ?? [],
    }),
  };
}

export function formatTaskGateContext(inspection) {
  if (!inspection?.active) return null;
  if (inspection.error) return `[task-protocol] STOP: ${inspection.error}`;
  if (inspection.block) return `[task-protocol] STOP: ${inspection.block.reason}`;
  const action = inspection.next?.action ?? "unknown";
  const stage = inspection.manifest?.stage ?? "unknown";
  return `[task-protocol] next=${action} stage=${stage}. Do not skip a later gate.`;
}
