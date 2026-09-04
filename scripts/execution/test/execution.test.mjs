import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pathMatches, select, parseArgs } from '../select-impacted.mjs';
import { parseAcceptedEvidence, parseFalseGreenDebt, parseUiCoverage, evaluate } from '../coverage-ratchet.mjs';
import { diagnose, compareVersion } from '../cloud-access-doctor.mjs';
import { specsFromJUnit, specsFromCloudJson } from '../select-failed.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const map = JSON.parse(readFileSync(resolve(HERE, '..', 'impact-map.json'), 'utf8'));

// ── path matching ───────────────────────────────────────────────────────────────

test('directory entries match by path segment, not bare substring', () => {
  assert.equal(pathMatches('src/services/insurance/claim.js', 'src/services/insurance/'), true);
  assert.equal(pathMatches('src/services/insuranceOther.js', 'src/services/insurance/'), false);
});

test('file entries match the exact file and anything beneath it', () => {
  assert.equal(pathMatches('src/routes/titles.routes.tsx', 'src/routes/titles.routes.tsx'), true);
  assert.equal(pathMatches('src/routes/titlesExtra.routes.tsx', 'src/routes/titles.routes.tsx'), false);
});

test('windows separators normalise', () => {
  assert.equal(pathMatches('src\\modules\\titles\\Grid.tsx', 'src/modules/titles/'), true);
});

test('parseArgs rejects an option with no value', () => {
  assert.throws(() => parseArgs(['--repo']), /requires a value/);
});

// ── selection: direct ownership ─────────────────────────────────────────────────

test('a titles-only change selects titles and its observable seams, not the whole portfolio', () => {
  const d = select({ map, repo: 'application', changedPaths: ['src/modules/titles/TitleGrid.tsx'] });
  assert.equal(d.scope, 'impacted');
  assert.equal(d.forcedFull, false);
  assert.ok(d.modules.includes('titles'));
  assert.ok(d.modules.length < Object.keys(map.modules).length, 'must not degenerate to every module');
  assert.match(d.selection.e2e.specPattern, /dashboards\/titles/);
});

test('a loss-mitigation change pulls in the titles and checks seams', () => {
  const d = select({ map, repo: 'application', changedPaths: ['src/services/lossMitigation/repo.js'] });
  assert.ok(d.modules.includes('loss-mitigation'));
  assert.ok(d.modules.includes('titles'), 'repo progression drives title flip type');
  assert.ok(d.modules.includes('checks'), 'invoice accounting and check posting settle the same money');
  assert.ok(d.reasons.some((r) => r.trigger === 'cross-module'));
});

test('seam expansion is lane-aware', () => {
  const backend = select({ map, repo: 'application', changedPaths: ['src/modules/insurance/TotalLoss.tsx'], lane: 'backend' });
  const e2e = select({ map, repo: 'application', changedPaths: ['src/modules/insurance/TotalLoss.tsx'], lane: 'e2e' });
  // insurance -> loss-mitigation is observable in e2e only.
  assert.ok(e2e.modules.includes('loss-mitigation'));
  assert.ok(!backend.modules.includes('loss-mitigation'));
});

test('seam expansion is one hop, not transitive closure', () => {
  const d = select({ map, repo: 'application', changedPaths: ['src/modules/insurance/TotalLoss.tsx'], lane: 'e2e' });
  // insurance -> loss-mitigation exists; loss-mitigation -> titles must NOT be followed.
  assert.ok(d.modules.includes('loss-mitigation'));
  assert.ok(!d.modules.includes('titles'), 'two-hop expansion would degenerate to a full run');
});

// ── selection: escalation rules ─────────────────────────────────────────────────

test('a shared component change escalates to every covered module', () => {
  const d = select({ map, repo: 'application', changedPaths: ['src/components/common/Table.tsx'] });
  assert.equal(d.forcedFull, true);
  assert.equal(d.scope, 'full');
  assert.ok(d.reasons.some((r) => r.trigger === 'shared'));
  assert.ok(d.modules.length >= 13);
});

