#!/usr/bin/env node
// PostToolUse:Edit|Write — warn when a new config/command name may already exist.
// exit 2 = violation, stderr fed back to Claude to resolve; exit 0 = clean.
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { basename } from 'path';

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const filePath = (payload.tool_input?.file_path ?? '').replace(/\\/g, '/');
const isConfig  = /[\\/]configs[\\/]/.test(filePath);
const isCommand = /[\\/]commands[\\/]/.test(filePath);
if (!isConfig && !isCommand) process.exit(0);

const fileName = basename(filePath);

// Check if another file with the same name exists elsewhere in the tree
try {
  const root = process.env.CLAUDE_CWD ?? process.cwd();
  const results = execSync(`git ls-files "*${fileName}"`, { cwd: root, encoding: 'utf8', timeout: 5000 }).trim();
  const matches = results.split('\n').filter(f => f && !f.includes(filePath.split('/').pop()));
  if (matches.length > 0) {
    console.error(`DUPLICATION RISK: "${fileName}" already exists at:`);
    matches.forEach(m => console.error('  ' + m));
    console.error('Verify this is intentional — one command = one owner.');
    process.exit(2);
  }
} catch {}

process.exit(0);
