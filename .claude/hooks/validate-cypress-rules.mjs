#!/usr/bin/env node
// PostToolUse:Edit|Write — core Cypress rule enforcer.
// exit 2 = violation, stderr fed back to Claude to fix; exit 0 = clean.
//
// cy.wait(number) and smoke-mutation checks live ONLY in pre-validate-cypress-rules.mjs
// (PreToolUse) — that hook already blocks the write before it lands, so those two checks
// can never fire here and were removed as dead code. This hook keeps the checks that have
// no pre-write equivalent: config freezing, spec auth/isolation, and credential leakage.
import { readFileSync, existsSync, readdirSync } from 'fs';
import { extname, join } from 'path';
import { HARDCODED_CREDENTIAL_RE, isSpecFile, isConfigPath, isSmokePath } from './lib/cypress-rule-patterns.mjs';

// Find the `cypress/configs/ui` root that contains this file, if any.
function findUiConfigRoot(filePath) {
  const m = filePath.match(/^(.*\/cypress\/configs\/ui)\//);
  return m ? m[1] : null;
}

// Strip /* */ and // comments before scanning for data-cy literals — a
// data-cy value mentioned in a JSDoc header or a `// DOM:` annotation isn't a
// real object-literal declaration and must not count as one on either side
// of the duplicate-selector check (extraction or sibling-file matching).
// Incident: lossMitigationAuctionInvoice.ui.js's own @fileoverview + inline
// DOM comment mention "tab-list-container", falsely flagged as a real
// duplicate of insuranceCommon.ui.js's TAB_LIST_CONTAINER, 2026-07-23.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// Recursively collect .js/.ts files under dir, skipping the file just written.
function walkJsFiles(dir, excludePath) {
  let out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walkJsFiles(full, excludePath));
    else if (/\.(js|ts)$/.test(entry.name) && full.replace(/\\/g, '/') !== excludePath) out.push(full);
  }
  return out;
}

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const filePath = (payload.tool_input?.file_path ?? '').replace(/\\/g, '/');
if (!filePath.includes('cypress') && !filePath.includes('CypressFHF')) process.exit(0);
if (!['.js', '.ts', '.mjs'].includes(extname(filePath))) process.exit(0);
if (!existsSync(payload.tool_input?.file_path ?? '')) process.exit(0);

let content;
try { content = readFileSync(payload.tool_input.file_path, 'utf8'); } catch { process.exit(0); }

const isSpec   = isSpecFile(filePath);
const isConfig = isConfigPath(filePath);
const violations = [];
const warnings = [];

// ALWAYS Object.freeze() on configs.
// Exception: a pure re-export barrel (`export * from './x.js'`) declares no object of its
// own, so it can never satisfy this check — flagging it made every barrel permanently
// un-editable. Verified false positive 2026-08-17 on
// configs/ui/modules/unifi/collections/index.js while deleting a duplicate config from it.
// Deliberately narrow: any file that declares anything besides re-exports is still checked.
const isReExportBarrel = content
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean)
  .every(line => /^export\s+(?:\*|\{[^}]*\})\s+from\s+['"][^'"]+['"];?$/.test(line));

if (isConfig && !isReExportBarrel && !content.includes('Object.freeze('))
  violations.push('Config file missing Object.freeze() — all exported config objects must be frozen');

// NEVER redeclare a data-cy selector literal that already exists in a sibling
// UI config file — ui-config-hierarchy.md rule 5: shared selectors belong in
// common.ui.js, imported, not re-declared per module with the same value.
// Incident: SORT_ASC/SORT_DESC literals independently declared in both
// doc-repository.ui.js and (briefly) a custodian config, 2026-07-10.
const uiConfigRoot = findUiConfigRoot(filePath);
const isCommonUi = /common\.ui\.(js|ts)$/.test(filePath);
if (isConfig && uiConfigRoot && !isCommonUi) {
  const dataCyValues = [...stripComments(content).matchAll(/data-cy=\\?"([^"\\]+)\\?"/g)].map((m) => m[1]);
  const seen = new Set();
  for (const value of dataCyValues) {
    if (seen.has(value)) continue;
    seen.add(value);
    // Match the same optional-backslash-before-quote shape the extraction regex
    // tolerates — a literal like '[data-cy="x"]' inside a single-quoted JS
    // string is stored on disk as `data-cy=\"x\"` (escaped), not plain quotes.
    const needleRe = new RegExp(`data-cy=\\\\?"${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\\\?"`);
    for (const other of walkJsFiles(uiConfigRoot, payload.tool_input.file_path.replace(/\\/g, '/'))) {
      if (/common\.ui\.(js|ts)$/.test(other)) continue;
      let otherContent;
      try { otherContent = stripComments(readFileSync(other, 'utf8')); } catch { continue; }
      if (needleRe.test(otherContent)) {
        violations.push(
          `Selector data-cy="${value}" already declared in ${other} — move the shared literal to ` +
          `common.ui.js and import it (ui-config-hierarchy.md rule 5) instead of redeclaring it here.`
        );
        break;
      }
    }
  }
}

