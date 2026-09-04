#!/usr/bin/env node
/**
 * coverage-ratchet.mjs — blocking no-regression gate for the FHF QA portfolio.
 *
 * Answers one question with a boolean: "does this change leave the portfolio worse protected
 * than the committed baseline?" GO (exit 0) or NO-GO (exit 1). No LLM, no network, no clock.
 *
 * It deliberately does NOT invent its own coverage definition. It reads the artifacts that
 * already own each fact:
 *
 *   accepted evidence   docs/planning/coverage/fullstack-chain-risk-matrix.md  (Portfolio position table)
 *   false-green debt    docs/evidence/coverage-computed.json                   (signals.*)
 *   ui coverage         a check-ui-coverage.js results JSON                    (per-view percentages)
 *
 * Three ratchets, all "no worse than baseline":
 *
 *   R1 ACCEPTED EVIDENCE   Accepted-full-chain and backend-only-accepted counts may not fall.
 *                          This is the only ratchet that tracks real product protection, so a
 *                          drop is always NO-GO even if every test passes.
 *
 *   R2 FALSE-GREEN DEBT    E2E fallback markers, disabled suites and backend skip calls may not
 *                          rise. This is what stops "add a test that logs Skipping and returns"
 *                          from reading as progress.
 *
 *   R3 UI COVERAGE FLOORS  Every critical view stays at or above its committed floor, and no view
 *                          drops by more than the allowed drift. Structural signal only — it can
 *                          block, but it can never promote a workflow to accepted.
 *
 * Usage:
 *   # write today's numbers as the baseline (review the diff before committing it)
 *   node scripts/execution/coverage-ratchet.mjs snapshot --out scripts/execution/ratchet-baseline.json
 *
 *   # gate a change
 *   node scripts/execution/coverage-ratchet.mjs check \
 *        --baseline scripts/execution/ratchet-baseline.json \
 *        [--ui-coverage reports/ui-coverage/results.json] [--json]
 *
 * Exit codes: 0 = GO, 1 = NO-GO, 2 = usage/config/missing-artifact error.
 *
 * Missing input is never a pass. If an artifact the gate depends on is absent, the gate exits 2
 * so CI fails loudly instead of silently green.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

const DEFAULTS = {
  coverage: 'docs/evidence/coverage-computed.json',
  chain: 'docs/planning/coverage/fullstack-chain-risk-matrix.md',
  baseline: 'scripts/execution/ratchet-baseline.json',
  // A view may wobble this many percentage points run-to-run before it counts as a regression.
  // UI Coverage is sampled from a real browser run, so zero drift would flake constantly.
  allowedViewDriftPoints: 5,
};

// ── readers ─────────────────────────────────────────────────────────────────────

/** Parse the "Portfolio position" table in the chain ledger. Bold-safe, order-independent. */
export function parseAcceptedEvidence(markdown) {
  const rows = {
    acceptedFullChain: null,
    backendOnlyAccepted: null,
    partialNotAccepted: null,
    mutationNotAccepted: null,
  };
  const labels = [
    [/accepted full chain/i, 'acceptedFullChain'],
    [/backend-only accepted/i, 'backendOnlyAccepted'],
    [/partial\s*\/\s*not accepted/i, 'partialNotAccepted'],
    [/mutation not accepted/i, 'mutationNotAccepted'],
  ];
  for (const line of markdown.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    for (const [pattern, key] of labels) {
      if (rows[key] !== null) continue;
      if (!cells.some((c) => pattern.test(c.replace(/\*/g, '')))) continue;
      // Last numeric cell on the row is the count.
      const numeric = cells
        .map((c) => c.replace(/\*/g, '').trim())
        .filter((c) => /^\d+$/.test(c));
      if (numeric.length) rows[key] = Number(numeric[numeric.length - 1]);
    }
  }
  const missing = Object.entries(rows).filter(([, v]) => v === null).map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `Could not read ${missing.join(', ')} from the chain ledger's Portfolio position table. `
      + 'The gate refuses to assume zero: fix the table or the parser.',
    );
  }
  return rows;
}

/** False-green debt straight out of the generated structural inventory. */
export function parseFalseGreenDebt(coverageJson) {
  const s = coverageJson.signals;
  if (!s) throw new Error('coverage-computed.json has no "signals" block');
  const need = (obj, key, where) => {
    const v = obj?.[key];
    if (typeof v !== 'number') throw new Error(`coverage-computed.json missing numeric ${where}.${key}`);
    return v;
  };
  return {
    e2eFallbackMarkers: need(s.e2e, 'fallbackMarkers', 'signals.e2e'),
    e2eDisabledSuiteFiles: need(s.e2e, 'filesContainingDisabledSuites', 'signals.e2e'),
    smokeFallbackMarkers: need(s.smoke, 'fallbackMarkers', 'signals.smoke'),
    smokeDisabledSuiteFiles: need(s.smoke, 'filesContainingDisabledSuites', 'signals.smoke'),
    backendSkipCalls: need(s.backend, 'totalSkipCalls', 'signals.backend'),
  };
}

