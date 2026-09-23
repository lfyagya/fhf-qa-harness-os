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
export const isLocalTask = protocol.isLocalTask;
export const listTaskManifests = protocol.listTaskManifests;
export const resolveTaskFromText = protocol.resolveTaskFromText;
export const readTaskFocus = protocol.readTaskFocus;
export const writeTaskFocus = protocol.writeTaskFocus;
export const focusFromResolution = protocol.focusFromResolution;
export const taskQuestion = protocol.taskQuestion;

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

// One root for every task reader: the project the session opened, then the payload cwd.
export function taskRoot(payload = {}, cwd = "") {
  return path.resolve(
    process.env.CLAUDE_PROJECT_DIR
      ?? process.env.CURSOR_PROJECT_DIR
      ?? payload?.cwd
      ?? (cwd || process.cwd()),
  );
}

export function resolveActiveTask({ root, config, env = process.env }) {
  return protocol.resolveActiveTask({ root, config, env });
}

// ADR-0043. The prompt names the work; this maps it to its manifest and records the focus.
// It never blocks: an unmatched ticket gets the path its manifest belongs at, and a prompt
// with no task signal ("yes", "continue") leaves the current focus alone.
export function routeTaskFocus({ root, config, text, env = process.env }) {
  const envName = config.engineering?.taskProtocol?.activeManifestEnv;
  if (envName && String(env[envName] ?? "").trim()) return null;
  const current = protocol.readTaskFocus(root, config);
  const resolution = protocol.resolveTaskFromText({ root, config, text, lenient: current?.awaiting === true });
  const relative = (file) => path.relative(root, file).replace(/\\/g, "/");
  const listed = resolution.candidates.map((entry) => entry.manifest.id).join(", ");
  if (resolution.match) {
    const focus = protocol.focusFromResolution(resolution);
    if (current?.file !== focus.file || current?.awaiting) protocol.writeTaskFocus(root, config, focus);
    return `[task] active: ${focus.id} (${resolution.kind}) -> ${relative(resolution.match.file)}`;
  }
  if (resolution.kind === "keyword") {
    // One lenient reply per question; the next automation write asks again if still unresolved.
    protocol.writeTaskFocus(root, config, { ...current, awaiting: false });
    return resolution.candidates.length
      ? `[task] the keyword matches several manifests (${listed}); ask the owner which one, by ticket or file name.`
      : `[task] no manifest matches that keyword. Ask the owner for the SERV key or manifest file, or confirm a new local task at ${relative(resolution.suggestedPath)}.`;
  }
  if (resolution.kind === "jira") {
    protocol.writeTaskFocus(root, config, protocol.focusFromResolution(resolution));
    return resolution.candidates.length
      ? `[task] ${resolution.key} matches several manifests (${listed}); name the primary ticket to choose.`
      : `[task] no manifest for ${resolution.key}; create it at ${relative(resolution.suggestedPath)} before automation work.`;
  }
  if (resolution.candidates.length) {
    return `[task] title matches several manifests (${listed}); name the ticket or the fuller title to choose.`;
  }
  return null;
}

export function inspectActiveTaskGates(config, env = process.env, payload = {}) {
  const resolved = resolveActiveTask({ root: taskRoot(payload), config, env });
  const envName = resolved.envName ?? "FHF_ACTIVE_TASK";
  const source = resolved.file;
  if (!source) return { active: false, envName };
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(source, "utf8"));
  } catch (error) {
    return {
      active: true,
      envName,
      origin: resolved.source,
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
    origin: resolved.source,
    source,
    manifest,
    block: pending && !isActiveTaskManifestWrite(filePath, source) ? pending : null,
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
