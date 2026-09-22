import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LOOP_SCHEMA = "fhf-harness/loop-state/v1";

export function promptForMatch(value) {
  return String(value ?? "")
    .replace(/```chat_selection[\s\S]*?```/gi, " ")
    .replace(/<chat_selection>[\s\S]*?<\/chat_selection>/gi, " ");
}

export function formatBundleSlice(route, config) {
  const ids = route?.sourceBundles ?? [];
  if (!ids.length) return "";
  const bundles = config?.productTopology?.sourceBundles ?? {};
  const edges = config?.productTopology?.edges ?? [];
  const lines = [];
  for (const id of ids) {
    const bundle = bundles[id];
    if (!bundle) {
      lines.push(`[router] Source bundle '${id}' is not in productTopology.sourceBundles.`);
      continue;
    }
    const seeds = new Set(bundle.seedRepositories ?? []);
    const hop = [];
    for (const edge of edges) {
      const fromSeed = seeds.has(edge?.from);
      const toSeed = seeds.has(edge?.to);
      if (fromSeed === toSeed) continue;
      hop.push(`${edge.id ?? "edge"}: ${edge.from} -> ${edge.to}`);
    }
    lines.push(`[router] Bundle ${id} seeds: ${(bundle.seedRepositories ?? []).join(", ")}.`);
    lines.push(`[router] Expand only for: ${(bundle.expandBy ?? []).join(", ")}. Any other reason is invalid.`);
    lines.push(hop.length
      ? `[router] One hop from those seeds: ${hop.join("; ")}.`
      : "[router] No topology hop leaves those seeds.");
  }
  return lines.join("\n");
}

export function readLoopState(cwd, config) {
  const rel = config?.engineering?.context?.runtime?.stateFile;
  if (!rel) return { rel: "", state: null, error: "No loop state file is configured." };
  const file = join(cwd, rel);
  if (!existsSync(file)) return { rel, state: null, error: "" };
  try {
    const state = JSON.parse(readFileSync(file, "utf8"));
    if (!state || state.schema !== LOOP_SCHEMA) {
      return { rel, state: null, error: `${rel} is not ${LOOP_SCHEMA}.` };
    }
    return { rel, state, error: "" };
  } catch {
    return { rel, state: null, error: `${rel} is unreadable. Do not plan until it parses.` };
  }
}

export function formatLoopState(cwd, config) {
  const { rel, state, error } = readLoopState(cwd, config);
  if (error) return `[loop] ${error}`;
  if (!state) return `[loop] No loop state at ${rel}. This is a first pass.`;
  const verdict = Array.isArray(state.verdicts) && state.verdicts.length
    ? JSON.stringify(state.verdicts.at(-1))
    : "none";
  const failure = Array.isArray(state.failures) && state.failures.length
    ? JSON.stringify(state.failures.at(-1)).slice(0, 400)
    : "none";
  return [
    `[loop] runId=${state.runId} status=${state.status} repairCycles=${state.repairCycles} lastProgressAt=${state.lastProgressAt} stepCount=${state.stepCount}.`,
    `[loop] Last verdict: ${verdict}. Last failure: ${failure}.`,
    "[loop] Do not repeat an action this state already records. An identical retry is escalation.",
  ].join("\n");
}

export function loopWriteBlock(cwd, config) {
  const { state, error } = readLoopState(cwd, config);
  if (error) return error;
  if (!state) return "";
  if (state.status === "blocked" || state.status === "escalated") {
    return `loop ${state.runId} is ${state.status}. Do not plan another attempt in this run.`;
  }
  return "";
}
