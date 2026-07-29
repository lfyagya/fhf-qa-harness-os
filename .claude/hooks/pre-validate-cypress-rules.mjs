#!/usr/bin/env node
// PreToolUse:Edit|Write — pre-flight Cypress rule check before the file is written.
// exit 2 = BLOCK the write if critical violations found.
// Shares its rule patterns with validate-cypress-rules.mjs and spec-sweep-stop-hook.mjs
// via lib/cypress-rule-patterns.mjs — see that file before editing thresholds here.
import { readFileSync } from 'fs';
import { extname } from 'path';
import { CY_WAIT_NUMBER_RE, SMOKE_MUTATION_RE, isSmokePath } from './lib/cypress-rule-patterns.mjs';
import { hookContent, hookFilePath } from './lib/hook-payload.mjs';
import { emitAllow } from './lib/hook-runtime.mjs';

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  emitAllow(payload);
  process.exit(0);
}
process.on('exit', code => code === 0 && emitAllow(payload));

const filePath = hookFilePath(payload);
if (!filePath.includes('cypress') && !filePath.includes('CypressFHF')) process.exit(0);
if (!['.js', '.ts', '.mjs'].includes(extname(filePath))) process.exit(0);

// Content to check: new_string (Edit) or content (Write)
const content = hookContent(payload);
if (!content) process.exit(0);

const critical = [];

// NEVER cy.wait(number) — block before write
const waitHit = content.match(CY_WAIT_NUMBER_RE);
if (waitHit) critical.push(`cy.wait(number) forbidden: ${waitHit[0]}) — use cy.apiWait() or .should('be.visible')`);

// NEVER mutations in smoke — block before write
if (isSmokePath(filePath) && SMOKE_MUTATION_RE.test(content))
  critical.push('Mutation method in smoke test — smoke is GET-only');

if (critical.length > 0) {
  console.error('PRE-VALIDATION BLOCKED — fix before write:');
  critical.forEach(v => console.error('  ✗ ' + v));
  process.exit(2);
}
process.exit(0);
