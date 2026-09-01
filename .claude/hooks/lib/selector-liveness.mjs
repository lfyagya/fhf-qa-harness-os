// Selector liveness - is a data-cy declared in cypress/configs/ui/** still emitted by the app?
//
// configs/ui/** is a contract with fhf-dashboards, but it was a one-way contract: nothing
// failed when the app side disappeared. TABLE_UI.ITEM_COUNT ('[data-cy="dashboard-item-count"]')
// survived the 2026-08-17 cleanup that removed its callers, stayed available for rebinding, got
// rebound by five Loss Mitigation filter specs, and produced 75 unpassable assertions in Cloud
// run 754. This module closes that loop.
//
// Deliberately conservative: it only reports a selector that matches NOTHING in app source -
// no literal, no template prefix, no template suffix. A noisy selector gate gets switched off,
// and a gate that is off catches nothing.
//
// ASCII-only punctuation on purpose: this file was corrupted once by a PowerShell
// Set-Content round-trip that mangled em-dashes into mojibake, so it avoids non-ASCII.
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_EXT = /\.(tsx|jsx|ts|js)$/;
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '__tests__']);

// Shortest static prefix we will trust from a dynamic template. `data-cy={`${x}-${y}`}` has no
// static prefix at all and matches nothing; a 1-2 char prefix would match almost everything.
const MIN_PREFIX = 3;
// Suffixes need to be longer: '-btn' or '-input' alone would match half the config surface.
const MIN_SUFFIX = 6;

/**
 * Resolve <consumerRoot>/fhf-dashboards/src from the harness workspace file.
 * Returns null when the app checkout is not configured or not present - the caller
 * must then skip the check rather than fail. A developer without the sibling
 * checkout must not be blocked from editing configs.
 */
export function resolveAppSourceRoot() {
  const workspaceFile = join(HERE, '..', '..', '..', '.harness', 'workspace.local.json');
  if (!existsSync(workspaceFile)) return null;
  let consumerRoot;
  try {
    consumerRoot = JSON.parse(readFileSync(workspaceFile, 'utf8')).consumerRoot;
  } catch {
    return null;
  }
  if (!consumerRoot) return null;
  const srcRoot = join(consumerRoot, 'fhf-dashboards', 'src');
  return existsSync(srcRoot) ? srcRoot : null;
}

/**
 * Text of every `data-cy={ ... }` expression in a source file.
 *
 * Needed because the value is not always a bare literal. NewModalTextArea.tsx:14 renders
 *   data-cy={name ? `modal-textarea-${name}` : 'modal-textarea'}
 * and regexes anchored on the character after `{` see neither branch. Scanning the balanced
 * expression and then harvesting every literal inside it covers ternaries, `||` fallbacks and
 * anything else, instead of adding one regex per syntax.
 *
 * Quote and template spans are treated as opaque so braces inside them (notably `${...}`)
 * do not unbalance the scan.
 *
 * @param {string} src
 * @returns {string[]}
 */
function skipQuoted(src, start, quote) {
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

function skipTemplate(src, start) {
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === '`') return i + 1;
    if (src[i] === '$' && src[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '`') { i = skipTemplate(src, i); continue; }
        if (ch === '"' || ch === "'") { i = skipQuoted(src, i, ch); continue; }
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return i;
}

function dataCyExpressions(src) {
  const out = [];
  const MARKER = 'data-cy={';
  let at = src.indexOf(MARKER);

  while (at !== -1) {
    let i = at + MARKER.length;
    let depth = 1;

    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '"' || ch === "'") { i = skipQuoted(src, i, ch); continue; }
      if (ch === '`') { i = skipTemplate(src, i); continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      i += 1;
    }
    out.push(src.slice(at + MARKER.length, i - 1));
    at = src.indexOf(MARKER, i);
  }
  return out;
}

