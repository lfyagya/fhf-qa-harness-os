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
  console.error('BLOCKED: path is read-only per engineering.harness.boundaries.applicationSource.');
  console.error('App source, tests/.env, and config/config.ini are not writable from this lane.');
  process.exit(2);
}
emitAllow(payload);
process.exit(0);
