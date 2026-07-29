#!/usr/bin/env node
// Stop hook 1 — enforce configured same-failure escalation once.
import { readFileSync } from 'fs';
import { engineeringConfig } from './lib/harness-config.mjs';
import { readFailureState, writeFailureState } from './lib/failure-state.mjs';
import { emitEmpty, emitStopFollowup } from './lib/hook-runtime.mjs';

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch {}

const engineering = engineeringConfig();
const failure = readFailureState(payload);
if (
  failure.count >= engineering.loops.sameFailureLimit &&
  failure.escalationIssued !== true
) {
  writeFailureState(payload, { ...failure, escalationIssued: true });
  emitStopFollowup(
    payload,
    `The same ${failure.toolName ?? 'tool'} failure reached the configured limit ` +
      `(${engineering.loops.sameFailureLimit}). Do not retry it. Summarize the evidence and ` +
      'escalate to the owner.',
  );
  process.exit(0);
}

emitEmpty(payload);
process.exit(0);