/** Record a template's usable static head and tail. */
function indexTemplate(tpl, prefixes, suffixes) {
  const head = tpl.split('${')[0];
  if (head.length >= MIN_PREFIX) prefixes.add(head);
  if (tpl.includes('${')) {
    const tail = tpl.slice(tpl.lastIndexOf('}') + 1);
    if (tail.length >= MIN_SUFFIX) suffixes.add(tail);
  }
}

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (SRC_EXT.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Index every data-cy the application can emit.
 *
 * literals  - data-cy="x" / data-cy='x' / data-cy={'x'} / 'data-cy': 'x'
 * prefixes  - static head of a template: data-cy={`row-${id}`} contributes 'row-'
 * suffixes  - static tail of a template: data-cy={`${field}-slider-wrapper`} contributes
 *             '-slider-wrapper'
 *
 * Both template ends are needed. Shared components name their instances by interpolating
 * FIRST (Switch.jsx, Slider.tsx, DropdownTs.tsx, MultiSelectTs.tsx, meatballMenu.tsx,
 * ActionBar.tsx), so a head-only index reported 8 live selectors as dead - among them
 * priority-slider-wrapper, is_not_delinquent-switch-input and contract_state-dropdown-input.
 *
 * A template that is pure interpolation (`${a}-${b}`) still contributes nothing, correctly:
 * it can produce anything, and indexing it would make the whole check vacuous.
 *
 * @param {string} srcRoot
 * @returns {{literals: Set<string>, prefixes: string[], suffixes: string[]}}
 */
export function buildAppSelectorIndex(srcRoot) {
  const literals = new Set();
  const prefixes = new Set();
  const suffixes = new Set();

  for (const file of walk(srcRoot)) {
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    if (!src.includes('data-cy')) continue;

    // JSX attribute: data-cy="x"  data-cy='x'  data-cy={'x'}
    for (const m of src.matchAll(/data-cy=(?:\{\s*)?["']([^"'`{}\n]+)["']/g)) {
      literals.add(m[1]);
    }
    // Object property: 'data-cy': 'x'   "data-cy": "x"
    // Used by components that spread a props object rather than write the attribute inline
    // (MultiSelectTs.tsx:102, CommonDropdown.tsx:46). Missing this form made the first draft
    // report multi-select-toggle and dropdown-toggle dead when both render on every page.
    for (const m of src.matchAll(/["']data-cy["']\s*:\s*["']([^"'`\n]+)["']/g)) {
      literals.add(m[1]);
    }
    // Prop form: dataCy="x" / dataCy={'x'} / dataCy: 'x', handed to a component that renders
    // data-cy={dataCy} downstream. PaymentBreakdownGridTable.tsx:98,110 does exactly this, so
    // payment-breakdown-row and payment-breakdown-additional-row read as dead until this form
    // was indexed. dataCyPrefix behaves the same way but names a family, so it feeds prefixes.
    for (const m of src.matchAll(/\bdataCy\s*[=:]\s*\{?\s*["']([^"'`\n]+)["']/g)) {
      literals.add(m[1]);
    }
    for (const m of src.matchAll(/\bdataCyPrefix\s*[=:]\s*\{?\s*["']([^"'`\n]+)["']/g)) {
      if (m[1].length >= MIN_PREFIX) prefixes.add(m[1]);
    }
    // Template forms, both spellings.
    for (const m of src.matchAll(/(?:data-cy=\{\s*|["']data-cy["']\s*:\s*)`([^`]*)`/g)) {
      indexTemplate(m[1], prefixes, suffixes);
    }
    // Compound expressions: ternaries, || fallbacks, anything with more than one candidate.
    // Harvests every literal and template inside the braced expression.
    for (const expr of dataCyExpressions(src)) {
      for (const m of expr.matchAll(/(['"])([^'"`\n]+)\1/g)) literals.add(m[2]);
      for (const m of expr.matchAll(/`([^`]*)`/g)) indexTemplate(m[1], prefixes, suffixes);
    }
  }
  return { literals, prefixes: [...prefixes], suffixes: [...suffixes] };
}

/**
 * Load the committed inventory produced by scripts/harness/check-selector-drift.mjs --update.
 *
 * This, not the local working tree, is what the author-time gate checks against. Scanning the
 * local fhf-dashboards checkout makes the result depend on whichever branch that checkout is
 * parked on: master and dev differ by ~90 selectors, and five that master has dropped are still
 * emitted on dev - the branch the E2E suite actually runs against. A committed inventory is the
 * same for every developer and for CI, needs no app checkout at all, and is refreshed on a known
 * cadence by the nightly drift job.
 *
 * @param {string} inventoryPath
 * @returns {{literals: Set<string>, prefixes: string[], suffixes: string[],
 *            appRef: string, appSha: string}|null}
 */
export function loadSelectorInventory(inventoryPath) {
  if (!existsSync(inventoryPath)) return null;
  try {
    const data = JSON.parse(readFileSync(inventoryPath, 'utf8'));
    if (!Array.isArray(data.literals)) return null;
    return {
      // verifiedLiterals are folded in as ordinary literals: selectors confirmed alive by
      // reading app source, but built from a pure-interpolation template the index cannot
      // learn from (see the inventory's own $comment).
      literals: new Set([...data.literals, ...(data.verifiedLiterals ?? [])]),
      prefixes: data.prefixes ?? [],
      suffixes: data.suffixes ?? [],
      appRef: data.appRef ?? 'unknown',
      appSha: data.appSha ?? 'unknown',
    };
  } catch {
    return null;
  }
}

/**
 * data-cy values declared in a Cypress UI config's source.
 * Values containing an interpolation are skipped - the config builds them at call time
 * (e.g. `tanstack-table-cell-${columnKey}-${rowIndex}`) so there is no fixed string to find.
 *
 * @param {string} configSource - config file contents, comments already stripped
 * @returns {string[]}
 */
export function declaredSelectors(configSource) {
  return [
    ...new Set(
      [...configSource.matchAll(/data-cy=\\?"([^"\\\n]+)\\?"/g)]
        .map((m) => m[1])
        .filter((value) => !value.includes('${'))
    ),
  ];
}

/**
 * Selectors this config declares that the application never emits.
 *
 * @param {string} configSource - config file contents, comments already stripped
 * @param {{literals: Set<string>, prefixes: string[], suffixes?: string[]}} index
 * @returns {string[]}
 */
export function findDeadSelectors(configSource, index) {
  const suffixes = index.suffixes ?? [];
  return declaredSelectors(configSource).filter(
    (value) =>
      !index.literals.has(value) &&
      !index.prefixes.some((prefix) => value.startsWith(prefix)) &&
      !suffixes.some((suffix) => value.endsWith(suffix))
  );
}

// Self-check: node .claude/hooks/lib/selector-liveness.mjs
// Covers the emit forms that actually caused false results: the object-property form (missed by
// the first draft), the leading-interpolation template (missed by the second, which reported
// 8 live selectors dead), plus an interpolated config value and the real dashboard-item-count
// regression this module was written for.
if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const { strictEqual, deepStrictEqual } = await import('assert');
  const { mkdtempSync, writeFileSync } = await import('fs');
  const { tmpdir } = await import('os');

  const dir = mkdtempSync(join(tmpdir(), 'selector-liveness-'));
  writeFileSync(
    join(dir, 'App.tsx'),
    [
      'const a = <div data-cy="table-body-row" />;',           // JSX attribute
      "const b = { 'data-cy': 'multi-select-toggle' };",        // object property
      'const c = <td data-cy={`tanstack-cell-${key}`} />;',     // template, usable prefix
      'const d = <i data-cy={`${field}-slider-wrapper`} />;',   // template, usable suffix
      'const e = <i data-cy={`${x}-${y}`} />;',                 // pure interpolation, unusable
      'const f = <Grid dataCy="payment-breakdown-row" />;',     // prop drilled to data-cy
      // Ternary: neither branch sits immediately after the `{`.
      'const g = <textarea data-cy={n ? `modal-textarea-${n}` : "modal-textarea"} />;',
    ].join('\n')
  );
  const index = buildAppSelectorIndex(dir);

  strictEqual(index.literals.has('table-body-row'), true, 'JSX attribute form must index');
  strictEqual(index.literals.has('multi-select-toggle'), true, 'object-property form must index');
  strictEqual(index.prefixes.includes('tanstack-cell-'), true, 'static template head must index');
  strictEqual(index.suffixes.includes('-slider-wrapper'), true, 'static template tail must index');
  strictEqual(index.prefixes.includes(''), false, 'a pure-interpolation template yields no prefix');
  strictEqual(index.literals.has('payment-breakdown-row'), true, 'dataCy prop form must index');
  strictEqual(index.literals.has('modal-textarea'), true, 'ternary else-branch must index');
  strictEqual(index.prefixes.includes('modal-textarea-'), true, 'ternary template must index');

  const config = [
    "  ROW: '[data-cy=\"table-body-row\"]',",                        // live, literal
    "  TOGGLE: '[data-cy=\"multi-select-toggle\"]',",                // live, object-property
    "  CELL: '[data-cy=\"tanstack-cell-status\"]',",                 // live, via prefix
    "  PRIORITY: '[data-cy=\"priority-slider-wrapper\"]',",          // live, via suffix
    '  BUILT: (k) => `[data-cy="tanstack-cell-${k}"]`,',             // interpolated -> skipped
    "  COUNT: '[data-cy=\"dashboard-item-count\"]',",                // dead - the run 754 bug
  ].join('\n');

  deepStrictEqual(
    findDeadSelectors(config, index),
    ['dashboard-item-count'],
    'only the selector the app never emits is dead'
  );

  console.log('selector-liveness self-check: OK');
}