test('an auth change forces a full run', () => {
  const d = select({ map, repo: 'application', changedPaths: ['src/services/authAxiosInstance.js'] });
  assert.equal(d.forcedFull, true);
  assert.ok(d.reasons.some((r) => r.trigger === 'auth'));
  assert.match(d.selection.e2e.specPattern, /auth\/login\.cy\.js/);
});

test('an unattributable source path forces a full run and is reported, never dropped', () => {
  const d = select({ map, repo: 'application', changedPaths: ['src/somethingBrandNew/widget.tsx'] });
  assert.equal(d.forcedFull, true);
  assert.deepEqual(d.unmapped, ['src/somethingBrandNew/widget.tsx']);
});

test('non-source changes select nothing on their own', () => {
  const d = select({ map, repo: 'application', changedPaths: ['README.md', 'docs/notes.md'] });
  assert.equal(d.forcedFull, false);
  assert.deepEqual(d.modules, []);
  assert.equal(d.selection.e2e.specPattern, '');
});

// ── selection: automation repos ─────────────────────────────────────────────────

test('a changed spec runs itself', () => {
  const spec = 'cypress/tests/fhf-dashboard/e2e/dashboards/titles/general.cy.js';
  const d = select({ map, repo: 'ui-automation', changedPaths: [spec] });
  assert.match(d.selection.e2e.specPattern, /titles\/general\.cy\.js/);
  assert.ok(d.modules.includes('titles'));
});

test('a shared cypress support change escalates to a full lane', () => {
  const d = select({ map, repo: 'ui-automation', changedPaths: ['cypress/support/commands/modules/titles.commands.js'] });
  assert.equal(d.forcedFull, true);
  assert.ok(d.reasons.some((r) => r.trigger === 'automation-shared'));
});

test('backend module paths map to their module; shared backend layers escalate', () => {
  const scoped = select({ map, repo: 'backend-automation', changedPaths: ['tests/repo_invoice/test_repo_invoice.py'] });
  assert.deepEqual(scoped.modules, ['checks', 'loss-mitigation', 'titles'].filter((m) => scoped.modules.includes(m)));
  assert.ok(scoped.selection.backend.pytestPaths.includes('tests/repo_invoice'));

  const shared = select({ map, repo: 'backend-automation', changedPaths: ['api/base_client.py'] });
  assert.equal(shared.forcedFull, true);
});

test('operator module selection is honoured and validated', () => {
  const d = select({ map, repo: 'application', explicitModules: ['unifi'] });
  assert.ok(d.modules.includes('unifi'));
  assert.throws(() => select({ map, repo: 'application', explicitModules: ['nope'] }), /Unknown module key/);
});

test('coverage gaps in the selected set are surfaced', () => {
  const d = select({ map, repo: 'application', changedPaths: ['src/modules/complaints/View.tsx'] });
  const gap = d.gaps.find((g) => g.module === 'complaints');
  assert.ok(gap, 'complaints must be reported as a gap');
  assert.equal(gap.missingE2e, true, 'complaints has no e2e specs in the working tree');
  assert.equal(gap.missingBackend, true, 'complaints has no backend suite in the working tree');
});

test('smoke selection never exceeds the committed smoke set', () => {
  const all = new Set(Object.values(map.modules).flatMap((m) => m.smokeSpecs).concat(map.auth.smokeSpecs));
  const d = select({ map, repo: 'application', changedPaths: ['src/components/common/Table.tsx'] });
  for (const glob of d.selection.smoke.specPattern.split(',').filter(Boolean)) {
    assert.ok(all.has(glob), `${glob} is not a committed smoke glob`);
  }
});

// ── ratchet parsers ─────────────────────────────────────────────────────────────

