#!/usr/bin/env node
/**
 * select-impacted.mjs — deterministic change-based test selection for the FHF QA lanes.
 *
 * Turns a list of changed files into the exact set of specs / pytest paths that can
 * observe a regression from that change. No LLM, no network, no clock.
 *
 * Design rules (these are the whole point — do not "optimise" them away):
 *   1. Selection may only ever NARROW a run that would otherwise be full.
 *      Any path it cannot confidently attribute escalates to a full run.
 *      Silently dropping an unmapped path is how impact selection creates false confidence.
 *   2. A shared path (common component, network layer, router, store, deps) has no owning
 *      module. It escalates to every module that has coverage.
 *   3. Auth/session paths force a full run: a broken session invalidates every other result.
 *   4. Cross-module seams are additive and lane-aware. An Insurance change pulls in the
 *      Loss Mitigation Impound notification specs because that seam is observable in e2e —
 *      it does not pull in backend suites that cannot see it.
 *   5. Smoke selection can subtract specs but can never add one. The smoke lane is GET-only
 *      against production; this script never widens it beyond the committed smoke set.
 *
 * Usage:
 *   node scripts/execution/select-impacted.mjs --repo application --base origin/dev --head HEAD
 *   node scripts/execution/select-impacted.mjs --repo application --changed-files changed.txt
 *   git diff --name-only origin/dev...HEAD | node scripts/execution/select-impacted.mjs --repo application
 *   node scripts/execution/select-impacted.mjs --modules titles,unifi --lane e2e
 *
 * Options:
 *   --repo <application|ui-automation|backend-automation>  Which repo the changed files belong to.
 *   --base <ref> --head <ref>   Resolve changed files with git diff --name-only base...head.
 *   --changed-files <path>      Read newline-separated paths from a file ("-" = stdin).
 *   --modules <a,b,c>           Skip change analysis; select these module keys directly (on-demand runs).
 *   --lane <e2e|smoke|backend|all>   Restrict output to one lane. Default: all.
 *   --map <path>                Impact map. Default: sibling impact-map.json.
 *   --format <json|github|shell>     Output shape. Default: json.
 *   --explain                   Print the human-readable decision trail to stderr.
 *
 * Exit codes: 0 = selection produced (including "run everything"); 2 = usage/config error.
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LANES = ['e2e', 'smoke', 'backend'];

// ── argument parsing ────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const args = { lane: 'all', format: 'json', explain: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Option ${token} requires a value`);
      }
      i += 1;
      return value;
    };
    switch (token) {
      case '--repo': args.repo = next(); break;
      case '--base': args.base = next(); break;
      case '--head': args.head = next(); break;
      case '--changed-files': args.changedFiles = next(); break;
      case '--modules': args.modules = next(); break;
      case '--lane': args.lane = next(); break;
      case '--map': args.map = next(); break;
      case '--format': args.format = next(); break;
      case '--explain': args.explain = true; break;
      case '--help': case '-h': args.help = true; break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }
  return args;
}

// ── path helpers ────────────────────────────────────────────────────────────────
const normalise = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '').trim();

/**
 * A map entry ending in "/" is a directory prefix; anything else is an exact file.
 * Directory prefixes must not match by bare substring — "src/services/insurance/"
 * should not be satisfied by "src/services/insuranceOther.js".
 */
export function pathMatches(changedPath, mapEntry) {
  const file = normalise(changedPath);
  const entry = normalise(mapEntry);
  if (entry.endsWith('/')) return file === entry.slice(0, -1) || file.startsWith(entry);
  return file === entry || file.startsWith(`${entry}/`);
}

/** Cypress --spec accepts comma-separated globs. Empty selection means "nothing to run". */
const toSpecPattern = (globs) => [...new Set(globs)].sort().join(',');

