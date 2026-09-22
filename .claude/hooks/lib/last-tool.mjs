import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { hookInput } from "./hook-payload.mjs";

const DEFAULT_REL = "cypress/handoff/last-tool.json";
const SCHEMA = "fhf-harness/last-tool/v1";
const OUTPUT_LIMIT = 32000;

function relPath(config) {
  return config?.engineering?.context?.runtime?.lastToolFile || DEFAULT_REL;
}

function fileFor(cwd, config) {
  return join(cwd, relPath(config));
}

function redact(text, config) {
  let next = String(text ?? "");
  const patterns = config?.engineering?.context?.runtime?.redactPatterns ?? [
    "(?:token|password|secret|authorization|cookie)\\s*[:=]\\s*[^\\s,;]+",
  ];
  for (const source of patterns) {
    try {
      next = next.replace(new RegExp(source, "gi"), "[REDACTED]");
    } catch {
      // A bad pattern must not drop the recorded output.
    }
  }
  return next;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function toolCallSignature(payload) {
  const tool = String(payload?.tool_name ?? payload?.name ?? "");
  if (!tool) return "";
  return `${tool}\n${String(payload?.cwd ?? "")}\n${stable(hookInput(payload))}`;
}

function outputText(payload, config) {
  const raw = payload.tool_response ?? payload.tool_output ?? payload.output ?? payload.result ?? payload.error ?? payload.error_message ?? "";
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  const clean = redact(text, config);
  if (clean.length <= OUTPUT_LIMIT) return clean;
  return `${clean.slice(0, OUTPUT_LIMIT)}\n[truncated]`;
}

export function readLastTool(cwd, config) {
  const file = fileFor(cwd, config);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || parsed.schema !== SCHEMA || typeof parsed.signature !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function recordLastTool(cwd, config, payload) {
  const signature = toolCallSignature(payload);
  if (!signature) return null;
  const record = {
    schema: SCHEMA,
    signature,
    tool: String(payload.tool_name ?? payload.name ?? ""),
    output: outputText(payload, config),
    at: new Date().toISOString(),
  };
  const file = fileFor(cwd, config);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export function repeatBlock(cwd, config, payload) {
  const signature = toolCallSignature(payload);
  if (!signature) return "";
  const last = readLastTool(cwd, config);
  if (!last || last.signature !== signature) return "";
  return [
    "BLOCKED: this tool call matches the last recorded call. Use that output.",
    `Last tool: ${last.tool}.`,
    "Last recorded output:",
    last.output || "(empty)",
  ].join("\n");
}

export function formatLastTool(cwd, config) {
  const last = readLastTool(cwd, config);
  if (!last) return "";
  return [
    `[loop] Last tool call: ${last.tool}.`,
    `[loop] Last recorded output: ${last.output || "(empty)"}.`,
  ].join("\n");
}
