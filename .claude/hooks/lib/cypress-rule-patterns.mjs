// Shared Cypress rule patterns — single source of truth for the checks that were
// previously copy-pasted across pre-validate-cypress-rules.mjs, validate-cypress-rules.mjs,
// and spec-sweep-stop-hook.mjs. Canonical rule descriptions live in
// docs/framework/testing-standards/TESTS.md — this module is the executable form.

export const CY_WAIT_NUMBER_RE = /cy\.wait\(\s*\d+/;
export const SMOKE_MUTATION_RE = /\.(post|put|patch|delete)\s*\(|method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i;
export const HARDCODED_CREDENTIAL_RE = /(?:password|passwd)\s*[:=]\s*['"][^'"]{4,}['"]/i;

export function isSmokePath(filePath) {
  return /[\\/]smoke[\\/]/.test(filePath);
}

export function isSpecFile(filePath) {
  return filePath.endsWith('.cy.js') || filePath.endsWith('.cy.ts');
}

export function isConfigPath(filePath) {
  return /[\\/]configs[\\/]/.test(filePath);
}

// Checks applicable to any spec file's full content. Returns a list of violation strings.
export function checkSpecContent(content) {
  const v = [];
  if (CY_WAIT_NUMBER_RE.test(content)) v.push('cy.wait(number) — use cy.apiWait() or .should(\'be.visible\')');
  if (!content.includes('cy.ensureAuthenticated()')) v.push('missing cy.ensureAuthenticated()');
  if (!content.includes('testIsolation: true')) v.push('missing testIsolation: true');
  return v;
}
