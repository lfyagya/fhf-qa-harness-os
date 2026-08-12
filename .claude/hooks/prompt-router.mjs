#!/usr/bin/env node
// UserPromptSubmit — tool-neutral router engine with runtime-specific output.
// Replaces: session-topic-guard.mjs, prompt-duplication-guard.mjs, model-routing-guard.mjs.
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { loadHarnessConfig, detectLane } from './lib/harness-config.mjs';
import { emitContext, emitEmpty } from './lib/hook-runtime.mjs';
import { extractFacts, mergeHandoff } from './lib/memory-state.mjs';

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const prompt = (payload.prompt ?? '').toLowerCase();
const lines = [];
let engineering;
try {
  engineering = loadHarnessConfig().engineering;
} catch (error) {
  emitContext(payload, "UserPromptSubmit", `[router] Harness config unavailable: ${error.message}`);
  process.exit(0);
}
const { context, memory } = engineering;
const lane = detectLane(payload.cwd ?? process.env.CLAUDE_CWD ?? process.cwd());

const facts = extractFacts(payload.prompt ?? "", memory);
if (Object.keys(facts).length > 0) mergeHandoff(payload, memory, { facts });

function routeApplies(route) {
  if (Array.isArray(route.lanes) && route.lanes.length > 0) return route.lanes.includes(lane);
  if (lane === "backend" && /spawn cypress-/i.test(route.hint ?? "")) return false;
  return true;
}

// 1. Topic drift — "one session = one job"
if (context.topicDriftSignals.some(s => prompt.includes(s))) {
  lines.push('[router] Possible topic drift — one session = one job. Finish the current job; suggest a new chat for the secondary request.');
}

// 2. Highest-priority matching route from the canonical harness config wins.
const routes = context.routes
  .map((route, index) => ({ ...route, index }))
  .sort((a, b) => b.priority - a.priority || a.index - b.index);
for (const route of routes) {
  if (!routeApplies(route)) continue;
  if (new RegExp(route.match, 'i').test(prompt)) {
    lines.push(`[router:${route.id}] ${route.hint}`);
    break;
  }
}

// 3. Duplication pre-check on creation prompts
const isCreate = /\b(create|write|add|new|generate)\b.*(config|command|spec|test|hook)/i.test(prompt);
const moduleMatch = prompt.match(/(?:for|command for|config for|spec for)\s+([\w-]+)/);
if (isCreate && moduleMatch) {
  try {
    const hits = execSync(`git ls-files "*${moduleMatch[1]}*"`, { cwd: process.env.CLAUDE_CWD ?? process.cwd(), encoding: 'utf8', timeout: 5000 }).trim();
    if (hits) {
      const reuseHint = lane === "backend"
        ? "reuse the existing client, db_schema constant, or test file"
        : "cypress-generator's reuse-first check (Step 2) covers this, but note it now";
      lines.push(`[router] Files matching "${moduleMatch[1]}" already exist — ${reuseHint}:`);
      hits.split('\n').filter(Boolean).slice(0, context.duplicateMatchLimit).forEach(f => lines.push('  ' + f));
    }
  } catch {}
}

if (lines.length > 0) {
  emitContext(payload, "UserPromptSubmit", lines.join('\n'));
} else {
  emitEmpty(payload);
}
process.exit(0);
