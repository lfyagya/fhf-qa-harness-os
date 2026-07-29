#!/usr/bin/env node
// Stop hook 2 — THE GATE. Sweeps changed .cy.js files in BOTH sub-repos for violations.
// Specs live in the sub-repos (separate git repos) — never in the parent, so each
// git diff must run inside a sub-repo root.
// exit 2 = reopen the turn so Claude can fix (bounded by harness config), stderr fed to Claude.
// exit 0 = clean; writes a handoff artifact only when specs were actually checked.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { checkSpecContent, isSmokePath, SMOKE_MUTATION_RE } from './lib/cypress-rule-patterns.mjs';
import { loadHarnessConfig } from './lib/harness-config.mjs';
import { emitEmpty } from './lib/hook-runtime.mjs';
import { mergeHandoff } from './lib/memory-state.mjs';

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch {}
const ROOT = process.env.CLAUDE_CWD ?? process.cwd();
const config = loadHarnessConfig();
const engineering = config.engineering;
const REPOS = [
  ...['e2e', 'smoke'].map((lane) => join(ROOT, config.paths.lanes[lane].root)),
  ROOT, // parent itself, in case a session is opened inside a sub-repo (ROOT is then that repo)
];
const RETRY_FILE = join(ROOT, '.claude', 'hooks', '.sweep-retries');
const MAX_RETRIES = engineering.loops.specSweepLimit;

let retries = 0;
try { retries = parseInt(readFileSync(RETRY_FILE, 'utf8'), 10) || 0; } catch {}

// Collect changed AND new (untracked) Cypress spec files per repo — agent-written
// specs are usually untracked, so a plain `git diff` would never see them.
const changedSpecs = [];
for (const repo of new Set(REPOS)) {
  if (!existsSync(join(repo, '.git'))) continue;
  for (const cmd of ['git diff --name-only HEAD', 'git ls-files --others --exclude-standard']) {
    try {
      // stderr ignored: git CRLF warnings would otherwise pollute the exit-2 message fed to Claude
      const out = execSync(cmd, { cwd: repo, encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'] });
      for (const rel of out.trim().split('\n')) {
        if (rel.endsWith('.cy.js') || rel.endsWith('.cy.ts')) changedSpecs.push(resolve(repo, rel));
      }
    } catch {}
  }
}

if (changedSpecs.length === 0) {
  resetRetries();
  emitEmpty(payload);
  process.exit(0); // nothing swept — no handoff litter
}

const allViolations = [];
for (const abs of changedSpecs) {
  if (!existsSync(abs)) continue;
  let content;
  try { content = readFileSync(abs, 'utf8'); } catch { continue; }
  const v = checkSpec(abs.replace(/\\/g, '/'), content);
  if (v.length > 0) allViolations.push({ file: abs, violations: v });
}

if (allViolations.length === 0) {
  resetRetries();
  writeHandoff('completed');
  emitEmpty(payload);
  process.exit(0);
}

if (retries >= MAX_RETRIES) {
  console.error(`Spec sweep: max retries (${MAX_RETRIES}) reached — manual review required.`);
  resetRetries();
  writeHandoff('escalated');
  emitEmpty(payload);
  process.exit(0); // let through after max retries to avoid infinite loop
}

writeFileSync(RETRY_FILE, String(retries + 1));
console.error(`SPEC SWEEP GATE — violations (attempt ${retries + 1}/${MAX_RETRIES}):`);
for (const { file, violations } of allViolations) {
  console.error(`\n  ${file}:`);
  violations.forEach(v => console.error(`    ✗ ${v}`));
}
process.exit(2);

function checkSpec(filePath, content) {
  const v = checkSpecContent(content);
  if (isSmokePath(filePath) && SMOKE_MUTATION_RE.test(content)) v.push('mutation in smoke');
  return v;
}

function resetRetries() {
  try { writeFileSync(RETRY_FILE, '0'); } catch {}
}

function writeHandoff(terminalState) {
  // ponytail: single overwritten file — timestamped files accumulated 90+ litter entries
  try {
    mergeHandoff(payload, engineering.memory, {
      clean: terminalState === 'completed',
      terminalState,
      sweptAt: new Date().toISOString(),
      checkedSpecs: [...new Set(changedSpecs)],
    });
  } catch {}
}
