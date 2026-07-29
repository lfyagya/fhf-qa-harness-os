#!/usr/bin/env node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const publish = path.join(SCRIPT_DIR, 'publish-route-contract.mjs');
const validate = path.join(SCRIPT_DIR, 'validate-cypress-route-contract.mjs');
const root = mkdtempSync(path.join(tmpdir(), 'route-contract-'));
const appRoutes = path.join(root, 'app-routes.js');
const cypressRoutes = path.join(root, 'cypress-routes.js');
const contract = path.join(root, 'application-routes.contract.json');
const failures = [];

function run(script) {
  return spawnSync('node', [script, '--source', appRoutes, '--contract', contract, '--output', contract, '--cypress-routes', cypressRoutes], {
    encoding: 'utf8',
  });
}

function expect(name, result, expectedCode, expectedText = '') {
  const output = `${result.stdout}\n${result.stderr}`;
  const passed = result.status === expectedCode && (!expectedText || output.includes(expectedText));
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}`);
  if (!passed) failures.push(`${name}: exit ${result.status}; ${output.trim()}`);
}

function writeFixture(appSource, cypressSource) {
  writeFileSync(appRoutes, appSource, 'utf8');
  writeFileSync(cypressRoutes, cypressSource, 'utf8');
}

mkdirSync(root, { recursive: true });
writeFixture(
  "export const section = { ROOT: 'titles', CURRENT: 'remarketing-classic', LEGACY: 'remarketing' };\nconst routes = { TITLES_REMARKETING: `/${section.ROOT}/${section.CURRENT}`, TITLES_REMARKETING_LEGACY: `/${section.ROOT}/${section.LEGACY}` };\nexport default routes;\n",
  "export const DASHBOARD_MODULES = Object.freeze({ TITLES: { Remarketing: '/titles/remarketing-classic' } });\n",
);
expect('publisher creates a portable contract', run(publish), 0, 'Published 2 application routes');
const published = JSON.parse(readFileSync(contract, 'utf8'));
expect('validator accepts active dashboard routes', run(validate), 0, 'match the current application route contract');
if (published.source !== 'fhf-dashboards/src/constants/routes.js') failures.push('publisher emitted a machine-specific source path');

writeFixture(
  "export const section = { ROOT: 'titles', CURRENT: 'remarketing-classic', LEGACY: 'remarketing' };\nconst routes = { TITLES_REMARKETING: `/${section.ROOT}/${section.CURRENT}`, TITLES_REMARKETING_LEGACY: `/${section.ROOT}/${section.LEGACY}` };\nexport default routes;\n",
  "export const DASHBOARD_MODULES = Object.freeze({ TITLES: { Remarketing: '/titles/remarketing' } });\n",
);
expect('validator rejects legacy dashboard routes', run(validate), 1, "application's legacy route");

writeFixture(
  "export const section = { ROOT: 'titles', CURRENT: 'remarketing-titles', LEGACY: 'remarketing' };\nconst routes = { TITLES_REMARKETING: `/${section.ROOT}/${section.CURRENT}`, TITLES_REMARKETING_LEGACY: `/${section.ROOT}/${section.LEGACY}` };\nexport default routes;\n",
  "export const DASHBOARD_MODULES = Object.freeze({ TITLES: { Remarketing: '/titles/remarketing-classic' } });\n",
);
expect('validator rejects a stale published contract', run(validate), 1, 'Application route contract is stale');

rmSync(root, { recursive: true, force: true });
if (failures.length) {
  console.error(`\n${failures.length} route-contract test failure(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('\nAll route-contract tests passed.');
