import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  process.env.FHF_HARNESS_CONFIG,
  path.resolve(HERE, "..", "..", "harness.config.json"),
  path.resolve(HERE, "..", "..", "..", "config", "qa-control-plane.json"),
].filter(Boolean);

function readOverlay() {
  const source = String(process.env.FHF_HARNESS_OVERLAY ?? "").trim();
  if (!source) return null;
  try {
    const content = source.startsWith("{")
      ? source
      : fs.readFileSync(path.resolve(source), "utf8");
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid FHF_HARNESS_OVERLAY: ${error.message}`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertStringField(value, name, maxLength = 200) {
  if (value === undefined) return;
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`FHF_HARNESS_OVERLAY ${name} must be a non-empty string of at most ${maxLength} characters`);
  }
}

function assertLowerBudget(value, base, name) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 1 || value > base) {
    throw new Error(`FHF_HARNESS_OVERLAY ${name} must be a positive integer no greater than ${base}`);
  }
}

function validateOverlay(overlay, base) {
  const policy = base.engineering?.context?.runtimeOverlay;
  if (!isPlainObject(overlay)) throw new Error("FHF_HARNESS_OVERLAY must be a JSON object");
  if (!policy || overlay.version !== policy.version) {
    throw new Error(`FHF_HARNESS_OVERLAY version must be ${policy?.version ?? "the configured version"}`);
  }

  const allowed = new Set(["version", ...policy.allowedSections]);
  for (const key of Object.keys(overlay)) {
    if (!allowed.has(key)) throw new Error(`FHF_HARNESS_OVERLAY section is not allowed: ${key}`);
  }

  const session = overlay.session ?? {};
  if (!isPlainObject(session)) throw new Error("FHF_HARNESS_OVERLAY.session must be an object");
  for (const key of Object.keys(session)) {
    if (!policy.sessionFields.includes(key)) throw new Error(`FHF_HARNESS_OVERLAY.session.${key} is not allowed`);
    assertStringField(session[key], `session.${key}`);
  }
  const routeIds = new Set((base.engineering.context.routes ?? []).map((route) => route.id));
  if (session.routeId && !routeIds.has(session.routeId)) {
    throw new Error(`FHF_HARNESS_OVERLAY.session.routeId is not configured: ${session.routeId}`);
  }
  const modules = base.moduleAliases ?? {};
  if (session.module && !Object.hasOwn(modules, session.module)) {
    throw new Error(`FHF_HARNESS_OVERLAY.session.module is not configured: ${session.module}`);
  }

  const context = overlay.context ?? {};
  if (!isPlainObject(context)) throw new Error("FHF_HARNESS_OVERLAY.context must be an object");
  for (const key of Object.keys(context)) {
    if (!["readOutput"].includes(key)) throw new Error(`FHF_HARNESS_OVERLAY.context.${key} is not allowed`);
  }
  const readOutput = context.readOutput ?? {};
  if (!isPlainObject(readOutput)) throw new Error("FHF_HARNESS_OVERLAY.context.readOutput must be an object");
  for (const key of Object.keys(readOutput)) {
    if (!["maxLines", "unboundedReadMaxBytes"].includes(key)) {
      throw new Error(`FHF_HARNESS_OVERLAY.context.readOutput.${key} is not allowed`);
    }
  }
  assertLowerBudget(readOutput.maxLines, base.engineering.context.readOutput.maxLines, "context.readOutput.maxLines");
  assertLowerBudget(
    readOutput.unboundedReadMaxBytes,
    base.engineering.context.readOutput.unboundedReadMaxBytes,
    "context.readOutput.unboundedReadMaxBytes",
  );

  const loops = overlay.loops ?? {};
  if (!isPlainObject(loops)) throw new Error("FHF_HARNESS_OVERLAY.loops must be an object");
  for (const key of Object.keys(loops)) {
    if (!["sameFailureLimit", "gateRepairLimit", "specSweepLimit"].includes(key)) {
      throw new Error(`FHF_HARNESS_OVERLAY.loops.${key} is not allowed`);
    }
    assertLowerBudget(loops[key], base.engineering.loops[key], `loops.${key}`);
  }
}

function applyOverlay(base, overlay) {
  if (!overlay) return base;
  validateOverlay(overlay, base);
  const effective = structuredClone(base);
  effective.session = { ...(effective.session ?? {}), ...(overlay.session ?? {}) };
  effective.engineering.context = {
    ...effective.engineering.context,
    ...(overlay.context ?? {}),
    readOutput: {
      ...effective.engineering.context.readOutput,
      ...(overlay.context?.readOutput ?? {}),
    },
  };
  effective.engineering.loops = {
    ...effective.engineering.loops,
    ...(overlay.loops ?? {}),
  };
  effective.baseConfigFingerprint = `sha256:${crypto.createHash("sha256").update(JSON.stringify(base)).digest("hex")}`;
  effective.runtimeOverlay = overlay;
  return effective;
}

export function loadHarnessConfig() {
  const file = CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!file) {
    throw new Error(
      `Harness config not found. Checked: ${CANDIDATES.join(", ")}. `
      + "Run the consumer projection verifier or regenerate the projection from fhf-harness-os.",
    );
  }
  let base;
  try {
    base = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(
      `Harness config is invalid at ${file}: ${error.message}. `
      + "Repair the canonical policy or regenerate this projection; do not continue with a partial config.",
    );
  }
  if (!isPlainObject(base)) {
    throw new Error(
      `Harness config is invalid at ${file}: the root value must be a JSON object. `
      + "Repair the canonical policy or regenerate this projection; do not continue with a partial config.",
    );
  }
  return applyOverlay(base, readOverlay());
}

function markerLane(cwd) {
  let current = path.resolve(cwd || process.cwd());
  while (true) {
    const marker = path.join(current, ".harness", "lane.json");
    if (fs.existsSync(marker)) {
      try {
        const value = JSON.parse(fs.readFileSync(marker, "utf8"));
        if (typeof value.lane === "string" && value.lane.length > 0) return value.lane;
      } catch {
        return null;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function hasConsumerProjection(cwd) {
  let current = path.resolve(cwd || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, ".claude", "harness.config.json"))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export function detectLane(cwd, config = loadHarnessConfig()) {
  const resolved = path.resolve(cwd || process.cwd()).replace(/\\/g, "/").toLowerCase();
  const configuredLanes = new Set([
    "root",
    ...Object.keys(config.paths?.lanes ?? {}),
    ...Object.keys(config.workspaceContract?.lanes ?? {}),
  ]);
  const marked = markerLane(cwd);
  if (marked && configuredLanes.has(marked)) return marked;
  const explicit = String(process.env.FHF_LANE ?? "").trim().toLowerCase();
  if (explicit && configuredLanes.has(explicit)) return explicit;
  const lanes = Object.entries(config.paths?.lanes ?? {})
    .map(([name, value]) => ({
      name,
      root: String(value?.root ?? "").replace(/\\/g, "/").toLowerCase(),
    }))
    .filter((lane) => lane.root)
    .sort((a, b) => b.root.length - a.root.length);
  for (const { name, root } of lanes) {
    const needle = `/${root}`;
    if (resolved.includes(`${needle}/`) || resolved.endsWith(needle)) return name;
  }
  if (hasConsumerProjection(cwd)) return "unknown";
  return "root";
}

export function engineeringConfig() {
  const engineering = loadHarnessConfig().engineering;
  if (!engineering) throw new Error("Harness config is missing engineering");
  return engineering;
}
