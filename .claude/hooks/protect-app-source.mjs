#!/usr/bin/env node
// PreToolUse:Edit|Write — block any write into fhf-dashboards/src (read-only).
// exit 2 = BLOCK the tool call.
import { readFileSync } from 'fs';
import { hookFilePath } from './lib/hook-payload.mjs';

if (process.argv.includes('--cursor'))
  process.on('exit', code => code === 0 && console.log(JSON.stringify({ permission: 'allow' })));

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const filePath = hookFilePath(payload);

if (/fhf-dashboards\/src/.test(filePath)) {
  console.error('BLOCKED: fhf-dashboards/src is read-only — QA never edits app source.');
  console.error('To add a data-cy attribute, open a PR upstream to the frontend dev team.');
  process.exit(2);
}
process.exit(0);
