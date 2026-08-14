import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const LOOP_STATE_SCHEMA = "fhf-harness/loop-state/v1";
export const TRACE_SCHEMA = "fhf-harness/trace/v1";

function now() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function redact(value, patterns) {
  let text = String(value ?? "");
  for (const source of patterns ?? []) {
    try {
      text = text.replace(new RegExp(source, "gi"), "[REDACTED]");
    } catch {
      text = "[REDACTED]";
    }
  }
  return text;
}

function redactValue(value, patterns) {
  if (typeof value === "string") return redact(value, patterns);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, patterns));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, patterns)]));
  }
  return value;
}

function requireConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Runtime state requires a harness config");
  return config;
}

export function baseConfigFingerprint(config) {
  const effective = requireConfig(config);
  if (effective.baseConfigFingerprint) return effective.baseConfigFingerprint;
  const base = structuredClone(effective);
  delete base.runtimeOverlay;
  return `sha256:${sha256(JSON.stringify(base))}`;
}

export function effectiveConfigFingerprint(config) {
  return `sha256:${sha256(JSON.stringify(requireConfig(config)))}`;
}

export function createLoopState({ goal, runId, config, lane = "root" } = {}) {
  const effective = requireConfig(config);
  if (!goal || !runId) throw new Error("Loop state requires goal and runId");
  const loops = effective.engineering?.loops ?? {};
  return {
    schema: LOOP_STATE_SCHEMA,
    runId,
    goal: String(goal),
    lane,
    baseConfigFingerprint: baseConfigFingerprint(effective),
    configFingerprint: effectiveConfigFingerprint(effective),
    overlay: effective.runtimeOverlay ?? null,
    plan: [],
    currentStep: null,
    stepCount: 0,
    repairCycles: 0,
    budgets: {
      sameFailureLimit: loops.sameFailureLimit,
      gateRepairLimit: loops.gateRepairLimit,
      specSweepLimit: loops.specSweepLimit,
    },
    lastProgressAt: 0,
    failures: [],
    artifacts: {},
    verdicts: [],
    status: "in_progress",
    createdAt: now(),
    updatedAt: now(),
  };
}

export function updateLoopState(state, patch = {}, config) {
  const effective = requireConfig(config);
  if (!state || state.schema !== LOOP_STATE_SCHEMA) throw new Error("Invalid loop state schema");
  const next = {
    ...state,
    ...patch,
    baseConfigFingerprint: baseConfigFingerprint(effective),
    configFingerprint: effectiveConfigFingerprint(effective),
    overlay: effective.runtimeOverlay ?? null,
    updatedAt: now(),
  };
  if (next.runId !== state.runId) throw new Error("Loop runId cannot change");
  if (next.goal !== state.goal) throw new Error("Loop goal cannot change");
  if (next.stepCount < state.stepCount) throw new Error("Loop stepCount cannot move backwards");
  if (next.lastProgressAt > next.stepCount) throw new Error("Loop lastProgressAt cannot exceed stepCount");
  if (next.repairCycles > next.budgets.gateRepairLimit) throw new Error("Loop gate repair limit exceeded");
  if (!["in_progress", "completed", "blocked", "escalated"].includes(next.status)) {
    throw new Error(`Invalid loop status: ${next.status}`);
  }
  return next;
}

export function serializeTrace(event, config) {
  const effective = requireConfig(config);
  if (!event || typeof event !== "object") throw new Error("Trace event must be an object");
  const safeEvent = redactValue(event, effective.engineering?.context?.runtime?.redactPatterns);
  return {
    ...safeEvent,
    schema: TRACE_SCHEMA,
    timestamp: now(),
    configFingerprint: effectiveConfigFingerprint(effective),
    overlay: effective.runtimeOverlay ?? null,
  };
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !["ESRCH", "EINVAL"].includes(error.code);
  }
}

export function withFileLock(file, operation) {
  const lockFile = `${file}.lock`;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const owner = JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() });
  try {
    fs.writeFileSync(lockFile, owner, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let existingOwner = null;
    try {
      existingOwner = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    } catch {
      // A malformed lock cannot prove ownership, so fail closed.
    }
    if (processIsAlive(existingOwner?.pid)) throw new Error(`Another process holds the lock: ${lockFile}`);
    throw new Error(`Stale lock requires explicit owner cleanup: ${lockFile}`);
  }
  try {
    return operation();
  } finally {
    fs.rmSync(lockFile, { force: true });
  }
}

function writeBundleAtomic(files) {
  const pending = [];
  try {
    for (const { file, content } of files) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const nonce = `${process.pid}.${Date.now()}`;
      const entry = {
        file,
        temporary: `${file}.${nonce}.tmp`,
        backup: `${file}.${nonce}.bak`,
        published: false,
      };
      pending.push(entry);
      fs.writeFileSync(entry.temporary, content, "utf8");
      if (fs.statSync(entry.temporary).size !== Buffer.byteLength(content)) {
        throw new Error(`Incomplete temporary artifact: ${entry.temporary}`);
      }
    }
    for (const entry of pending) {
      if (fs.existsSync(entry.file)) fs.renameSync(entry.file, entry.backup);
    }
    for (const entry of pending) {
      fs.renameSync(entry.temporary, entry.file);
      entry.published = true;
    }
    for (const entry of pending) fs.rmSync(entry.backup, { force: true });
  } catch (error) {
    for (const entry of [...pending].reverse()) {
      if (entry.published) fs.rmSync(entry.file, { force: true });
      if (fs.existsSync(entry.backup)) fs.renameSync(entry.backup, entry.file);
    }
    throw error;
  } finally {
    for (const { temporary, backup } of pending) {
      fs.rmSync(temporary, { force: true });
      fs.rmSync(backup, { force: true });
    }
  }
}

export function writeRuntimeArtifact(file, value) {
  const target = path.resolve(file);
  withFileLock(target, () => {
    writeBundleAtomic([{ file: target, content: `${JSON.stringify(value, null, 2)}\n` }]);
  });
  return target;
}

export function appendTrace(file, event, config) {
  const target = path.resolve(file);
  withFileLock(target, () => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${JSON.stringify(serializeTrace(event, config))}\n`, "utf8");
  });
  return target;
}
