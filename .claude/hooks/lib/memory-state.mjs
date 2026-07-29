import fs from "node:fs";
import path from "node:path";

export function workspaceRoot(payload) {
  return path.resolve(
    payload?.cwd ??
    payload?.workspace_roots?.[0] ??
    process.env.CLAUDE_CWD ??
    process.cwd(),
  );
}

export function handoffPath(payload, memory) {
  return path.resolve(workspaceRoot(payload), memory.handoffFile);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function extractFacts(prompt, memory) {
  const facts = {};
  for (const extractor of memory.factExtractors ?? []) {
    const matches = [...String(prompt).matchAll(new RegExp(extractor.match, extractor.flags))]
      .map((match) => match[0].trim())
      .filter(Boolean);
    if (matches.length > 0) facts[extractor.name] = [...new Set(matches)].slice(0, 20);
  }
  return facts;
}

export function mergeHandoff(payload, memory, patch) {
  const file = handoffPath(payload, memory);
  const previous = readJson(file);
  const facts = { ...(previous.facts ?? {}) };
  for (const [name, values] of Object.entries(patch.facts ?? {})) {
    facts[name] = [...new Set([...(facts[name] ?? []), ...values])].slice(0, 20);
  }
  const next = {
    ...previous,
    ...patch,
    facts,
    sessionId: payload?.session_id ?? payload?.conversation_id ?? previous.sessionId ?? null,
    updatedAt: new Date().toISOString(),
  };
  writeJson(file, next);
  return next;
}

export function readFreshHandoff(payload, memory) {
  const state = readJson(handoffPath(payload, memory));
  const timestamp = Date.parse(state.updatedAt ?? state.sweptAt ?? state.checkpointAt ?? "");
  const maxAgeMs = memory.handoffMaxAgeHours * 60 * 60 * 1000;
  if (!Number.isFinite(timestamp) || Date.now() - timestamp > maxAgeMs) return null;
  return state;
}
