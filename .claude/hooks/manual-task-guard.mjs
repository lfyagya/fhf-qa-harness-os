#!/usr/bin/env node
// PreToolUse:Bash — block destructive or production-unsafe shell commands.
// exit 2 = BLOCK; exit 0 = allow.
import { readFileSync } from 'fs';

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cmd = (payload.tool_input?.command ?? '').toLowerCase();

// Patterns that should never run without explicit user instruction
const BLOCKED_PATTERNS = [
  { re: /rm\s+-rf\s+[^/]/, msg: 'rm -rf on non-root path — use Remove-Item or be explicit' },
  { re: /git\s+push\s+--force/, msg: 'force push — requires explicit user approval' },
  { re: /git\s+reset\s+--hard/, msg: 'git reset --hard — destructive; requires explicit user approval' },
  { re: /npx\s+cypress\s+run.*--spec.*production/, msg: 'Cypress run against production — smoke only in ProdSmokeExecution' },
  { re: /DROP\s+TABLE|TRUNCATE\s+TABLE/i, msg: 'Destructive SQL in shell — blocked' },
];

for (const { re, msg } of BLOCKED_PATTERNS) {
  if (re.test(cmd)) {
    console.error(`BASH BLOCKED: ${msg}`);
    console.error('If this is intentional, explicitly ask the user to run it with ! <command>');
    process.exit(2);
  }
}
process.exit(0);