// ── core selection ──────────────────────────────────────────────────────────────
export function select({ map, repo, changedPaths = [], explicitModules = null, lane = 'all' }) {
  const moduleKeys = Object.keys(map.modules);
  const covered = (key, laneName) => (map.modules[key]?.[`${laneName}Specs`] ?? map.modules[key]?.backendPaths ?? []).length > 0;

  const decision = {
    schema: 'fhf-impact-selection/v1',
    repo,
    lane,
    scope: 'impacted',
    forcedFull: false,
    modules: [],
    reasons: [],
    unmapped: [],
    changedFileCount: changedPaths.length,
  };

  const add = (key, reason) => {
    if (!moduleKeys.includes(key)) return;
    if (!decision.modules.includes(key)) decision.modules.push(key);
    decision.reasons.push(reason);
  };
  const forceFull = (reason) => {
    decision.forcedFull = true;
    decision.scope = 'full';
    decision.reasons.push(reason);
  };

  // On-demand path: the QA named the modules, so trust them but still expand seams.
  if (explicitModules) {
    if (explicitModules.includes('all')) {
      forceFull({ trigger: 'operator', detail: 'operator selected all modules' });
      decision.modules = moduleKeys.filter((k) => LANES.some((l) => covered(k, l)));
    } else {
      for (const key of explicitModules) {
        if (!moduleKeys.includes(key)) {
          throw new Error(`Unknown module key "${key}". Known: ${moduleKeys.join(', ')}`);
        }
        add(key, { trigger: 'operator', detail: `operator selected ${key}` });
      }
    }
  } else if (repo === 'application') {
    for (const file of changedPaths) {
      // Rule 3 — auth first; it outranks everything.
      if (map.auth.paths.some((p) => pathMatches(file, p))) {
        forceFull({ trigger: 'auth', path: file, detail: 'session/authorization path changed' });
      }
      // Rule 2 — shared blast radius.
      const sharedHit = map.shared.paths.find((p) => pathMatches(file, p));
      if (sharedHit) {
        forceFull({ trigger: 'shared', path: file, detail: `matches shared path ${sharedHit}` });
        continue;
      }
      // Rule for direct module ownership.
      let owned = false;
      for (const key of moduleKeys) {
        if (map.modules[key].applicationPaths.some((p) => pathMatches(file, p))) {
          add(key, { trigger: 'direct', path: file, detail: `owned by ${key}` });
          owned = true;
        }
      }
      if (owned) continue;
      // Rule 1 — never silently drop a source change.
      if (normalise(file).startsWith('src/')) {
        decision.unmapped.push(normalise(file));
        forceFull({ trigger: 'unmapped', path: file, detail: 'source path not attributable to a module' });
      }
      // Non-src changes (docs, README, .github, tooling) select nothing on their own.
    }
  } else if (repo === 'ui-automation') {
    for (const file of changedPaths) {
      const f = normalise(file);
      if (/^cypress\/tests\/fhf-dashboard\/(e2e|smoke)\//.test(f)) {
        // A changed spec runs itself, and its module comes along for seam expansion.
        decision.reasons.push({ trigger: 'spec', path: f, detail: 'changed spec runs directly' });
        (decision.directSpecs ??= []).push(f);
        for (const key of moduleKeys) {
          const globs = [...map.modules[key].e2eSpecs, ...map.modules[key].smokeSpecs];
          if (globs.some((g) => f.startsWith(g.replace(/\*\*.*$/, '')))) add(key, { trigger: 'spec-owner', path: f, detail: key });
        }
        continue;
      }
      // Shared automation plumbing: commands, support, page objects, config, deps.
      if (/^(cypress\/(support|commands|fixtures|e2e-utils)\/|cypress\.config|package(-lock)?\.json|scripts\/)/.test(f)
          || /^CypressFHF\/fhf-dashboards\/(cypress\/(support|commands|fixtures)\/|cypress\.config|package(-lock)?\.json|scripts\/)/.test(f)) {
        forceFull({ trigger: 'automation-shared', path: f, detail: 'shared automation plumbing changed' });
      }
    }
  } else if (repo === 'backend-automation') {
    for (const file of changedPaths) {
      const f = normalise(file);
      let owned = false;
      for (const key of moduleKeys) {
        if (map.modules[key].backendPaths.some((p) => pathMatches(f, p))) {
          add(key, { trigger: 'direct', path: f, detail: `owned by ${key}` });
          owned = true;
        }
      }
      if (owned) continue;
      if (/^(tests\/(conftest\.py|constants\.py|commons\/)|api\/|db\/|dao\/|helpers\/|util\/|pytest\.ini|requirements\.txt)/.test(f)) {
        forceFull({ trigger: 'backend-shared', path: f, detail: 'shared backend layer changed' });
      }
    }
  } else {
    throw new Error(`--repo must be application | ui-automation | backend-automation (got "${repo}")`);
  }

  // Rule 4 — lane-aware cross-module seam expansion (one hop, deliberately not transitive:
  // transitive closure over 12 edges degenerates to "run everything" and stops being a signal).
  if (!decision.forcedFull) {
    const seeds = [...decision.modules];
    for (const edge of map.crossModuleEdges) {
      if (!seeds.includes(edge.from)) continue;
      const relevant = lane === 'all' ? edge.observableBy : edge.observableBy.filter((l) => l === lane);
      if (relevant.length === 0) continue;
      add(edge.to, {
        trigger: 'cross-module',
        from: edge.from,
        detail: edge.seam,
        observableBy: relevant,
      });
    }
  }

  if (decision.forcedFull) {
    decision.modules = moduleKeys.filter((k) => LANES.some((l) => covered(k, l)));
  }
  decision.modules.sort();

  // ── lane output ───────────────────────────────────────────────────────────────
  const e2eGlobs = [];
  const smokeGlobs = [];
  const backendPaths = [];
  for (const key of decision.modules) {
    e2eGlobs.push(...map.modules[key].e2eSpecs);
    smokeGlobs.push(...map.modules[key].smokeSpecs);
    backendPaths.push(...map.modules[key].backendPaths);
  }
  if (decision.forcedFull && map.auth.forcesFullRun) {
    e2eGlobs.push(...map.auth.e2eSpecs);
    smokeGlobs.push(...map.auth.smokeSpecs);
  }
  if (decision.directSpecs) {
    for (const spec of decision.directSpecs) {
      (spec.includes('/smoke/') ? smokeGlobs : e2eGlobs).push(spec);
    }
  }

  decision.selection = {
    e2e: { specPattern: toSpecPattern(e2eGlobs), moduleCount: decision.modules.filter((k) => map.modules[k].e2eSpecs.length).length },
    smoke: { specPattern: toSpecPattern(smokeGlobs), moduleCount: decision.modules.filter((k) => map.modules[k].smokeSpecs.length).length },
    backend: { pytestPaths: [...new Set(backendPaths)].sort(), moduleCount: decision.modules.filter((k) => map.modules[k].backendPaths.length).length },
  };

  // Modules with no automation in any lane are a coverage gap, not a passing result.
  decision.modulesWithNoCoverage = decision.modules.filter(
    (k) => !map.modules[k].e2eSpecs.length && !map.modules[k].smokeSpecs.length && !map.modules[k].backendPaths.length,
  );
  decision.gaps = decision.modules
    .filter((k) => !map.modules[k].e2eSpecs.length || !map.modules[k].backendPaths.length)
    .map((k) => ({
      module: k,
      missingE2e: map.modules[k].e2eSpecs.length === 0,
      missingSmoke: map.modules[k].smokeSpecs.length === 0,
      missingBackend: map.modules[k].backendPaths.length === 0,
    }));

  return decision;
}

