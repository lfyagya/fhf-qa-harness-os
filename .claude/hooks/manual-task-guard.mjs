#!/usr/bin/env node
// PreToolUse:Bash — block destructive or production-unsafe shell commands.
// exit 2 = BLOCK; exit 0 = allow.
import { readFileSync } from 'fs';
import { loadHarnessConfig } from './lib/harness-config.mjs';
import { emitAllow } from './lib/hook-runtime.mjs';

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  emitAllow(payload);
  process.exit(0);
}

const config = loadHarnessConfig();
const cmd = (payload.tool_input?.command ?? '').toLowerCase();
const cloudCredentialPatterns = (
  config.connectors?.cypressCloud?.cli?.guard?.inlineCredentialPatterns ?? []
).map((source) => ({
  re: new RegExp(source, 'i'),
  msg: 'Cypress Cloud credentials must come from OAuth or the external CI secret environment',
  overridable: false,
}));
const protectedApplicationPaths = (
  config.engineering?.harness?.boundaries?.applicationSource?.pathPatterns ?? []
).map((source) => new RegExp(source, 'i'));
const shellMutation = /(?:^|[;&|]\s*|\b)(?:rm|del|erase|rmdir|mv|move|cp|copy|touch|mkdir|tee|set-content|add-content|out-file|new-item|remove-item|move-item|copy-item|git\s+apply|patch|python|node|perl|ruby)\b|>>?|2>/i;

// Patterns that should never run without explicit user instruction
const BLOCKED_PATTERNS = [
  { re: /rm\s+-rf\s+[^/]/, msg: 'rm -rf on non-root path — use Remove-Item or be explicit' },
  { re: /git\s+push\s+--force/, msg: 'force push — requires explicit user approval' },
  { re: /git\s+reset\s+--hard/, msg: 'git reset --hard — destructive; requires explicit user approval' },
  { re: /npx\s+cypress\s+run.*--spec.*production/, msg: 'Cypress run against production — smoke only in ProdSmokeExecution' },
  { re: /DROP\s+TABLE|TRUNCATE\s+TABLE/i, msg: 'Destructive SQL in shell — blocked' },
  ...cloudCredentialPatterns,
];

if (protectedApplicationPaths.some((pattern) => pattern.test(cmd)) && shellMutation.test(cmd)) {
  console.error('BASH BLOCKED: fhf-dashboards/src is read-only, including shell writes.');
  console.error('Open an upstream frontend PR for application-source changes.');
  process.exit(2);
}

for (const { re, msg, overridable = true } of BLOCKED_PATTERNS) {
  if (re.test(cmd)) {
    console.error(`BASH BLOCKED: ${msg}`);
    if (overridable) {
      console.error('If this is intentional, explicitly ask the user to run it with ! <command>');
    } else {
      console.error('Use `cy-cloud login` for local OAuth; inject the CI token outside the agent session.');
    }
    process.exit(2);
  }
}
emitAllow(payload);
process.exit(0);