/**
 * Normalise a check-ui-coverage.js / extract-cloud-results payload into { view: percent }.
 * Shape varies by Cloud API version, so accept the documented variants rather than guessing one.
 */
export function parseUiCoverage(payload) {
  const views = {};
  const candidates = payload?.views ?? payload?.data?.views ?? payload?.uiCoverage?.views ?? null;
  if (Array.isArray(candidates)) {
    for (const v of candidates) {
      const name = v.name ?? v.view ?? v.displayName;
      const pct = v.percent ?? v.percentage ?? v.coverage ?? v.score;
      if (name != null && typeof pct === 'number') views[String(name)] = pct;
    }
  } else if (candidates && typeof candidates === 'object') {
    for (const [name, v] of Object.entries(candidates)) {
      const pct = typeof v === 'number' ? v : (v?.percent ?? v?.percentage ?? v?.coverage);
      if (typeof pct === 'number') views[name] = pct;
    }
  }
  const overall = payload?.percent ?? payload?.overall ?? payload?.data?.percent ?? null;
  return { views, overall: typeof overall === 'number' ? overall : null };
}

// ── ratchets ────────────────────────────────────────────────────────────────────

export function evaluate({ baseline, current, allowedViewDriftPoints }) {
  const findings = [];
  const fail = (ratchet, message) => findings.push({ ratchet, verdict: 'NO-GO', message });
  const pass = (ratchet, message) => findings.push({ ratchet, verdict: 'GO', message });

  // R1 — accepted evidence may not fall.
  for (const key of ['acceptedFullChain', 'backendOnlyAccepted']) {
    const was = baseline.acceptedEvidence[key];
    const now = current.acceptedEvidence[key];
    if (now < was) fail('R1-accepted-evidence', `${key} fell from ${was} to ${now}`);
    else pass('R1-accepted-evidence', `${key} ${was} → ${now}`);
  }

  // R2 — false-green debt may not rise.
  for (const [key, was] of Object.entries(baseline.falseGreenDebt)) {
    const now = current.falseGreenDebt[key];
    if (now > was) fail('R2-false-green-debt', `${key} rose from ${was} to ${now}`);
    else pass('R2-false-green-debt', `${key} ${was} → ${now}`);
  }

  // R3 — UI coverage floors and per-view drift.
  if (!current.uiCoverage) {
    findings.push({
      ratchet: 'R3-ui-coverage',
      verdict: 'SKIPPED',
      message: 'no UI Coverage results supplied; the lane buildspec gate remains the authority for this run',
    });
  } else {
    for (const [view, floor] of Object.entries(baseline.uiCoverageFloors ?? {})) {
      const now = current.uiCoverage.views[view];
      if (typeof now !== 'number') {
        fail('R3-ui-coverage', `critical view "${view}" is absent from this run's results (unstarted or renamed view is not a pass)`);
        continue;
      }
      if (now < floor) fail('R3-ui-coverage', `view "${view}" is ${now}%, below its committed floor of ${floor}%`);
      else pass('R3-ui-coverage', `view "${view}" ${now}% >= floor ${floor}%`);
    }
    for (const [view, was] of Object.entries(baseline.uiCoverage?.views ?? {})) {
      const now = current.uiCoverage.views[view];
      if (typeof now !== 'number') continue;
      const drop = was - now;
      if (drop > allowedViewDriftPoints) {
        fail('R3-ui-coverage', `view "${view}" dropped ${drop.toFixed(1)} points (${was}% → ${now}%), beyond the ${allowedViewDriftPoints}-point allowance`);
      }
    }
  }

  const blocking = findings.filter((f) => f.verdict === 'NO-GO');
  return { verdict: blocking.length ? 'NO-GO' : 'GO', blocking, findings };
}

// ── cli ─────────────────────────────────────────────────────────────────────────