// ── i/o ─────────────────────────────────────────────────────────────────────────
function readChangedPaths(args) {
  if (args.changedFiles) {
    const raw = args.changedFiles === '-'
      ? readFileSync(0, 'utf8')
      : readFileSync(resolve(args.changedFiles), 'utf8');
    return raw.split('\n').map(normalise).filter(Boolean);
  }
  if (args.base) {
    const range = `${args.base}...${args.head ?? 'HEAD'}`;
    const out = execFileSync('git', ['diff', '--name-only', range], { encoding: 'utf8' });
    return out.split('\n').map(normalise).filter(Boolean);
  }
  // No explicit source: read stdin if it is a pipe.
  try {
    return readFileSync(0, 'utf8').split('\n').map(normalise).filter(Boolean);
  } catch {
    return [];
  }
}

function emit(decision, format) {
  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
    return;
  }
  const lines = [
    `scope=${decision.scope}`,
    `forced_full=${decision.forcedFull}`,
    `modules=${decision.modules.join(',')}`,
    `e2e_spec=${decision.selection.e2e.specPattern}`,
    `smoke_spec=${decision.selection.smoke.specPattern}`,
    `backend_paths=${decision.selection.backend.pytestPaths.join(' ')}`,
    `unmapped=${decision.unmapped.join(',')}`,
  ];
  if (format === 'github') {
    process.stdout.write(`${lines.join('\n')}\n`);
    return;
  }
  if (format === 'shell') {
    process.stdout.write(`${lines.map((l) => {
      const [k, ...rest] = l.split('=');
      return `${k.toUpperCase()}='${rest.join('=')}'`;
    }).join('\n')}\n`);
    return;
  }
  throw new Error(`--format must be json | github | shell (got "${format}")`);
}

