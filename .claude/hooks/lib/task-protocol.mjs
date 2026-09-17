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

export function humanApprovalBlock(manifest, config, manifestPath) {
  const pending = pendingHumanGate(manifest, config);
  if (!pending) return null;
  const command = `node .harness/task-protocol.mjs approve --manifest ${manifestPath} --gate ${pending.gate.id}`;
  return {
    pending,
    reason: `human approval required for gate "${pending.gate.id}" (${pending.gate.label ?? pending.gate.id}); ${pending.state}. Stop this step. A human runs: ${command}`,
    command,
  };
}

export function inspectActiveTaskGates(config, env = process.env) {
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
  return {
    active: true,
    envName,
    source,
    manifest,
    block: humanApprovalBlock(manifest, config, source),
    next: nextStep(manifest, { ...gateOptions(config), repoIds: Object.keys(config.productTopology?.repositories ?? {}) }),
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
