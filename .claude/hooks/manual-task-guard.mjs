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
const workingDirectory = String(
  payload.tool_input?.working_directory ?? payload.cwd ?? process.cwd(),
).toLowerCase();
const externalBackendPath = /(?:^|[\\/])fhf-backend-automation(?:[\\/]|$)/i;
const isExternalBackend = externalBackendPath.test(cmd) || externalBackendPath.test(workingDirectory);
const readOnlyBackendCommand = /^(?:git\s+(?:status|diff|log|show|ls-files)(?:\s+[^;&|><`$()]*)?|(?:rg|grep|find|get-content|cat|type|dir|ls|test-path|pwd)\b[^;&|><`$()]*)$/i;
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
const shellMutation = /(?:^|[;&|]\s*|\b)(?:rm|del|erase|rmdir|mv|move|cp|copy|touch|mkdir|tee|set-content|add-content|out-file|new-item|remove-item|move-item|copy-item|git\s+(?:add|apply|commit|push|checkout|switch|merge|rebase|reset|restore|clean)|(?:npm|pnpm|yarn|pip|pip3|poetry)\s+(?:install|add|remove|update)|patch|python|node|perl|ruby)\b|>>?|2>/i;

// Patterns that should never run without explicit user instruction
const BLOCKED_PATTERNS = [
  { re: /rm\s+-rf\s+[^/]/, msg: 'rm -rf on non-root path — use Remove-Item or be explicit' },
  { re: /git\s+push\s+--force/, msg: 'force push — requires explicit user approval' },
  { re: /git\s+reset\s+--hard/, msg: 'git reset --hard — destructive; requires explicit user approval' },
  { re: /npx\s+cypress\s+run.*--spec.*production/, msg: 'Cypress run against production — smoke only in ProdSmokeExecution' },
  { re: /DROP\s+TABLE|TRUNCATE\s+TABLE/i, msg: 'Destructive SQL in shell — blocked' },
  ...cloudCredentialPatterns,
];

if (isExternalBackend && !readOnlyBackendCommand.test(cmd)) {
  console.error('BASH BLOCKED: fhf-backend-automation is available for read-only evidence only.');
  console.error('Use a direct read/search tool or a simple read-only shell command.');
  process.exit(2);
}

if (protectedApplicationPaths.some((pattern) => pattern.test(cmd) || pattern.test(workingDirectory)) && shellMutation.test(cmd)) {
  console.error('BASH BLOCKED: protected application and external backend paths are read-only.');
  console.error('Open an upstream change in the repository owned by that team.');
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