const LEDGER = `
## Portfolio position

| Evidence status | Rows |
|---|---:|
| Accepted full chain | **0** |
| Backend-only accepted | **1** |
| Partial / not accepted | **6** |
| Mutation not accepted | **6** |
| N/A | **1** |
`;

test('the portfolio table parses through bold markers', () => {
  const parsed = parseAcceptedEvidence(LEDGER);
  assert.deepEqual(parsed, {
    acceptedFullChain: 0,
    backendOnlyAccepted: 1,
    partialNotAccepted: 6,
    mutationNotAccepted: 6,
  });
});

test('a malformed portfolio table throws instead of assuming zero', () => {
  assert.throws(() => parseAcceptedEvidence('| Accepted full chain | **0** |'), /refuses to assume zero/);
});

test('false-green debt reads the generated signals block', () => {
  const debt = parseFalseGreenDebt({
    signals: {
      e2e: { fallbackMarkers: 198, filesContainingDisabledSuites: 0 },
      smoke: { fallbackMarkers: 1, filesContainingDisabledSuites: 1 },
      backend: { totalSkipCalls: 75 },
    },
  });
  assert.equal(debt.e2eFallbackMarkers, 198);
  assert.equal(debt.backendSkipCalls, 75);
  assert.equal(debt.smokeDisabledSuiteFiles, 1);
});

test('ui coverage normalises the array and object payload shapes', () => {
  assert.equal(parseUiCoverage({ views: [{ name: 'titles', percent: 61 }] }).views.titles, 61);
  assert.equal(parseUiCoverage({ views: { titles: { percentage: 61 } } }).views.titles, 61);
});

// ── ratchet verdicts ────────────────────────────────────────────────────────────

const baseline = {
  acceptedEvidence: { acceptedFullChain: 1, backendOnlyAccepted: 1 },
  falseGreenDebt: { e2eFallbackMarkers: 198, backendSkipCalls: 75 },
  uiCoverage: { views: { titles: 60 } },
  uiCoverageFloors: { titles: 50 },
};

test('an unchanged portfolio is GO', () => {
  const r = evaluate({
    baseline,
    current: {
      acceptedEvidence: { acceptedFullChain: 1, backendOnlyAccepted: 1 },
      falseGreenDebt: { e2eFallbackMarkers: 198, backendSkipCalls: 75 },
      uiCoverage: { views: { titles: 60 } },
    },
    allowedViewDriftPoints: 5,
  });
  assert.equal(r.verdict, 'GO');
});

test('losing an accepted chain is NO-GO even with everything else steady', () => {
  const r = evaluate({
    baseline,
    current: {
      acceptedEvidence: { acceptedFullChain: 0, backendOnlyAccepted: 1 },
      falseGreenDebt: { e2eFallbackMarkers: 198, backendSkipCalls: 75 },
      uiCoverage: { views: { titles: 60 } },
    },
    allowedViewDriftPoints: 5,
  });
  assert.equal(r.verdict, 'NO-GO');
  assert.match(r.blocking[0].message, /acceptedFullChain fell from 1 to 0/);
});

test('adding a new skip is NO-GO', () => {
  const r = evaluate({
    baseline,
    current: {
      acceptedEvidence: { acceptedFullChain: 1, backendOnlyAccepted: 1 },
      falseGreenDebt: { e2eFallbackMarkers: 198, backendSkipCalls: 76 },
      uiCoverage: { views: { titles: 60 } },
    },
    allowedViewDriftPoints: 5,
  });
  assert.equal(r.verdict, 'NO-GO');
  assert.match(r.blocking[0].message, /backendSkipCalls rose from 75 to 76/);
});

test('removing debt is GO', () => {
  const r = evaluate({
    baseline,
    current: {
      acceptedEvidence: { acceptedFullChain: 1, backendOnlyAccepted: 1 },
      falseGreenDebt: { e2eFallbackMarkers: 150, backendSkipCalls: 40 },
      uiCoverage: { views: { titles: 60 } },
    },
    allowedViewDriftPoints: 5,
  });
  assert.equal(r.verdict, 'GO');
});