// ALWAYS cy.ensureAuthenticated() in specs
if (isSpec && !content.includes('cy.ensureAuthenticated()'))
  violations.push('Spec missing cy.ensureAuthenticated() — required in before() AND beforeEach()');

// ALWAYS testIsolation: true in specs
if (isSpec && !content.includes('testIsolation: true'))
  violations.push('Spec missing testIsolation: true in describe() options');

// NEVER hardcoded credentials in specs
if (isSpec && HARDCODED_CREDENTIAL_RE.test(content))
  violations.push('Possible hardcoded credential — use Cypress.env() + { log: false }');

// Commands, rather than specs, own network interception. This keeps endpoint aliases,
// deterministic stubs, and wait sequencing reusable and prevents a spec from bypassing the
// Config -> Commands -> Tests boundary.
if (isSpec && /\bcy\.(?:apiIntercept(?:All)?|intercept)\s*\(/.test(content))
  violations.push('Spec registers a raw intercept - move interception/stubbing into a domain setup or intercept command; specs call that command only');

// A literal path in cy.visit() creates a second route registry. Named route constants are the
// Cypress representation of the application-published route contract.
if (isSpec && /\bcy\.visit\(\s*['"]\//.test(content))
  violations.push('Spec contains a literal route in cy.visit() - use a named route contract/config constant through a navigation command');

// ── Gate-tier rules (smoke-checklist.md § Gate tier) ────────────────────────
// smoke-execution-strategy.md §3 sets a hard cap of 3 @critical per dashboard route and §5 asks
// for quarantine expiry to be "checkable"; both were enforced by nothing. Tags are matched on the
// destructured alias shape actually used in the specs (`S.CRITICAL`, `TAGS.STATUS.CRITICAL`) — not
// the literal '@critical', which appears nowhere in spec source.
const CRITICAL_TAG_RE = /\b[A-Z]\w*\.CRITICAL\b/g;
const QUARANTINE_TAG_RE = /\b[A-Z]\w*\.(?:QUARANTINE|FLAKY)\b/;

if (isSpec && isSmokePath(filePath)) {
  const criticalCount = (content.match(CRITICAL_TAG_RE) ?? []).length;

  // Hard cap. A gate that grows without a cap becomes the sweep again, at which point the
  // tiering bought nothing (§3). Blocks, because exceeding it is always a mistake.
  if (criticalCount > 3)
    violations.push(
      `${criticalCount} @critical tags in one spec — cap is 3 per dashboard route ` +
      `(smoke-execution-strategy.md §3). Demote the extras to sweep tier.`
    );

  // Gate coverage. WARNING not a violation: §6 sequences tagging (change 1) before tier
  // selection (change 2) precisely so tags can land incrementally. Blocking here would fail
  // every edit to the 32 currently-untagged specs.
  if (criticalCount === 0)
    warnings.push(
      'No @critical tag — this module cannot fail the gate tier. Tag the load test ' +
      '(smoke-execution-strategy.md §6 change 1).'
    );

  // Quarantine metadata. Inert today (zero quarantine tags exist), so it is safe to block:
  // it can only fire on a newly-written entry, which is exactly when the ticket is known.
  if (QUARANTINE_TAG_RE.test(content)) {
    const hasTicket = /SERV-\d+/.test(content);
    const hasDate = /\b20\d{2}-\d{2}-\d{2}\b/.test(content);
    if (!hasTicket || !hasDate)
      violations.push(
        'Quarantined/flaky test missing ' +
        [!hasTicket && 'a SERV- ticket reference', !hasDate && 'a YYYY-MM-DD quarantine date']
          .filter(Boolean).join(' and ') +
        ' — quarantine is not a parking lot (smoke-execution-strategy.md §5).'
      );
  }

  // A skipped module is invisible in an aggregate — the Checks suite sat at 0/10 for a full run
  // while the headline read 634/669 (§1.5). A ticket reference makes it traceable.
  if (/\b(?:describe|it|context)\.skip\s*\(/.test(content) && !/SERV-\d+/.test(content))
    warnings.push(
      'Skipped block without a SERV- ticket reference — a dead module hides inside a healthy ' +
      'aggregate (smoke-execution-strategy.md §1).'
    );
}

if (warnings.length > 0) {
  console.error('SMOKE CHECKLIST WARNINGS — ' + filePath);
  warnings.forEach(w => console.error('  ! ' + w));
}

if (violations.length > 0) {
  console.error('CYPRESS RULE VIOLATIONS — ' + filePath);
  violations.forEach(v => console.error('  ✗ ' + v));
  process.exit(2);
}
process.exit(0);