function readJson(path, what) {
  const full = resolve(path);
  if (!existsSync(full)) {
    process.stderr.write(`Missing ${what}: ${full}\nA missing artifact is not a pass.\n`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(full, 'utf8'));
}

function readText(path, what) {
  const full = resolve(path);
  if (!existsSync(full)) {
    process.stderr.write(`Missing ${what}: ${full}\nA missing artifact is not a pass.\n`);
    process.exit(2);
  }
  return readFileSync(full, 'utf8');
}

function collectCurrent(opts) {
  const coverage = readJson(opts.coverage, 'structural inventory (coverage-computed.json)');
  const chain = readText(opts.chain, 'chain ledger (fullstack-chain-risk-matrix.md)');
  const current = {
    capturedFrom: {
      coverage: opts.coverage,
      chain: opts.chain,
      coverageGeneratedAt: coverage.generatedAt ?? null,
    },
    acceptedEvidence: parseAcceptedEvidence(chain),
    falseGreenDebt: parseFalseGreenDebt(coverage),
    uiCoverage: null,
  };
  if (opts.uiCoverage) {
    current.uiCoverage = parseUiCoverage(readJson(opts.uiCoverage, 'UI Coverage results'));
  }
  return current;
}

function parseOpts(argv) {
  const opts = {
    command: argv[0],
    coverage: DEFAULTS.coverage,
    chain: DEFAULTS.chain,
    baseline: DEFAULTS.baseline,
    allowedViewDriftPoints: DEFAULTS.allowedViewDriftPoints,
    json: false,
  };
  for (let i = 1; i < argv.length; i += 1) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === '--coverage') opts.coverage = next();
    else if (t === '--chain') opts.chain = next();
    else if (t === '--baseline') opts.baseline = next();
    else if (t === '--ui-coverage') opts.uiCoverage = next();
    else if (t === '--out') opts.out = next();
    else if (t === '--drift') opts.allowedViewDriftPoints = Number(next());
    else if (t === '--json') opts.json = true;
    else { process.stderr.write(`Unknown option: ${t}\n`); process.exit(2); }
  }
  return opts;
}

const USAGE = `coverage-ratchet.mjs <snapshot|check> [options]

  snapshot  --out <path>            write current numbers as a reviewable baseline
  check     --baseline <path>       compare current numbers to the baseline

  --coverage <path>      default ${DEFAULTS.coverage}
  --chain <path>         default ${DEFAULTS.chain}
  --ui-coverage <path>   optional UI Coverage results JSON
  --drift <points>       per-view allowance, default ${DEFAULTS.allowedViewDriftPoints}
  --json                 machine-readable verdict on stdout
`;

function main() {
  process.chdir(REPO_ROOT);
  const opts = parseOpts(process.argv.slice(2));

  if (opts.command === 'snapshot') {
    const current = collectCurrent(opts);
    const snapshot = {
      schema: 'fhf-coverage-ratchet/v1',
      note: 'Baseline for the no-regression gate. Raise it deliberately in a reviewed PR; never lower it to make CI pass.',
      capturedFrom: current.capturedFrom,
      acceptedEvidence: current.acceptedEvidence,
      falseGreenDebt: current.falseGreenDebt,
      uiCoverage: current.uiCoverage,
      uiCoverageFloors: current.uiCoverage
        ? Object.fromEntries(Object.keys(current.uiCoverage.views).map((v) => [v, 0]))
        : {},
      uiCoverageFloorsNote:
        'Floors start at 0 so the first commit cannot false-block. Set each critical view to its lane floor '
        + '(e2e 50 / smoke 30 per the buildspecs) once one clean run exists, then raise only from run data.',
    };
    const out = resolve(opts.out ?? 'scripts/execution/ratchet-baseline.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
    process.stdout.write(`Baseline written: ${out}\n`);
    return;
  }

  if (opts.command !== 'check') {
    process.stdout.write(USAGE);
    process.exit(opts.command ? 2 : 0);
  }

  const baseline = readJson(opts.baseline, 'ratchet baseline');
  const current = collectCurrent(opts);
  const result = evaluate({ baseline, current, allowedViewDriftPoints: opts.allowedViewDriftPoints });

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ ...result, baseline: opts.baseline, current }, null, 2)}\n`);
  } else {
    process.stdout.write(`\nCoverage ratchet: ${result.verdict}\n\n`);
    for (const f of result.findings) {
      const mark = f.verdict === 'NO-GO' ? 'x' : f.verdict === 'SKIPPED' ? '-' : 'ok';
      process.stdout.write(`  [${mark}] ${f.ratchet}: ${f.message}\n`);
    }
    if (result.blocking.length) {
      process.stdout.write('\nBlocking findings must be fixed, or the baseline changed in a reviewed PR with a stated reason.\n');
    }
    process.stdout.write('\n');
  }
  process.exit(result.verdict === 'GO' ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
