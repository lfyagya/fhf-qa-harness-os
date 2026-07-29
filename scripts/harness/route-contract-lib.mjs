import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const ROUTE_CONTRACT_SCHEMA_VERSION = 1;

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function evaluateRouteModule(source, sourcePath, exportName) {
  if (/^\s*import\s/m.test(source)) {
    throw new Error(`${sourcePath} must be a self-contained route module; imports cannot be evaluated by the contract publisher.`);
  }

  const transformed = source
    .replace(/^export const /gm, 'const ')
    .replace(/^export default .+;\s*$/gm, '');
  const context = Object.create(null);
  vm.createContext(context);
  new vm.Script(`${transformed}\nglobalThis.__routeContractExport = ${exportName};`, {
    filename: sourcePath,
  }).runInContext(context, { timeout: 1000 });

  if (!context.__routeContractExport || typeof context.__routeContractExport !== 'object') {
    throw new Error(`${sourcePath} did not define ${exportName} as an object.`);
  }
  return context.__routeContractExport;
}

function routeStatus(key, value) {
  if (value === '*') return 'wildcard';
  if (/(?:^|_)LEGACY(?:_|$)|(?:^|_)OLD(?:_|$)/.test(key)) return 'legacy';
  if (/(?:^|_)DEV(?:_|$)/.test(key)) return 'development';
  return 'active';
}

export function readApplicationRoutes(sourcePath) {
  const source = readFileSync(sourcePath, 'utf8');
  const routes = evaluateRouteModule(source, sourcePath, 'routes');
  return {
    source,
    routes: Object.entries(routes).map(([key, value]) => {
      if (typeof value !== 'string') {
        throw new Error(`${sourcePath} route ${key} must resolve to a string.`);
      }
      return Object.freeze({ key, value, status: routeStatus(key, value) });
    }),
  };
}

export function readCypressDashboardRoutes(sourcePath) {
  const source = readFileSync(sourcePath, 'utf8');
  const dashboards = evaluateRouteModule(source, sourcePath, 'DASHBOARD_MODULES');
  const routes = [];
  for (const [module, surfaces] of Object.entries(dashboards)) {
    if (!surfaces || typeof surfaces !== 'object') {
      throw new Error(`${sourcePath} dashboard module ${module} must be an object.`);
    }
    for (const [surface, value] of Object.entries(surfaces)) {
      if (typeof value !== 'string') {
        throw new Error(`${sourcePath} Cypress dashboard route ${module}.${surface} must resolve to a string.`);
      }
      routes.push(Object.freeze({ module, surface, value }));
    }
  }
  return routes;
}
