#!/usr/bin/env node
// PostToolUse:Edit|Write — check scenario objects carry required fields.
// exit 2 = violation, stderr fed back to Claude to fix; exit 0 = clean.
import { readFileSync } from 'fs';
import { qualityAssurance } from './lib/cypress-rule-patterns.mjs';
import { loadHarnessConfig } from './lib/harness-config.mjs';

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const filePath = (payload.tool_input?.file_path ?? '').replace(/\\/g, '/');
if (!filePath.includes('scenarios') && !filePath.includes('.scenarios.')) process.exit(0);

const content = payload.tool_input?.new_string ?? payload.tool_input?.content ?? '';
if (!content) process.exit(0);

let REQUIRED;
try {
  REQUIRED = qualityAssurance(loadHarnessConfig()).scenarioRequiredFields.map((field) => `${field}:`);
} catch (error) {
  console.error(`SCENARIO CONTENT: ${error.message}`);
  process.exit(2);
}
const missing = REQUIRED.filter(f => !content.includes(f));

if (missing.length > 0) {
  console.error('SCENARIO CONTENT: scenario object(s) missing required fields:');
  missing.forEach(f => console.error('  ✗ ' + f.replace(':', '')));
  console.error('See docs/framework/TESTS.md §Scenario Object Format');
  process.exit(2);
}
process.exit(0);
