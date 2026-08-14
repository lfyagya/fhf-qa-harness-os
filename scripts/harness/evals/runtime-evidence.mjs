import fs from "node:fs";
import path from "node:path";
import { TRACE_SCHEMA } from "../runtime-state.mjs";

const TERMINAL_VERDICTS = new Set(["PASS", "PASS_WITH_ACTIONS", "BLOCK"]);
const SUCCESS_VERDICTS = new Set(["PASS", "PASS_WITH_ACTIONS"]);
const TERMINAL_STATUSES = new Set(["completed", "blocked", "escalated"]);

export function parseTraceLines(content, source = "trace") {
  const events = [];
  const errors = [];
  const lines = String(content ?? "").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (event?.schema !== TRACE_SCHEMA) {
        errors.push(`${source}:${index + 1} has schema ${event?.schema ?? "missing"}; expected ${TRACE_SCHEMA}`);
        return;
      }
      if (!event.runId || !event.type) {
        errors.push(`${source}:${index + 1} is missing runId or type`);
        return;
      }
      events.push({ ...event, source, traceLine: index + 1 });
    } catch (error) {
      errors.push(`${source}:${index + 1} is invalid JSON: ${error.message}`);
    }
  });
  return { events, errors };
}

export function readTraceFile(file) {
  const source = path.resolve(file);
  if (!fs.existsSync(source)) return { events: [], errors: [`Trace file does not exist: ${source}`] };
  return parseTraceLines(fs.readFileSync(source, "utf8"), source);
}

function eventOrder(event, index) {
  const timestamp = Date.parse(event.timestamp ?? "");
  return Number.isFinite(timestamp) ? timestamp : index;
}

export function repairOutcomesFromTrace(events) {
  const runs = new Map();
  for (const [index, event] of (events ?? []).entries()) {
    if (!event?.runId) continue;
    const run = runs.get(event.runId) ?? { runId: event.runId, events: [] };
    run.events.push({ event, index });
    runs.set(event.runId, run);
  }

  return [...runs.values()].flatMap((run) => {
    const ordered = run.events
      .slice()
      .sort((left, right) => eventOrder(left.event, left.index) - eventOrder(right.event, right.index));
    const gateEvents = ordered
      .map(({ event }) => event)
      .filter((event) => event.type === "gate_verdict" && TERMINAL_VERDICTS.has(event.verdict));
    const repairEvents = ordered
      .map(({ event }) => event)
      .filter((event) => ["repair_started", "repair_completed"].includes(event.type));
    const cycleNumbers = ordered
      .map(({ event }) => event.repairCycle)
      .filter((cycle) => Number.isInteger(cycle) && cycle >= 0);
    const maxRepairCycle = cycleNumbers.length ? Math.max(...cycleNumbers) : 0;
    const initialBlock = gateEvents.some((event) => event.verdict === "BLOCK");
    const hadRepair = repairEvents.length > 0 || maxRepairCycle > 0 || (initialBlock && gateEvents.length > 1);
    if (!hadRepair) return [];

    const finalGate = gateEvents.at(-1);
    const finalStatus = ordered
      .map(({ event }) => event)
      .filter((event) => TERMINAL_STATUSES.has(event.status))
      .at(-1)?.status ?? null;
    const converged = SUCCESS_VERDICTS.has(finalGate?.verdict) && finalStatus === "completed";
    return [{
      id: run.runId,
      runId: run.runId,
      converged,
      repairCycles: Math.max(maxRepairCycle, Math.max(0, gateEvents.length - 1)),
      terminalVerdict: finalGate?.verdict ?? null,
      terminalStatus: finalStatus,
      eventCount: ordered.length,
      source: ordered[0]?.event.source ?? null,
      reason: converged ? "terminal_pass" : finalStatus ?? "incomplete",
    }];
  });
}