test('a critical view vanishing from the results is NO-GO, not a pass', () => {
  const r = evaluate({
    baseline,
    current: {
      acceptedEvidence: { acceptedFullChain: 1, backendOnlyAccepted: 1 },
      falseGreenDebt: { e2eFallbackMarkers: 198, backendSkipCalls: 75 },
      uiCoverage: { views: {} },
    },
    allowedViewDriftPoints: 5,
  });
  assert.equal(r.verdict, 'NO-GO');
  assert.match(r.blocking[0].message, /absent from this run/);
});

test('a view below its floor is NO-GO; small drift above the floor is tolerated', () => {
  const below = evaluate({
    baseline,
    current: {
      acceptedEvidence: { acceptedFullChain: 1, backendOnlyAccepted: 1 },
      falseGreenDebt: { e2eFallbackMarkers: 198, backendSkipCalls: 75 },
      uiCoverage: { views: { titles: 49 } },
    },
    allowedViewDriftPoints: 5,
  });
  assert.equal(below.verdict, 'NO-GO');

  const drift = evaluate({
    baseline,
    current: {
      acceptedEvidence: { acceptedFullChain: 1, backendOnlyAccepted: 1 },
      falseGreenDebt: { e2eFallbackMarkers: 198, backendSkipCalls: 75 },
      uiCoverage: { views: { titles: 57 } },
    },
    allowedViewDriftPoints: 5,
  });
  assert.equal(drift.verdict, 'GO');
});

// ── cloud access doctor ─────────────────────────────────────────────────────────

