#!/usr/bin/env node
/**
 * Selector drift — did the application change the data-cy contract under us?
 *
 * The PostToolUse liveness check in .claude/hooks/validate-cypress-rules.mjs only fires when
 * SOMEONE EDITS A CONFIG. It cannot fire when the application removes a data-cy and nobody
 * touches cypress/configs/ui/**. That is exactly how `dashboard-item-count` died: the app never
 * emitted it, the config kept declaring it, and 75 assertions in Cloud run 754 failed with
 * "Expected to find element ... but never found it" — indistinguishable from an empty grid.
 *
 * This script closes that half. It compares a committed inventory of every data-cy the app can
 * emit against the app's current source, and reports what disappeared — loudest for the ones a
 * Cypress config still references.
 *
 * Usage:
 *   node scripts/harness/check-selector-drift.mjs                  # check, exit 1 on actionable drift
 *   node scripts/harness/check-selector-drift.mjs --update         # accept current state as baseline
 *   node scripts/harness/check-selector-drift.mjs --app-src <dir>  # override app source location
 *   node scripts/harness/check-selector-drift.mjs --markdown       # emit a report for a CI summary
 *
 * Exit codes: 0 = no actionable drift, 1 = removed selectors are still referenced, 2 = bad setup.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

import {
  resolveAppSourceRoot,
  buildAppSelectorIndex,
  declaredSelectors,
} from '../../.claude/hooks/lib/selector-liveness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
// Canonical home is .claude/hooks/, beside the baselines, because that directory is what
// sync projects into every consumer lane. Kept in scripts/harness/ it reached E2E only.
const INVENTORY = join(HERE, '..', '..', '.claude', 'hooks', 'selector-inventory.json');
const UI_CONFIG_ROOT = join(
  REPO_ROOT,
  'CypressFHF/fhf-dashboards/cypress/configs/ui'.split('/').join('/')
);

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};

function fail(message) {
  console.error(`selector-drift: ${message}`);
  process.exit(2);
}

// Provenance matters more than it looks. The first baseline here was built from whatever the
// local fhf-dashboards checkout happened to be on (master), while the E2E suite runs against dev
// — and the two differ by ~90 selectors, five of which master calls dead and dev still emits.
// --app-ref/--app-sha let the caller state the revision explicitly when the source was exported
// (git archive) rather than checked out.
function appRevision(srcRoot) {
  const declaredRef = option('app-ref');
  const declaredSha = option('app-sha');
  if (declaredRef || declaredSha) {
    return { ref: declaredRef ?? 'unknown', sha: declaredSha ?? 'unknown' };
  }
  try {
    const cwd = dirname(srcRoot);
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    const ref = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).trim();
    return { sha, ref };
  } catch {
    return { sha: 'unknown', ref: 'unknown' };
  }
}

// ── which configs reference which selector ───────────────────────────────────
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function walkConfigs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkConfigs(full, out);
    else if (/\.(js|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function configReferences() {
  const refs = new Map(); // selector -> [config path]
  for (const file of walkConfigs(UI_CONFIG_ROOT)) {
    const rel = relative(REPO_ROOT, file).split('\\').join('/');
    for (const selector of declaredSelectors(stripComments(readFileSync(file, 'utf8')))) {
      if (!refs.has(selector)) refs.set(selector, []);
      refs.get(selector).push(rel);
    }
  }
  return refs;
}

// ── rename heuristic ─────────────────────────────────────────────────────────
// A removed selector and an added one are rename candidates when their kebab tokens
// overlap heavily. Deliberately a HINT, not a conclusion: only reading both components
// can confirm a rename, and sometimes the honest answer is that the element is gone and
// the assertion belongs on the intercepted response instead.
const RENAME_MIN_OVERLAP = 0.5;

function tokens(selector) {
  return new Set(selector.toLowerCase().split(/[-_\s.]+/).filter(Boolean));
}

function similarity(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  const shared = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : shared / union;
}

function renameCandidates(removed, added) {
  const out = {};
  for (const gone of removed) {
    const ranked = added
      .map((candidate) => ({ candidate, score: similarity(gone, candidate) }))
      .filter((entry) => entry.score >= RENAME_MIN_OVERLAP)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (ranked.length > 0) out[gone] = ranked;
  }
  return out;
}

// ── self-check ───────────────────────────────────────────────────────────────
// node scripts/harness/check-selector-drift.mjs --self-check
// Runs before app-source resolution so it works on a machine with no app checkout.
if (flag('self-check')) {
  const { deepStrictEqual, strictEqual } = await import('assert');

  strictEqual(similarity('dashboard-item-count', 'dashboard-item-count'), 1, 'identical = 1');
  strictEqual(similarity('alpha', 'beta'), 0, 'disjoint = 0');

  // The real rename this tool exists to surface early.
  const hits = renameCandidates(
    ['dashboard-item-count'],
    ['dashboard-record-count', 'totally-unrelated-thing']
  );
  deepStrictEqual(
    Object.keys(hits),
    ['dashboard-item-count'],
    'a near-match rename must be offered'
  );
  strictEqual(
    hits['dashboard-item-count'][0].candidate,
    'dashboard-record-count',
    'the closest candidate ranks first'
  );

  // A removal with no plausible successor must NOT invent one.
  deepStrictEqual(
    renameCandidates(['notification-bell'], ['table-body-row']),
    {},
    'unrelated additions are not rename candidates'
  );

  console.log('check-selector-drift self-check: OK');
  process.exit(0);
}

// ── app source ───────────────────────────────────────────────────────────────
const appSrc = option('app-src') ?? resolveAppSourceRoot();
if (!appSrc || !existsSync(appSrc)) {
  fail(
    'application source not found. Pass --app-src <fhf-dashboards/src>, or configure ' +
      'consumerRoot in .harness/workspace.local.json.'
  );
}

// ── build ────────────────────────────────────────────────────────────────────
const index = buildAppSelectorIndex(appSrc);
const revision = appRevision(appSrc);
const current = {
  literals: [...index.literals].sort(),
  prefixes: [...index.prefixes].sort(),
  // Static tails of leading-interpolation templates (`${field}-slider-wrapper`). Omitting
  // these from the inventory silently reinstated the false positives the index was fixed to
  // avoid, because the gate reads the inventory rather than app source.
  suffixes: [...(index.suffixes ?? [])].sort(),
};

if (flag('update')) {
  mkdirSync(dirname(INVENTORY), { recursive: true });

  // verifiedLiterals is hand-maintained and must survive a regenerate. It holds selectors
  // confirmed alive by reading app source but NOT derivable by the index — specifically values
  // built from a pure-interpolation template like GenericFinalFormField.jsx's
  // data-cy={`${component}-${name}`}, which yields neither a usable prefix nor suffix. Without
  // it, those read as dead forever and the next person "fixes" a working selector.
  let verifiedLiterals = [];
  if (existsSync(INVENTORY)) {
    try {
      verifiedLiterals = JSON.parse(readFileSync(INVENTORY, 'utf8')).verifiedLiterals ?? [];
    } catch { /* regenerating from scratch */ }
  }

  writeFileSync(
    INVENTORY,
    `${JSON.stringify(
      {
        $comment: [
          'Inventory of every data-cy the application can emit, from fhf-dashboards/src.',
          'Refresh with: node scripts/harness/check-selector-drift.mjs --update',
          'Refreshing ACCEPTS the current application contract — only do it after triaging',
          'the drift report, never to make a failing nightly go green.',
          'verifiedLiterals is hand-maintained, preserved across refreshes, and holds selectors',
          'proven alive by source reading that static analysis cannot derive. Each entry needs a',
          'file:line justification in the config that declares it.',
        ],
        appRef: revision.ref,
        appSha: revision.sha,
        generatedAt: new Date().toISOString().slice(0, 10),
        verifiedLiterals,
        ...current,
      },
      null,
      2
    )}\n`
  );
  console.log(
    `selector-drift: inventory updated from ${revision.ref}@${revision.sha.slice(0, 9)} — ` +
      `${current.literals.length} literals, ${current.prefixes.length} prefixes`
  );
  process.exit(0);
}

