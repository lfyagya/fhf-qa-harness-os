#!/usr/bin/env node
// PostToolUse:Edit|Write — flag changes that may violate lane or coverage strategy.
// exit 2 = violation, stderr fed back to Claude to fix; exit 0 = clean.
import { readFileSync } from 'fs';
import { detectLane } from './lib/harness-config.mjs';

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const filePath = (payload.tool_input?.file_path ?? '').replace(/\\/g, '/');
if (!filePath.includes('cypress') && !filePath.includes('CypressFHF')) process.exit(0);

const content = payload.tool_input?.new_string ?? payload.tool_input?.content ?? '';
if (!content) process.exit(0);

const warnings = [];
let lane = 'root';
try { lane = detectLane(payload.cwd ?? process.env.CLAUDE_CWD ?? process.cwd()); } catch {}

// Smoke spec in E2E path or vice versa
if (lane === 'smoke' && /[\\/]e2e[\\/]/.test(filePath))
  warnings.push('E2E test path detected in the Smoke checkout — Smoke tests go in /smoke/');

if (lane === 'e2e' && /[\\/]smoke[\\/]/.test(filePath))
  warnings.push('Smoke test path detected in the E2E checkout — Smoke tests belong in the Smoke checkout');

// cy.interceptXxxApis() must come before cy.visit() in specs
if (filePath.endsWith('.cy.js')) {
  const visitIdx = content.indexOf('cy.visit(');
  const interceptIdx = content.indexOf('cy.intercept');
  if (visitIdx !== -1 && interceptIdx !== -1 && visitIdx < interceptIdx)
    warnings.push('cy.visit() appears before cy.intercept — intercept must be registered BEFORE navigation');
}

if (warnings.length > 0) {
  console.error('COVERAGE STRATEGY:');
  warnings.forEach(w => console.error('  ⚠ ' + w));
  process.exit(2);
}
process.exit(0);
