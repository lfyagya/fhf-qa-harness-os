#!/usr/bin/env node
// UserPromptSubmit — tool-neutral router engine with runtime-specific output.
// Replaces: session-topic-guard.mjs, prompt-duplication-guard.mjs, model-routing-guard.mjs.
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { loadHarnessConfig, detectLane } from './lib/harness-config.mjs';
import { emitPrompt } from './lib/hook-runtime.mjs';
import { extractFacts, isExternalBackendWorkspace, mergeHandoff } from './lib/memory-state.mjs';
import { ticketKeyFromPrompt } from './lib/jira-ticket-access.mjs';
import { capabilityStatus, formatCapabilityStatus } from './lib/capability-control.mjs';
import { formatWorkspacePreflight, workspacePreflight } from './lib/workspace-contract.mjs';
import { formatTaskGateContext, inspectActiveTaskGates } from './lib/task-protocol.mjs';
import { formatBundleSlice, formatCoverageBoundary, formatLoopState, promptForMatch, routeNeedsCoverage } from './lib/route-context.mjs';

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const prompt = promptForMatch(payload.prompt ?? '').toLowerCase();
const lines = [];
let engineering;
let config;
try {
  config = loadHarnessConfig();
  engineering = config.engineering;
} catch (error) {
  console.error("WORKSPACE BLOCKED: Harness configuration is unavailable or invalid.");
  console.error(`- ${error.message}`);
  console.error("Repair the canonical policy or regenerate the consumer projection, then run node .harness/verify.mjs change.");
  process.exit(2);
}
const { context, memory } = engineering;
const overlay = config.runtimeOverlay;
const cwd = payload.cwd ?? process.env.CLAUDE_CWD ?? process.cwd();
const lane = detectLane(cwd);
const workspace = workspacePreflight({ root: cwd, config });
if (!workspace.ready) {
  const setupPrompt = /(?:workspace|harness)\s+setup|\.harness[\\/]setup\.mjs|\.harness[\\/]verify\.mjs/i.test(prompt);
  if (!setupPrompt) {
    console.error(formatWorkspacePreflight(workspace, config));
    process.exit(2);
  }
  emitPrompt(payload, formatWorkspacePreflight(workspace, config));
  process.exit(0);
}
const ticket = ticketKeyFromPrompt(promptForMatch(payload.prompt ?? ""));
let jiraUnread = false;
if (ticket) {
  let access;
  try {
    access = capabilityStatus({ id: "jira-ticket-read", subject: ticket, root: cwd, config });
  } catch (error) {
    console.error("JIRA ACCESS REQUIRED");
    console.error(`- ${error.message}`);
    process.exit(2);
  }
  // Cursor fail-closes UserPromptSubmit on exit 2 and shows only Retry. That
  // overlay cannot collect OAuth. Inject the ask into the turn instead.
  lines.push(formatCapabilityStatus(access));
  if (access.exitCode !== 0) {
    const ask = access.ownerAction
      ? `Ask the owner in this turn to authenticate, authorize, or choose a declared fallback.`
      : `Use the active connector to authenticate if needed, then complete the live probe.`;
    jiraUnread = true;
    lines.push(`[jira] ${ticket} is not ready (${access.status}). ${ask} Do not invent ticket contents or pick a fallback unprompted.`);
  }
}
const isExternalBackend = isExternalBackendWorkspace({ cwd });

const facts = extractFacts(payload.prompt ?? "", memory);
if (!isExternalBackend && Object.keys(facts).length > 0) mergeHandoff(payload, memory, { facts });

function routeApplies(route) {
  if (Array.isArray(route.lanes) && route.lanes.length > 0) return route.lanes.includes(lane);
  if (isExternalBackend && /spawn cypress-/i.test(route.hint ?? "")) return false;
  return true;
}

