#!/usr/bin/env node
// PostToolUse:Edit|Write — verify scenario files land in the correct directory.
// exit 2 = violation, stderr fed back to Claude to fix; exit 0 = clean.
import { readFileSync } from 'fs';

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const filePath = (payload.tool_input?.file_path ?? '').replace(/\\/g, '/');
if (!filePath.includes('scenarios')) process.exit(0);

const content = payload.tool_input?.new_string ?? payload.tool_input?.content ?? '';

// Scenario files must be in cypress/configs/scenarios/ or cypress/tests/.../scenarios/
if (filePath.includes('.scenarios.js') || filePath.includes('.scenarios.ts')) {
  if (!filePath.includes('/configs/') && !filePath.includes('/scenarios/')) {
    console.error('SCENARIO FILE LOCATION: scenario files belong in cypress/configs/scenarios/ or a module\'s scenarios/ subfolder.');
    console.error('  Found at: ' + filePath);
    process.exit(2);
  }
}

// Scenario objects should use Object.freeze()
if (content && content.includes('scenarios') && !content.includes('Object.freeze(')) {
  console.error('SCENARIO FILE: exported scenario arrays should be wrapped in Object.freeze().');
  process.exit(2);
}

process.exit(0);