const USAGE = `select-impacted.mjs — change-based test selection

  --repo <application|ui-automation|backend-automation>
  --base <ref> [--head <ref>]      resolve changes via git diff
  --changed-files <path|->          read newline-separated paths
  --modules <a,b,c|all>            select modules directly (on-demand)
  --lane <e2e|smoke|backend|all>    default all
  --map <path>                     default ./impact-map.json
  --format <json|github|shell>      default json
  --explain                        decision trail to stderr
`;

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (args.help) { process.stdout.write(USAGE); return; }

  const mapPath = args.map ? resolve(args.map) : resolve(HERE, 'impact-map.json');
  if (!existsSync(mapPath)) {
    process.stderr.write(`Impact map not found: ${mapPath}\n`);
    process.exit(2);
  }
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));

  try {
    const explicitModules = args.modules
      ? args.modules.split(',').map((s) => s.trim()).filter(Boolean)
      : null;
    const changedPaths = explicitModules ? [] : readChangedPaths(args);
    if (!explicitModules && !args.repo) {
      throw new Error('--repo is required when selecting from changed files');
    }
    const decision = select({
      map,
      repo: args.repo ?? 'application',
      changedPaths,
      explicitModules,
      lane: args.lane,
    });
    if (args.explain) {
      process.stderr.write(`\nDecision: scope=${decision.scope} modules=${decision.modules.join(',') || '(none)'}\n`);
      for (const r of decision.reasons) {
        process.stderr.write(`  · [${r.trigger}] ${r.path ?? r.from ?? ''} → ${r.detail}\n`);
      }
      if (decision.unmapped.length) {
        process.stderr.write(`  ! unmapped source paths forced a full run:\n${decision.unmapped.map((p) => `      ${p}`).join('\n')}\n`);
      }
      if (decision.gaps.length) {
        process.stderr.write('  ? coverage gaps in the selected modules:\n');
        for (const g of decision.gaps) {
          const missing = [g.missingE2e && 'e2e', g.missingSmoke && 'smoke', g.missingBackend && 'backend'].filter(Boolean);
          process.stderr.write(`      ${g.module}: no ${missing.join(', ')} automation\n`);
        }
      }
      process.stderr.write('\n');
    }
    emit(decision, args.format);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
