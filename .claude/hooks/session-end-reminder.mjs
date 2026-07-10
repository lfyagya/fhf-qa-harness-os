#!/usr/bin/env node
// Stop hook 1 — advisory: print git state at session end.
// exit 0 always (non-blocking).
import { execSync } from 'child_process';

let gitState = 'unknown';
try {
  const out = execSync('git status --short', { encoding: 'utf8', timeout: 5000 }).trim();
  const lines = out.split('\n').filter(Boolean);
  gitState = lines.length === 0 ? 'clean — nothing uncommitted' : `${lines.length} uncommitted change(s) — agent work stays uncommitted until owner reviews`;
} catch { gitState = 'git not available'; }

console.log(`[session-end] ${gitState}`);
process.exit(0);
