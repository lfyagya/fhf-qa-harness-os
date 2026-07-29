#!/usr/bin/env node
// PreToolUse:Edit|Write — block any write into fhf-dashboards/src (read-only).
// exit 2 = BLOCK the tool call.
import { readFileSync } from 'fs';
import { engineeringConfig } from './lib/harness-config.mjs';
import { hookFilePath } from './lib/hook-payload.mjs';
import { emitAllow } from './lib/hook-runtime.mjs';

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  emitAllow(payload);
  process.exit(0);
}

const filePath = hookFilePath(payload);
const patterns = engineeringConfig().harness.boundaries.applicationSource.pathPatterns
  .map((source) => new RegExp(source, 'i'));

if (patterns.some((pattern) => pattern.test(filePath))) {
  console.error('BLOCKED: fhf-dashboards/src is read-only — QA never edits app source.');
  console.error('To add a data-cy attribute, open a PR upstream to the frontend dev team.');
  process.exit(2);
}
emitAllow(payload);
process.exit(0);
