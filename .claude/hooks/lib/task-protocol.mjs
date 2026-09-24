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
const LANE_CHECKOUTS = new Set(["e2e", "smoke", "backend"]);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function laneOf(dir) {
  const lane = readJson(path.join(dir, ".harness", "lane.json"))?.lane;
  return typeof lane === "string" ? lane : null;
}

function consumerRootOf(dir) {
  const raw = readJson(path.join(dir, ".harness", "workspace.local.json"))?.consumerRoot;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const resolved = path.resolve(dir, raw.trim());
  return fs.existsSync(resolved) ? resolved : null;
}

// Task manifests live in the FHF workspace (.harness/tasks), not in an E2E, Smoke, or
// backend checkout. A write whose cwd is the lane still resolves that workspace.
export function taskRoot(payload = {}, cwd = "") {
  const start = path.resolve(
    process.env.CLAUDE_PROJECT_DIR
      ?? process.env.CURSOR_PROJECT_DIR
      ?? payload?.cwd
      ?? (cwd || process.cwd()),
  );
  let current = start;
  let laneCheckout = null;
  while (true) {
    const lane = laneOf(current);
    if (lane === "root") return current;
    if (LANE_CHECKOUTS.has(lane)) {
      laneCheckout = current;
      const consumer = consumerRootOf(current);
      if (consumer && path.resolve(consumer) !== path.resolve(current)) return consumer;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (laneCheckout) {
    const parent = path.dirname(laneCheckout);
    if (laneOf(parent) === "root" || fs.existsSync(path.join(parent, ".harness", "tasks"))) return parent;
  }
  return start;
}

export function resolveActiveTask({ root, config, env = process.env, sessionId = null }) {
  return protocol.resolveActiveTask({ root, config, env, sessionId });
}

export const sessionFocus = protocol.sessionFocus;
export const isInstruction = protocol.isInstruction;
export const isAffirmative = protocol.isAffirmative;
export const isNegative = protocol.isNegative;
export const quickTaskFor = protocol.quickTaskFor;
export const recordQuickTask = protocol.recordQuickTask;
export const quickTaskQuestion = protocol.quickTaskQuestion;

// ADR-0044. Owner said yes (or no) to a pending quick task. Shared by the typed-reply path in the
// router and the AskUserQuestion answer hook, so both record the same thing.
export function answerQuickTask({ root, config, focus, affirmative }) {
  if (!focus?.quick || focus.quick.state !== "pending") return null;
  if (affirmative) {
    protocol.writeTaskFocus(root, config, {
      ...focus,
      quick: { ...focus.quick, state: "confirmed", confirmedAt: new Date().toISOString() },
    });
    return `[task] quick task confirmed: ${focus.quick.title}`;
  }
  const { quick, lastInstruction, ...rest } = focus;
  protocol.writeTaskFocus(root, config, rest);
  return `[task] quick task declined: ${quick.title}. No automation write will run for it.`;
}

// ADR-0043/0044. The prompt names the work; this maps it to its manifest and records the focus.
// It never blocks. A SERV key, manifest file or title selects a full task; any other instruction
// becomes the session's quick task; a reply ("yes", "continue") leaves the focus alone.
export function routeTaskFocus({ root, config, text, env = process.env, sessionId = null }) {
  const envName = config.engineering?.taskProtocol?.activeManifestEnv;
  if (envName && String(env[envName] ?? "").trim()) return null;
  const current = protocol.sessionFocus(root, config, sessionId);
  const write = (focus) => protocol.writeTaskFocus(root, config, { ...focus, sessionId });
  if (current?.quick?.state === "pending" && (protocol.isAffirmative(text) || protocol.isNegative(text))) {
    return answerQuickTask({ root, config, focus: current, affirmative: protocol.isAffirmative(text) });
  }
  const resolution = protocol.resolveTaskFromText({ root, config, text, lenient: current?.awaiting === true });
  const relative = (file) => path.relative(root, file).replace(/\\/g, "/");
  const listed = resolution.candidates.map((entry) => entry.manifest.id).join(", ");
  if (resolution.match && resolution.via === "related" && current?.file
    && current.file !== path.basename(resolution.match.file)) {
    // A ticket that is only "related" to some manifest (an epic, a sibling) is context, not a
    // task switch. Naming it must not take the focus from the task this session is working on.
    return `[task] ${resolution.key} is only a related ticket of ${resolution.match.manifest.id}; keeping the active task (${current.id ?? current.file}). Name ${resolution.match.manifest.ticketFamily?.primary ?? "its primary ticket"} to switch.`;
  }
  if (resolution.match) {
    const focus = protocol.focusFromResolution(resolution);
    if (current?.file !== focus.file || current?.awaiting || current?.quick) write(focus);
    return `[task] active: ${focus.id} (${resolution.kind}) -> ${relative(resolution.match.file)}`;
  }
  if (resolution.kind === "keyword") {
    // One lenient reply per question; the next automation write asks again if still unresolved.
    write({ ...current, awaiting: false });
    return resolution.candidates.length
      ? `[task] the keyword matches several manifests (${listed}); ask the owner which one, by ticket or file name.`
      : `[task] no manifest matches that keyword. Ask the owner for the SERV key or manifest file, or confirm a new local task at ${relative(resolution.suggestedPath)}.`;
  }
  if (resolution.kind === "jira") {
    write(protocol.focusFromResolution(resolution));
    return resolution.candidates.length
      ? `[task] ${resolution.key} matches several manifests (${listed}); name the primary ticket to choose.`
      : `[task] no manifest for ${resolution.key}; create it at ${relative(resolution.suggestedPath)} before automation work.`;
  }
  if (resolution.candidates.length) {
    return `[task] title matches several manifests (${listed}); name the ticket or the fuller title to choose.`;
  }
  if (protocol.isInstruction(text) && !current?.file) {
    // A new instruction with no full task in this session: it is this prompt's quick task.
    const lastInstruction = { text: String(text).trim().slice(0, 500), at: new Date().toISOString() };
    const recorded = write({ id: null, file: null, source: "prompt", key: null, lastInstruction, at: lastInstruction.at });
    if (!recorded) return null;
    return "[task] tier=quick: no SERV ticket named, so any route step that says \"create or refresh the task manifest\" applies only to full tasks. This prompt proceeds as a quick task: one owner confirm at its first automation write, no Jira grounding or gates.";
  }
  return null;
}

export function inspectActiveTaskGates(config, env = process.env, payload = {}) {
  const resolved = resolveActiveTask({ root: taskRoot(payload), config, env, sessionId: payload?.session_id ?? null });
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
    next: nextStep(manifest, protocol.protocolOptions(config)),
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