const NO_CLIENTS = { cliPath: '/usr/bin/cy-cloud', cliConfigDir: '/nonexistent-cy-cloud', mcpClients: [] };
const findingsFor = (env) => {
  const saved = { ...process.env };
  for (const k of ['CYPRESS_CLOUD_TOKEN', 'CYPRESS_MCP_TOKEN', 'CYPRESS_CLOUD_CLI_TOKEN', 'CYPRESS_RECORD_KEY']) {
    delete process.env[k];
  }
  Object.assign(process.env, env);
  try {
    return diagnose(process.env, NO_CLIENTS);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
};

test('version comparison respects the Node floor', () => {
  assert.equal(compareVersion('v22.22.3', [22, 21, 0]), 1);
  assert.equal(compareVersion('v22.21.0', [22, 21, 0]), 0);
  assert.equal(compareVersion('v20.11.1', [22, 21, 0]), -1);
});

test('an unread CLI token name is a hard failure, not a warning', () => {
  const r = findingsFor({ CYPRESS_CLOUD_CLI_TOKEN: 'x' });
  const f = r.findings.find((x) => x.area === 'naming' && x.level === 'error');
  assert.ok(f, 'must flag the unread name as an error');
  assert.match(f.message, /nothing reads that name/);
});

test("the reported setup — MCP token in the CLI's variable — is diagnosed specifically", () => {
  const r = findingsFor({ CYPRESS_CLOUD_TOKEN: 'mcp-ish', CYPRESS_CLOUD_CLI_TOKEN: 'cli-ish' });
  assert.ok(r.findings.some((f) => f.area === 'naming' && /MCP token was placed/.test(f.message)));
});

test('correct distinct names are reported as no conflict', () => {
  const r = findingsFor({ CYPRESS_CLOUD_TOKEN: 'a', CYPRESS_MCP_TOKEN: 'b' });
  assert.ok(r.findings.some((f) => f.area === 'naming' && f.level === 'ok' && /coexist with no conflict/.test(f.message)));
  assert.ok(!r.findings.some((f) => f.area === 'naming' && f.level === 'error'));
});

test('no credential and no stored login is not usable', () => {
  const r = findingsFor({});
  assert.equal(r.usable, false);
  assert.ok(r.findings.some((f) => f.area === 'cli-auth' && f.level === 'error'));
});

test('an MCP-capable client alone makes Cloud reachable even with no CLI credential', () => {
  const saved = process.env.CYPRESS_CLOUD_TOKEN;
  delete process.env.CYPRESS_CLOUD_TOKEN;
  try {
    const r = diagnose(process.env, { ...NO_CLIENTS, mcpClients: [{ client: 'Cursor', path: '/x/mcp.json' }] });
    assert.equal(r.usable, true);
  } finally {
    if (saved !== undefined) process.env.CYPRESS_CLOUD_TOKEN = saved;
  }
});

test('the doctor never surfaces a token value', () => {
  const secret = 'super-secret-token-value';
  const r = findingsFor({ CYPRESS_CLOUD_TOKEN: secret, CYPRESS_CLOUD_CLI_TOKEN: secret });
  assert.ok(!JSON.stringify(r).includes(secret), 'token value must never appear in the report');
});

test('org integration and rate limits are always stated as undetectable/relevant', () => {
  const r = findingsFor({ CYPRESS_CLOUD_TOKEN: 'a' });
  assert.ok(r.findings.some((f) => f.area === 'org-integration'));
  assert.ok(r.findings.some((f) => f.area === 'limits'));
  assert.ok(r.findings.some((f) => f.area === 'capability' && /UI Coverage/.test(f.message)));
});

// ── ratchet verdicts, continued ─────────────────────────────────────────────────

test('missing UI coverage results are reported as SKIPPED, never silently green', () => {
  const r = evaluate({
    baseline,
    current: {
      acceptedEvidence: { acceptedFullChain: 1, backendOnlyAccepted: 1 },
      falseGreenDebt: { e2eFallbackMarkers: 198, backendSkipCalls: 75 },
      uiCoverage: null,
    },
    allowedViewDriftPoints: 5,
  });
  assert.equal(r.verdict, 'GO');
  assert.ok(r.findings.some((f) => f.verdict === 'SKIPPED'));
});

// --- select-failed + doctor orchestration notes --------------------------------

test('select-failed extracts unique specs from JUnit file attributes', () => {
  const xml = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="a" failures="1" file="cypress/tests/fhf-dashboard/e2e/foo/foo.cy.js">
    <testcase name="x"><failure>boom</failure></testcase>
  </testsuite>
  <testsuite name="b" failures="0" file="cypress/tests/fhf-dashboard/e2e/bar/bar.cy.js"/>
  <testsuite name="c" failures="2" file="cypress/tests/fhf-dashboard/e2e/foo/foo.cy.js">
    <testcase name="y"><failure>boom</failure></testcase>
  </testsuite>
</testsuites>`;
  const specs = specsFromJUnit(xml);
  assert.deepEqual(specs, [
    'cypress/tests/fhf-dashboard/e2e/foo/foo.cy.js',
  ]);
});

test('select-failed reads Cloud test-list JSON shapes', () => {
  const specs = specsFromCloudJson({
    tests: [
      { testId: '1', specPath: 'cypress/tests/fhf-dashboard/e2e/a/a.cy.js' },
      { testId: '2', file: 'cypress/tests/fhf-dashboard/e2e/b/b.cy.js' },
      { testId: '3', specPath: 'cypress/tests/fhf-dashboard/e2e/a/a.cy.js' },
    ],
  });
  assert.deepEqual(specs, [
    'cypress/tests/fhf-dashboard/e2e/a/a.cy.js',
    'cypress/tests/fhf-dashboard/e2e/b/b.cy.js',
  ]);
});

test('doctor always states smart orchestration and mcp auth guidance', () => {
  const r = findingsFor({ CYPRESS_CLOUD_TOKEN: 'a' });
  assert.ok(r.findings.some((f) => f.area === 'smart-orchestration'));
  assert.ok(r.findings.some((f) => f.area === 'mcp-auth'));
});
