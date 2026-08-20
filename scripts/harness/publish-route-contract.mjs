#!/usr/bin/env node
// Publishes a read-only snapshot of the application's exported route contract for Cypress.
// Run after changing fhf-dashboards/src/constants/routes.js; never hand-edit the JSON output.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTE_CONTRACT_SCHEMA_VERSION, readApplicationRoutes, sha256 } from './route-contract-lib.mjs';

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FHF_ROOT = process.env.FHF_CONSUMER_ROOT
  ? path.resolve(process.env.FHF_CONSUMER_ROOT)
  : path.resolve(HARNESS_ROOT, '..', 'FHF');
const E2E_ROOT = process.env.FHF_E2E_ROOT
  ? path.resolve(process.env.FHF_E2E_ROOT)
  : path.join(FHF_ROOT, 'front-end-automation-e2e');
const DEFAULT_SOURCE = path.join(FHF_ROOT, 'fhf-dashboards', 'src', 'constants', 'routes.js');
const DEFAULT_OUTPUT = path.join(
  E2E_ROOT,
  'CypressFHF',
  'fhf-dashboards',
  'cypress',
  'configs',
  'app',
  'application-routes.contract.json',
);

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : path.resolve(process.argv[index + 1]);
}

const sourcePath = option('--source', DEFAULT_SOURCE);
const outputPath = option('--output', DEFAULT_OUTPUT);
const { source, routes } = readApplicationRoutes(sourcePath);
const contract = Object.freeze({
  schemaVersion: ROUTE_CONTRACT_SCHEMA_VERSION,
  // Paths are intentionally machine-independent so the checked-in artifact is portable.
  source: 'fhf-dashboards/src/constants/routes.js',
  sourceSha256: sha256(source),
  routes,
});

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
console.log(`Published ${routes.length} application routes to ${outputPath}`);
