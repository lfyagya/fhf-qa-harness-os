#!/usr/bin/env node
// PreToolUse:Edit|Write — block wiki/.raw scaffolding landing outside claude-obsidian/.
// The claude-obsidian plugin (installed at user scope) is global; only its vault at
// ../claude-obsidian legitimately owns a top-level wiki/ or .raw/ folder. If /wiki or
// ingest ever fires with the wrong cwd, this stops it from scaffolding a stray vault
// inside the QA harness itself. exit 2 = BLOCK.
import { readFileSync } from 'fs';
import { hookFilePath } from './lib/hook-payload.mjs';

if (process.argv.includes('--cursor'))
  process.on('exit', code => code === 0 && console.log(JSON.stringify({ permission: 'allow' })));

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const filePath = hookFilePath(payload);

if (/\/FHF\/(wiki|\.raw)\//.test(filePath) && !filePath.includes('/claude-obsidian/')) {
  console.error('BLOCKED: wiki/.raw scaffolding outside claude-obsidian/ — the second-brain vault only lives there.');
  console.error('If you meant to use claude-obsidian, cd into that folder first.');
  process.exit(2);
}
process.exit(0);