if (!existsSync(INVENTORY)) {
  fail('no inventory yet. Create the baseline with --update, review it, and commit it.');
}

const previous = JSON.parse(readFileSync(INVENTORY, 'utf8'));
const before = new Set(previous.literals ?? []);
const after = new Set(current.literals);

const removed = [...before].filter((value) => !after.has(value)).sort();
const added = [...after].filter((value) => !before.has(value)).sort();

const refs = configReferences();
const removedAndReferenced = removed.filter((value) => refs.has(value));
const removedUnreferenced = removed.filter((value) => !refs.has(value));
const renames = renameCandidates(removedAndReferenced, added);

// ── report ───────────────────────────────────────────────────────────────────
const lines = [];
const say = (line = '') => lines.push(line);

say(`# Selector drift — ${previous.appRef}@${(previous.appSha ?? '').slice(0, 9)} → ${revision.ref}@${revision.sha.slice(0, 9)}`);
say();
say(`- baseline: ${before.size} selectors (recorded ${previous.generatedAt ?? 'unknown'})`);
say(`- current:  ${after.size} selectors`);
say(`- removed:  ${removed.length} (${removedAndReferenced.length} still referenced by a Cypress config)`);
say(`- added:    ${added.length}`);
say();

if (removedAndReferenced.length > 0) {
  say('## Removed and still referenced — locator worklist');
  say();
  say('These configs declare a selector the application no longer emits. Every test binding to');
  say('one of them fails with "Expected to find element ... but never found it" — the same message');
  say('an empty grid produces, which is why this needs to be caught here and not in a Cloud run.');
  say();
  for (const selector of removedAndReferenced) {
    say(`### \`${selector}\``);
    for (const file of refs.get(selector)) say(`- declared in \`${file}\``);
    if (renames[selector]) {
      say('- possible rename (verify in app source before applying):');
      for (const { candidate, score } of renames[selector]) {
        say(`  - \`${candidate}\` (${Math.round(score * 100)}% token overlap)`);
      }
    } else {
      say('- no rename candidate — the element may be gone entirely. Consider asserting against');
      say('  the intercepted response instead of the DOM.');
    }
    say();
  }
}

if (removedUnreferenced.length > 0) {
  say('## Removed, not referenced (informational)');
  say();
  say(removedUnreferenced.map((value) => `\`${value}\``).join(', '));
  say();
}

if (added.length > 0) {
  say('## Added (coverage opportunities)');
  say();
  say(added.map((value) => `\`${value}\``).join(', '));
  say();
}

if (removed.length === 0 && added.length === 0) {
  say('No change to the application selector contract.');
  say();
}

say('---');
say('Triage, then accept the new contract with `node scripts/harness/check-selector-drift.mjs --update`.');
say('Do not refresh the inventory to silence this report.');

const report = lines.join('\n');
console.log(report);

if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`, { flag: 'a' });
  } catch {
    /* summary is best-effort */
  }
}

// Only a removed-AND-referenced selector is actionable. Additions and unreferenced removals are
// information; failing on those would train everyone to ignore this job.
process.exit(removedAndReferenced.length > 0 ? 1 : 0);
