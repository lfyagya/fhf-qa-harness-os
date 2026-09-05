#!/usr/bin/env node
/**
 * Regression test for validate-cypress-rules.mjs CI mode.
 *
 * Exists because the CI job it backs was a no-op from 2026-08-06 to 2026-08-28: the workflow
 * called the validator with --base-ref, the validator only ever read a stdin tool payload, and
 * every PR passed without a single file being opened. A green check that inspects nothing is
 * worse than no check, so this asserts the three behaviours that make it real:
 *
 *   1. a violation the branch INTRODUCES fails the build (exit 2)
 *   2. a violation that already existed on the base ref does NOT fail it (exit 0)
 *   3. a clean branch passes (exit 0)
 *
 * Runs against a throwaway git repository in the OS temp dir — it never touches this checkout.
 *
 * Usage: node scripts/harness/test-cypress-rules-ci.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
// `repo` (the throwaway git checkout) and `join`/`dirname` are used by the ui-config case below.
import { tmpdir } from 'os';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { strictEqual, ok } from 'assert';

const VALIDATOR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '.claude',
  'hooks',
  'validate-cypress-rules.mjs'
);

const SPEC_PATH = 'CypressFHF/fhf-dashboards/cypress/tests/fhf-dashboard/e2e/demo/demo.cy.js';

// A spec that satisfies the always-on rules, so only the violation under test differs.
const cleanSpec = `
describe('demo', { testIsolation: true }, () => {
  beforeEach(() => {
    cy.ensureAuthenticated();
  });
  it('works', () => {
    cy.get('[data-cy="table-body-row"]').should('have.length.gt', 0);
  });
});
`;

// Rule: specs must not register their own intercepts.
const withRawIntercept = cleanSpec.replace(
  'cy.ensureAuthenticated();',
  "cy.ensureAuthenticated();\n    cy.intercept('GET', '/api/things').as('things');"
);

// Rule: specs must not hardcode a route in cy.visit().
const withLiteralRoute = cleanSpec.replace(
  "cy.get('[data-cy=\"table-body-row\"]')",
  "cy.visit('/loss-mitigation/repo-invoice');\n    cy.get('[data-cy=\"table-body-row\"]')"
);

const repo = mkdtempSync(join(tmpdir(), 'cypress-rules-ci-'));
// stderr ignored: on Windows git emits a CRLF autocrlf warning per add, which buries the
// actual check output. Failures still surface via a non-zero exit, which execFileSync throws on.
const git = (...args) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function writeSpec(content) {
  const full = join(repo, SPEC_PATH);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** Run CI mode in the temp repo; returns { status, output }. */