function formatInvoke(invoke) {
  if (!invoke || typeof invoke !== "object") return "stay in parent";
  const parts = [];
  if (invoke.kind === "agent" && invoke.name) parts.push(`spawn agent ${invoke.name}`);
  else if (invoke.kind === "skill" && invoke.name) parts.push(`stay in parent; read skill ${invoke.name}`);
  else parts.push("stay in parent");
  if (invoke.prefer?.kind === "skill" && invoke.prefer.name) {
    parts.push(`prefer skill ${invoke.prefer.name} when ${invoke.prefer.when ?? "applicable"}`);
  }
  return parts.join("; ");
}

function appendRoute(route) {
  lines.push(`[router:${route.id}] ${route.hint}`);
  if (route.invoke) lines.push(`[router] invoke: ${formatInvoke(route.invoke)}`);
  const slice = formatBundleSlice(route, config);
  if (slice) lines.push(slice);
  const coverage = formatCoverageBoundary(config);
  if (coverage && routeNeedsCoverage(route)) lines.push(coverage);
}

// 1. Topic drift — "one session = one job"
if (context.topicDriftSignals.some(s => prompt.includes(s))) {
  lines.push('[router] Possible topic drift — one session = one job. Finish the current job; suggest a new chat for the secondary request.');
}

// 2. Highest-priority matching route from the canonical harness config wins.
const routes = context.routes
  .map((route, index) => ({ ...route, index }))
  .sort((a, b) => b.priority - a.priority || a.index - b.index);
const explicitRoute = overlay?.session?.routeId
  ? routes.find((route) => route.id === overlay.session.routeId)
  : null;
if (explicitRoute && routeApplies(explicitRoute)) {
  appendRoute(explicitRoute);
  lines.push(`[router] Explicit session route override: ${overlay.session.reason ?? "no reason supplied"}`);
} else {
  if (overlay?.session?.routeId) {
    lines.push(`[router] Session route override '${overlay.session.routeId}' was not applicable to lane '${lane}'.`);
  }
  const matched = [];
  for (const route of routes) {
    if (!routeApplies(route)) continue;
    if (new RegExp(route.match, 'i').test(prompt)) matched.push(route);
  }
  if (matched.length > 0) {
    appendRoute(matched[0]);
    if (matched.length > 1) {
      const rest = matched.slice(1).map((route) => `${route.id}@${route.priority}`).join(", ");
      lines.push(`[router] Also matched: ${rest}. The candidate is not proof. Follow task intent when it names one of these.`);
    }
  }
}

if (overlay?.session?.ticket || overlay?.session?.module) {
  lines.push(
    `[router] Session focus: ${JSON.stringify({
      ticket: overlay.session.ticket ?? null,
      module: overlay.session.module ?? null,
    })}`,
  );
}

// 3. Duplication pre-check on creation prompts
const isCreate = /\b(create|write|add|new|generate)\b.*(config|command|spec|test|hook)/i.test(prompt);
const moduleMatch = prompt.match(/(?:for|command for|config for|spec for)\s+([\w-]+)/);
const gateContext = formatTaskGateContext(inspectActiveTaskGates(config));
if (jiraUnread) {
  lines.push("[jira] The ticket was not read. Use the bundle seeds, moduleSpecPaths, and productTopology edges in this turn as configured product context. They do not fill ticket fields. Unread ticket fields stay UNKNOWN.");
}
lines.push(formatLoopState(cwd, config));
if (gateContext) lines.push(gateContext);

if (isCreate && moduleMatch) {
  try {
    const hits = execSync(`git ls-files "*${moduleMatch[1]}*"`, { cwd: process.env.CLAUDE_CWD ?? process.cwd(), encoding: 'utf8', timeout: 5000 }).trim();
    if (hits) {
      lines.push(`[router] Files matching "${moduleMatch[1]}" already exist — cypress-generator's reuse-first check (Step 2) covers this, but note it now:`);
      hits.split('\n').filter(Boolean).slice(0, context.duplicateMatchLimit).forEach(f => lines.push('  ' + f));
    }
  } catch {}
}

if (lines.length > 0) {
  emitPrompt(payload, lines.join('\n'));
} else {
  emitPrompt(payload, "");
}
process.exit(0);
