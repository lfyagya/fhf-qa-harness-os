#!/usr/bin/env node
// Core Cypress rule enforcer. Two drivers over one shared analyze():
//
//   hook mode  (default)          — PostToolUse:Edit|Write, one file from a stdin tool payload.
//                                   exit 2 = violation, stderr fed back to Claude to fix.
//   CI mode    (--base-ref <ref>) — every changed file in a PR. exit 2 = a violation this branch
//                                   INTRODUCED. Pre-existing violations print but do not fail.
//
// cy.wait(number) and smoke-mutation checks live ONLY in pre-validate-cypress-rules.mjs
// (PreToolUse) — that hook already blocks the write before it lands, so those two checks
// can never fire here and were removed as dead code. This hook keeps the checks that have
// no pre-write equivalent: config freezing, spec auth/isolation, and credential leakage.
import { readFileSync, existsSync, readdirSync } from 'fs';
import { extname, join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import {
  HARDCODED_CREDENTIAL_RE,
  checkTagTaxonomy,
  tagTaxonomy,
  selectorInventoryPolicy,
  checkFalseGreen,
  isSpecFile,
  isConfigPath,
  isSmokePath,
} from './lib/cypress-rule-patterns.mjs';
import { loadSelectorInventory, findDeadSelectors } from './lib/selector-liveness.mjs';
import { ticketScanPattern } from './lib/task-protocol.mjs';

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

/** Is this a file these rules have anything to say about? */
function isRelevant(filePath) {
  if (!filePath.includes('cypress') && !filePath.includes('CypressFHF')) return false;
  return ['.js', '.ts', '.mjs'].includes(extname(filePath));
}

/**
 * Run every rule against one file's content.
 *
 * Pure with respect to the file under test: `content` is passed in rather than read, so CI mode
 * can analyse the base-ref version of a file that no longer exists on disk in that form. Sibling
 * lookups (the duplicate-selector check) deliberately still read the working tree — the question
 * "does this selector collide with another config" is only meaningful against current siblings.
 *
 * @param {string} filePath - forward-slashed path, used for classification
 * @param {string} absPath  - on-disk path, used for sibling exclusion and baseline keys
 * @param {string} content
 * @returns {{violations: string[], warnings: string[]}}
 */
function analyze(filePath, absPath, content) {
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
        let duplicateBaseline = {};
        try {
          duplicateBaseline = JSON.parse(readFileSync(
            join(dirname(fileURLToPath(import.meta.url)), "duplicate-selector-baseline.json"), "utf8",
          )).selectors ?? {};
        } catch {
          // Missing baseline: grandfather nothing, report every duplicate as new.
        }
        const carriedDuplicates = duplicateBaseline[relative(uiConfigRoot, absPath).replace(/\\/g, "/")] ?? [];
  const dataCyValues = [...stripComments(content).matchAll(/data-cy=\\?"([^"\\]+)\\?"/g)].map((m) => m[1]);
  const seen = new Set();
  for (const value of dataCyValues) {
    if (seen.has(value)) continue;
    seen.add(value);
    // Match the same optional-backslash-before-quote shape the extraction regex
    // tolerates — a literal like '[data-cy="x"]' inside a single-quoted JS
    // string is stored on disk as `data-cy=\"x\"` (escaped), not plain quotes.
    const needleRe = new RegExp(`data-cy=\\\\?"${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\\\?"`);
    for (const other of walkJsFiles(uiConfigRoot, absPath.replace(/\\/g, '/'))) {
      if (/common\.ui\.(js|ts)$/.test(other)) continue;
      let otherContent;
      try { otherContent = stripComments(readFileSync(other, 'utf8')); } catch { continue; }
      if (needleRe.test(otherContent)) {
        // Tiered like the dead-selector check below, and for the same stated reason: enforced
        // with no baseline this blocked 103 pre-existing duplicates across 22 of the 23 ui
        // config files, making almost the whole config layer uneditable - and an unusable gate
        // gets switched off. Baselined literals WARN; a duplicate that is not listed BLOCKS.
        if (carriedDuplicates.includes(value)) {
          warnings.push(
            `Selector data-cy="${value}" is also declared in ${other} - carried, listed in ` +
            `duplicate-selector-baseline.json. Not blocking. Retiring it means moving the literal ` +
            `to common.ui.js, importing it in both, and deleting the baseline entry.`,
          );
        } else {
          violations.push(
            `Selector data-cy="${value}" already declared in ${other} — move the shared literal to ` +
            `common.ui.js and import it (ui-config-hierarchy.md rule 5) instead of redeclaring it here.`
          );
        }
        break;
      }
    }
  }
}

// NEVER declare a data-cy the application does not emit. configs/ui/** is a contract with
// fhf-dashboards, and until now it was one-way: nothing failed when the app side disappeared.
// TABLE_UI.ITEM_COUNT ('[data-cy="dashboard-item-count"]') outlived the 2026-08-17 cleanup that
// removed its callers, got re-aliased as TOTAL_RECORDS_COUNT by Loss Mitigation and Contact Log,
// and produced 75 unpassable assertions in Cloud run 754 — each one reporting the same
// "Expected to find element ... but never found it" as a genuinely empty grid.
//
// Tiering: 90 already-dead selectors exist across 9 config files (measured 2026-08-28 against
// app dev). Blocking all of them would make those files uneditable, and an unusable gate gets
// switched off — so the existing debt is grandfathered in dead-selector-baseline.json and only
// WARNS, while anything not on that list BLOCKS.
//
// A checked-in baseline rather than a git comparison, for two reasons that are NOT "git doesn't
// work here" — it does; these files are tracked by the outer front-end-automation repo, and the
// nested CypressFHF/fhf-dashboards/.git is an unrelated orphan with no commits that shadows them
// only for `git -C <dir>` invocations. The real reasons: this hook runs with an arbitrary cwd and
// must not depend on git being resolvable at all, and an explicit list makes the debt reviewable
// in a diff and one-directional — entries can be removed, but adding one takes the same review as
// a guardrail exception.
if (isConfig && uiConfigRoot) {
  const hooksDir = dirname(fileURLToPath(import.meta.url));
  // Checked against the committed inventory, NOT the local app checkout — see
  // loadSelectorInventory() for why. Missing inventory (fresh clone before the first
  // nightly) skips the check rather than failing: it can prove a selector dead, never alive.
  const inventory = loadSelectorInventory(
    join(hooksDir, 'selector-inventory.json')
  );
  // An absent inventory used to skip in silence, so the one gate that asks whether the
  // APPLICATION actually emits a selector was inert wherever the file was missing - which
  // was every lane but E2E. Silence reads as 'no gap'. State it instead, the same way
  // ADR-0024 requires an unproven chain row to read UNKNOWN rather than be omitted.
  if (!inventory) {
    warnings.push(
      'Selector liveness UNKNOWN - .claude/hooks/selector-inventory.json is missing, so no ' +
      'selector in this file was checked against application source. This is not a pass. ' +
      'Refresh it with: node scripts/harness/check-selector-drift.mjs --update',
    );
  }
  if (inventory) {
    // Staleness is stated for the same reason absence is: this check can prove a selector
    // dead but never alive, so an out-of-date inventory quietly under-reports and looks
    // identical to a clean run. Warn, never block - a stale inventory still beats none, and
    // blocking on age would just push someone to delete the file.
    const invPolicy = selectorInventoryPolicy();
    const maxAgeDays = Number.isFinite(invPolicy.maxAgeDays) ? invPolicy.maxAgeDays : 14;
    const generatedAt = Date.parse(inventory.generatedAt ?? '');
    if (Number.isFinite(generatedAt)) {
      const ageDays = Math.floor((Date.now() - generatedAt) / 86400000);
      if (ageDays > maxAgeDays) {
        warnings.push(
          `Selector inventory is ${ageDays} days old (limit ${maxAgeDays}), captured at ` +
          `${inventory.appRef}@${String(inventory.appSha).slice(0, 9)}. It can prove a selector ` +
          `dead but never alive, so anything the application added since then reads as dead ` +
          `and anything removed still reads as live. Refresh: ` +
          `${invPolicy.refreshCommand ?? 'node scripts/harness/check-selector-drift.mjs --update'}`,
        );
      }
    }
    const deadNow = findDeadSelectors(stripComments(content), inventory);

    if (deadNow.length > 0) {
      let baseline = {};
      try {
        baseline = JSON.parse(
          readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'dead-selector-baseline.json'), 'utf8')
        ).selectors ?? {};
      } catch {
        // Missing or unreadable baseline: grandfather nothing, report everything as new.
      }
      const key = relative(uiConfigRoot, absPath).replace(/\\/g, '/');
      const carried = new Set(baseline[key] ?? []);
      const introduced = deadNow.filter((value) => !carried.has(value));
      const preExisting = deadNow.filter((value) => carried.has(value));

      for (const value of introduced)
        violations.push(
          `Selector data-cy="${value}" is not emitted anywhere in the application ` +
          `(${inventory.appRef}@${String(inventory.appSha).slice(0, 9)}, per ` +
          `.claude/hooks/selector-inventory.json). Confirm the hook exists in app source before ` +
          `declaring it — if the element has no data-cy yet, that is an upstream testability gap ` +
          `(source-map.md), not a selector to guess at. Assert against the intercepted response ` +
          `instead. If the app added it after that revision, refresh the inventory: ` +
          `node scripts/harness/check-selector-drift.mjs --update`
        );

      if (preExisting.length > 0)
        warnings.push(
          `${preExisting.length} grandfathered dead selector(s) in this file — not emitted by the ` +
          `application: ${preExisting.join(', ')}. Not blocking (listed in ` +
          `dead-selector-baseline.json), but any test binding to these cannot pass. Retiring one ` +
          `means deleting it here AND from the baseline.`
        );
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

if (isSpec) {
  try {
    // Tag taxonomy is warn-by-default: it landed against lanes that are not tagged yet, where
    // blocking fails 50 of 56 E2E and 41 of 41 Smoke specs - every spec uneditable, and an
    // unusable gate gets switched off. Same reasoning the @critical coverage rule below already
    // records. qualityAssurance.tagTaxonomy.enforcement flips it to block once tags have landed.
    const tagFindings = checkTagTaxonomy(content);
    if (tagTaxonomy().enforcement === "block") violations.push(...tagFindings);
    else warnings.push(...tagFindings.map((m) => `${m} - not blocking while tag enforcement is warn`));
    // falseGreen enforcement lives here rather than in pre-validate because assertion density
    // is a whole-file property: an Edit payload carries one fragment, so counting assertions
    // there would flag every single-line edit to a perfectly good spec.
    //
    // Tiered exactly like the dead-selector check above, and for the same reason: this landed
    // against lanes that already carried 6 real violations, and blocking all of them would make
    // those specs uneditable until fixed, at which point the gate gets switched off. Baselined
    // entries WARN; anything not listed BLOCKS. Every baselined line is a genuine false green -
    // three conditional this.skip() calls, one spec with three it() blocks and no assertion, and
    // the two skipped Checks suites that produced 0/10 inside a 634/669 headline.
    const fgFindings = checkFalseGreen(content);
    if (fgFindings.length > 0) {
      let fgBaseline = {};
      try {
        fgBaseline = JSON.parse(readFileSync(
          join(dirname(fileURLToPath(import.meta.url)), "false-green-baseline.json"), "utf8",
        )).specs ?? {};
      } catch {
        // Missing baseline: grandfather nothing, report everything as new.
      }
      const specKey = filePath.split("/cypress/tests/")[1] ?? "";
      const carriedMarkers = fgBaseline[specKey] ?? [];
      const marker = (message) => message.includes("no assertion") ? "no assertion"
        : message.includes("below the configured") ? "below the configured"
        : message.split(" ")[0];
      for (const finding of fgFindings) {
        if (carriedMarkers.includes(marker(finding))) {
          warnings.push(
            `${finding} — carried, listed in false-green-baseline.json. Not blocking, but this ` +
            `spec cannot prove what it claims. Fixing it means deleting the entry too.`,
          );
        } else {
          violations.push(finding);
        }
      }
    }
  } catch (error) {
    violations.push(`Tag taxonomy policy unavailable: ${error.message}`);
  }
}

// The two checks below match CODE, so they read comment-stripped source. A spec's own
// @fileoverview routinely documents its intercept lifecycle by naming the very commands these
// rules forbid — titles/general.cy.js describes "registers ALL aliases via cy.apiInterceptAll",
// which flagged a file whose executable code had none. Same class as the 2026-07-23 JSDoc false
// positive on the duplicate-selector check, which is why stripComments() already exists here.
const code = stripComments(content);

// Commands, rather than specs, own network interception. This keeps endpoint aliases,
// deterministic stubs, and wait sequencing reusable and prevents a spec from bypassing the
// Config -> Commands -> Tests boundary.
if (isSpec && /\bcy\.(?:apiIntercept(?:All)?|intercept)\s*\(/.test(code))
  violations.push('Spec registers a raw intercept - move interception/stubbing into a domain setup or intercept command; specs call that command only');

// A literal path in cy.visit() creates a second route registry. Named route constants are the
// Cypress representation of the application-published route contract.
if (isSpec && /\bcy\.visit\(\s*['"]\//.test(code))
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
    const hasTicket = ticketScanPattern().test(content);
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
  if (/\b(?:describe|it|context)\.skip\s*\(/.test(content) && !ticketScanPattern().test(content))
    warnings.push(
      'Skipped block without a FirstHelp ticket reference — a dead module hides inside a healthy ' +
      'aggregate (smoke-execution-strategy.md §1).'
    );
}

  return { violations, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Driver 1 — PostToolUse hook (stdin carries one Edit/Write payload)
// ─────────────────────────────────────────────────────────────────────────────
function runHookMode() {
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

  const absPath = payload.tool_input?.file_path ?? '';
  const filePath = absPath.replace(/\\/g, '/');
  if (!isRelevant(filePath)) process.exit(0);
  if (!existsSync(absPath)) process.exit(0);

  let content;
  try { content = readFileSync(absPath, 'utf8'); } catch { process.exit(0); }

  const { violations, warnings } = analyze(filePath, absPath, content);

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
}

// ─────────────────────────────────────────────────────────────────────────────
// Driver 2 — CI mode: `--base-ref <ref>` over a pull request's changed files
//
// This existed in .github/workflows/cypress-nonnegotiable-rules.yml since 2026-08-06 and did
// nothing: the workflow passed --base-ref to a script that only ever read a tool payload from
// stdin, hit `catch { process.exit(0) }`, and reported success without opening a single file.
// The job has therefore never enforced anything, while CLAUDE.md advertised it as the guard
// against local-only drift.
//
// Introduced-vs-carried, not whole-file: the tree has real pre-existing violations (20 duplicate
// selectors in loss-mitigation.ui.js, raw intercepts across five LM specs). Failing whole files
// would block every PR that touches them and the job would be disabled within a week. So each
// changed file is analysed twice — at the base ref and at HEAD — and only violations absent from
// the base version fail the build. Carried violations are printed as warnings so the debt stays
// visible instead of silently accepted.
// ─────────────────────────────────────────────────────────────────────────────
function runCiMode(baseRef) {
  let repoRoot;
  try {
    repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    console.error(`CI mode requires a git checkout (cwd: ${process.cwd()}).`);
    process.exit(2);
  }

  // ACMR: added/copied/modified/renamed. Deleted files have nothing left to check.
  let changed;
  try {
    changed = execFileSync(
      'git',
      ['diff', '--name-status', '-M', '--diff-filter=ACMR', `${baseRef}...HEAD`],
      { cwd: repoRoot, encoding: 'utf8' }
    ).split('\n').map(line => line.trim()).filter(Boolean);
  } catch (error) {
    console.error(
      `Could not diff against "${baseRef}": ${String(error.message).split('\n')[0]}\n` +
      'Ensure the workflow checks out enough history (fetch-depth: 0) and that the ref exists.'
    );
    process.exit(2);
  }

  // --name-status -M yields "M\tpath", "A\tpath" or "R100\told\tnew". Without -M a rename looks
  // like an addition, `git show base:<new path>` fails, the base version is treated as empty, and
  // every pre-existing violation in a file that only MOVED is reported as introduced. That failed
  // a pure directory rename with 9 carried duplicates and zero content change.
  const renamedFrom = new Map();
  changed = changed.map((line) => {
    const parts = line.split('\t');
    const status = parts[0];
    if (status.startsWith('R') && parts.length >= 3) {
      renamedFrom.set(parts[2], parts[1]);
      return parts[2];
    }
    return parts[parts.length - 1];
  });
  const targets = changed.filter(isRelevant);
  console.log(
    `Cypress rules: ${targets.length} relevant file(s) of ${changed.length} changed vs ${baseRef}`
  );

  let introducedTotal = 0;
  let carriedTotal = 0;

  for (const relPath of targets) {
    const absPath = join(repoRoot, relPath);
    if (!existsSync(absPath)) continue;

    // analyze() must receive an ABSOLUTE forward-slashed path, matching hook mode. The
    // duplicate-selector check derives its sibling-scan root from this path and excludes the file
    // under test by comparing against absPath — pass a repo-relative path here and the root comes
    // out relative too, the exclusion never matches, and every config reports itself as its own
    // duplicate. That inflated the carried count and produced one bogus "introduced" violation.
    const scanPath = absPath.replace(/\\/g, '/');

    let content;
    try { content = readFileSync(absPath, 'utf8'); } catch { continue; }

    const now = analyze(scanPath, absPath, content);

    // Absent at base (new file) => every violation is introduced.
    let before = { violations: [], warnings: [] };
    try {
      const basePath = renamedFrom.get(relPath) ?? relPath;
      const baseContent = execFileSync('git', ['show', `${baseRef}:${basePath}`], {
        cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      });
      before = analyze(scanPath, absPath, baseContent);
    } catch { /* new file */ }

    const carriedSet = new Set(before.violations);
    const introduced = now.violations.filter(v => !carriedSet.has(v));
    const carried = now.violations.filter(v => carriedSet.has(v));

    if (introduced.length > 0) {
      introducedTotal += introduced.length;
      console.error(`\nCYPRESS RULE VIOLATIONS (introduced) — ${relPath}`);
      introduced.forEach(v => console.error('  ✗ ' + v));
    }
    if (carried.length > 0) {
      carriedTotal += carried.length;
      console.error(`\nPRE-EXISTING (not blocking) — ${relPath}`);
      carried.forEach(v => console.error('  · ' + v));
    }
    if (now.warnings.length > 0) {
      console.error(`\nWARNINGS — ${relPath}`);
      now.warnings.forEach(w => console.error('  ! ' + w));
    }
  }

  console.log(
    `\nCypress rules: ${introducedTotal} introduced violation(s), ` +
    `${carriedTotal} pre-existing carried through.`
  );
  process.exit(introducedTotal > 0 ? 2 : 0);
}

const baseRefIndex = process.argv.indexOf('--base-ref');
if (baseRefIndex !== -1) {
  const baseRef = process.argv[baseRefIndex + 1];
  // An empty value means the workflow interpolated a blank (e.g. github.base_ref on a non-PR
  // event). Falling back to hook mode there would read no stdin and exit 0 — reintroducing
  // exactly the silent pass this driver was written to eliminate. Fail loudly instead.
  if (!baseRef || baseRef.startsWith('--')) {
    console.error('--base-ref requires a git ref (got none). Refusing to pass silently.');
    process.exit(2);
  }
  runCiMode(baseRef);
} else {
  runHookMode();
}
