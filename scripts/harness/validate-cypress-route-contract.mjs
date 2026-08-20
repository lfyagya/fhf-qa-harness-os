#!/usr/bin/env node
// Validates that Cypress dashboard routes consume active routes from the published app contract.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROUTE_CONTRACT_SCHEMA_VERSION,
  readApplicationRoutes,
  readCypressDashboardRoutes,
  sha256,
} from './route-contract-lib.mjs';

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FHF_ROOT = process.env.FHF_CONSUMER_ROOT
  ? path.resolve(process.env.FHF_CONSUMER_ROOT)
  : path.resolve(HARNESS_ROOT, '..', 'FHF');
const E2E_ROOT = process.env.FHF_E2E_ROOT
  ? path.resolve(process.env.FHF_E2E_ROOT)
  : path.join(FHF_ROOT, 'front-end-automation-e2e');
const E2E_PACKAGE = path.join(E2E_ROOT, 'CypressFHF', 'fhf-dashboards');
const DEFAULT_SOURCE = path.join(FHF_ROOT, 'fhf-dashboards', 'src', 'constants', 'routes.js');
const DEFAULT_CONTRACT = path.join(E2E_PACKAGE, 'cypress', 'configs', 'app', 'application-routes.contract.json');
const DEFAULT_CYPRESS_ROUTES = path.join(E2E_PACKAGE, 'cypress', 'configs', 'app', 'routes.js');

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : path.resolve(process.argv[index + 1]);
}

const sourcePath = option('--source', DEFAULT_SOURCE);
const contractPath = option('--contract', DEFAULT_CONTRACT);
const cypressRoutesPath = option('--cypress-routes', DEFAULT_CYPRESS_ROUTES);
const problems = [];

if (!existsSync(contractPath)) {
  problems.push(`Missing application route contract: ${contractPath}. Run publish-route-contract.mjs first.`);
} else {
  let contract;
  try {
    contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  } catch (error) {
    problems.push(`Invalid application route contract ${contractPath}: ${error.message}`);
  }

  if (contract) {
    if (contract.schemaVersion !== ROUTE_CONTRACT_SCHEMA_VERSION || !Array.isArray(contract.routes)) {
      problems.push(`Unsupported application route contract schema in ${contractPath}. Re-run publish-route-contract.mjs.`);
    } else {
      const { source } = readApplicationRoutes(sourcePath);
      if (contract.sourceSha256 !== sha256(source)) {
        problems.push(`Application route contract is stale: ${contractPath}. Re-run publish-route-contract.mjs after updating ${sourcePath}.`);
      }

      const published = new Map(contract.routes.map((route) => [route.value, route]));
      for (const route of readCypressDashboardRoutes(cypressRoutesPath)) {
        const applicationRoute = published.get(route.value);
        const label = `${route.module}.${route.surface} (${route.value})`;
        if (!applicationRoute) {
          problems.push(`Cypress route ${label} is not published by the application route contract.`);
        } else if (applicationRoute.status !== 'active') {
          problems.push(`Cypress route ${label} resolves to the application's ${applicationRoute.status} route ${applicationRoute.key}; use an active route instead.`);
        }
      }
    }
  }
}

if (problems.length) {
  console.error('Cypress route-contract validation failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log('Cypress dashboard routes match the current application route contract.');