function runCi(baseRef) {
  const result = spawnSync(process.execPath, [VALIDATOR, '--base-ref', baseRef], {
    cwd: repo,
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${label}\n       ${error.message}`);
  }
}

try {
  git('init', '--quiet', '--initial-branch=base');
  git('config', 'user.email', 'harness@example.invalid');
  git('config', 'user.name', 'harness');
  git('config', 'commit.gpgsign', 'false');

  // Base ref already carries one violation — the tree's real situation.
  writeSpec(withRawIntercept);
  git('add', '-A');
  git('commit', '--quiet', '-m', 'base with a pre-existing violation');

  git('checkout', '--quiet', '-b', 'feature');

  console.log('validate-cypress-rules.mjs CI mode:');

  check('carries a pre-existing violation without failing', () => {
    writeSpec(withRawIntercept.replace("it('works'", "it('works a bit more'"));
    git('add', '-A');
    git('commit', '--quiet', '-m', 'touch the file, same violation');
    const { status, output } = runCi('base');
    ok(/PRE-EXISTING/.test(output), 'expected the carried violation to be reported');
    strictEqual(status, 0, `expected exit 0, got ${status}\n${output}`);
  });

  check('fails on a violation the branch introduces', () => {
    writeSpec(withLiteralRoute);
    git('add', '-A');
    git('commit', '--quiet', '-m', 'introduce a literal route');
    const { status, output } = runCi('base');
    ok(/introduced/i.test(output), 'expected the new violation to be labelled introduced');
    ok(/literal route/.test(output), 'expected the cy.visit rule to fire');
    strictEqual(status, 2, `expected exit 2, got ${status}\n${output}`);
  });

  check('passes a clean branch', () => {
    writeSpec(cleanSpec);
    git('add', '-A');
    git('commit', '--quiet', '-m', 'clean it up');
    const { status } = runCi('base');
    strictEqual(status, 0, `expected exit 0, got ${status}`);
  });

  // The bug this whole file exists for: the validator must not silently succeed when
  // invoked with --base-ref but no stdin payload.
  check('does not silently pass when there is nothing on stdin', () => {
    writeSpec(withLiteralRoute);
    git('add', '-A');
    git('commit', '--quiet', '-m', 'reintroduce');
    const result = spawnSync(process.execPath, [VALIDATOR, '--base-ref', 'base'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    strictEqual(
      result.status,
      2,
      'with no stdin, CI mode must still inspect files and fail — this is the 2026-08 regression'
    );
  });

  // Guardrail false positive, 2026-08-28: titles/general.cy.js documents its intercept lifecycle
  // in an @fileoverview that names cy.apiInterceptAll. The rule matched the comment and flagged a
  // file whose executable code had no intercept at all. Both code-matching rules now read
  // comment-stripped source.
  check('does not flag an intercept named only in a comment', () => {
    const documented = cleanSpec.replace(
      "describe('demo'",
      "// Intercept lifecycle: beforeEach registers aliases via cy.apiInterceptAll\n// and cy.visit('/some/path') is described here too.\ndescribe('demo'"
    );
    writeSpec(documented);
    git('add', '-A');
    git('commit', '--quiet', '-m', 'document the lifecycle in a comment');
    const { status, output } = runCi('base');
    ok(!/raw intercept/.test(output), 'a comment mentioning cy.apiInterceptAll must not flag');
    ok(!/literal route/.test(output), "a comment mentioning cy.visit('/...') must not flag");
    strictEqual(status, 0, `expected exit 0, got ${status}\n${output}`);
  });

  // CI mode originally passed a repo-RELATIVE path to analyze() while passing an absolute one for
  // the sibling-exclusion compare. The duplicate-selector check derives its scan root from the
  // former, so the exclusion never matched and every ui config reported itself as its own
  // duplicate — inflating the carried count and inventing one "introduced" violation.
  check('does not report a ui config as duplicating itself', () => {
    const cfgPath = 'CypressFHF/fhf-dashboards/cypress/configs/ui/modules/demo/demo.ui.js';
    const full = join(repo, cfgPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(
      full,
      "export const DEMO_UI = Object.freeze({\n  ROW: '[data-cy=\"demo-only-row\"]',\n});\n"
    );
    git('add', '-A');
    git('commit', '--quiet', '-m', 'add a ui config with a unique selector');
    const { output } = runCi('base');
    // Assert on the DUPLICATE rule only. The selector is deliberately absent from the app, so
    // the liveness rule fires too — that is correct and unrelated to the bug under test, and
    // asserting on exit status here would just be asserting on liveness.
    ok(
      !/already declared in/.test(output),
      `a config declaring a selector once must not be reported as duplicating itself:\n${output}`
    );
  });

  // A blank --base-ref (workflow interpolating github.base_ref on a non-PR event) must not
  // degrade into hook mode, which would read no stdin and exit 0 — the same silent pass.
  check('refuses a blank --base-ref instead of passing', () => {
    const result = spawnSync(process.execPath, [VALIDATOR, '--base-ref'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    strictEqual(result.status, 2, 'a missing base ref must fail, not silently succeed');
  });
} finally {
  rmSync(repo, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('cypress-rules CI mode: OK');
