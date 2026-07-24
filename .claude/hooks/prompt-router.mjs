#!/usr/bin/env node
// UserPromptSubmit — single router: topic-drift check, duplication check, routing hint.
// exit 0 always; stdout is ADDED TO CLAUDE'S CONTEXT (exit 1 stderr would only reach the terminal).
// Replaces: session-topic-guard.mjs, prompt-duplication-guard.mjs, model-routing-guard.mjs.
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const prompt = (payload.prompt ?? '').toLowerCase();
const lines = [];

// 1. Topic drift — "one session = one job"
const DRIFT_SIGNALS = ['also can you', "while we're here", 'one more thing', 'and also', 'by the way', 'oh and'];
if (DRIFT_SIGNALS.some(s => prompt.includes(s))) {
  lines.push('[router] Possible topic drift — one session = one job. Finish the current job; suggest a new chat for the secondary request.');
}

// 2. Routing hint — first matching rule wins (mirrors .claude/rules/agent-spawning-gate.md)
// Only 4 agents exist: cypress-generator, cypress-gate, cypress-debugger, cypress-shipper.
const ROUTES = [
  [/\b(command center|current sprint|sprint intake|spec (sync|freshness|delta)|centralized qa|cross-lane)\b/, 'QA control plane → follow C:/Users/Leapfrog/fhf-harness-os/docs/framework/qa-control-plane.md inline; approval-gate every Jira, Confluence, or application-spec write.'],
  [/cloud\.cypress\.io|cypress cloud.*(fail|run)/, 'Cypress Cloud run → spawn cypress-debugger (needs the run URL).'],
  [/\b(failing|fails|red|broken|error)\b.*\b(test|spec)\b|\b(test|spec)\b.*\b(failing|fails|red|broken)\b/, 'Failing test → spawn cypress-debugger (root cause + fix + regression test, 3-strike escalation).'],
  [/\b(flaky|slow|intermittent)\b.*\b(test|spec|suite)\b/, 'Flakiness/perf → spawn cypress-debugger (Performance Audit mode).'],
  [/\bacceptance criteria\b|\bserv-\d+/, 'Jira ticket → spawn cypress-generator (scenarios + spec, one pass).'],
  [/\b(migrate|migration)\b.*\b(actions|page.?object)/, 'Legacy migration → spawn cypress-generator (migrates before extending, Step 4).'],
  [/\b(pre-?merge|ready to (commit|merge))\b/, 'Pre-merge → spawn cypress-gate for the verdict.'],
  [/\b(open (a )?pr|pull request)\b/, 'Open a PR → spawn cypress-shipper (Mode 1).'],
  [/\b(explain|how does|review)\b.*\b(test|spec)\b/, 'Explain/review only, no edits → cypress-explain skill. Need a merge verdict instead → spawn cypress-gate.'],
  [/\bui coverage|coverage gap|automation (backlog|roadmap)|risk matrix\b/, 'Coverage/backlog/risk report → spawn cypress-shipper (Mode 2/3).'],
  [/\b(write|create|add|new|generate)\b.*\b(test|spec|suite)\b/, 'New test → spawn cypress-generator (it checks for duplicates itself, Step 2).'],
];
for (const [re, hint] of ROUTES) {
  if (re.test(prompt)) { lines.push('[router] ' + hint); break; }
}

// 3. Duplication pre-check on creation prompts
const isCreate = /\b(create|write|add|new|generate)\b.*(config|command|spec|test|hook)/i.test(prompt);
const moduleMatch = prompt.match(/(?:for|command for|config for|spec for)\s+([\w-]+)/);
if (isCreate && moduleMatch) {
  try {
    const hits = execSync(`git ls-files "*${moduleMatch[1]}*"`, { cwd: process.env.CLAUDE_CWD ?? process.cwd(), encoding: 'utf8', timeout: 5000 }).trim();
    if (hits) {
      lines.push(`[router] Files matching "${moduleMatch[1]}" already exist — cypress-generator's reuse-first check (Step 2) covers this, but note it now:`);
      hits.split('\n').filter(Boolean).slice(0, 5).forEach(f => lines.push('  ' + f));
    }
  } catch {}
}

if (lines.length > 0) console.log(lines.join('\n'));
process.exit(0);
