#!/usr/bin/env node
/**
 * night-brief.mjs — summarize latest failed Cypress Cloud runs for morning triage.
 *
 * Metadata only (no replay bodies / screenshots). Smoke-safe.
 *
 * Usage:
 *   node scripts/execution/night-brief.mjs
 *   node scripts/execution/night-brief.mjs --e2e-run 666 --smoke-run 161
 *   node scripts/execution/night-brief.mjs --json
 *
 * Requires authenticated `cy-cloud` (oauth or CYPRESS_CLOUD_TOKEN). Never prints tokens.
 * Writes a markdown brief to stdout; optionally appends a one-line note via
 * record-execution-evidence when --record is passed (harness-os script).
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECTS = { e2e: 'nptdoe', smoke: 'r5k1ro' };

function parseArgs(argv) {
  const out = { e2eRun: null, smokeRun: null, json: false, record: false, limit: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--e2e-run') out.e2eRun = argv[++i];
    else if (a === '--smoke-run') out.smokeRun = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--record') out.record = true;
    else if (a === '--limit') out.limit = parseInt(argv[++i], 10) || 1;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function cyCloud(args) {
  const out = execFileSync('cy-cloud', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function latestFailedRun(projectId) {
  const data = cyCloud([
    'run', 'list',
    '--projectId', projectId,
    '--status', 'failed',
    '--limit', '1',
  ]);
  const runs = data.runs || data.data || [];
  return runs[0] || null;
}

function failedTests(projectId, runNumber) {
  const data = cyCloud([
    'test', 'list',
    '--projectId', projectId,
    '--runNumber', String(runNumber),
    '--status', 'failed',
    '--limit', '100',
  ]);
  return data.tests || data.data || [];
}

function clusterErrors(tests) {
  const clusters = new Map();
  for (const t of tests) {
    const msg = String(t.error?.message || t.errorMessage || t.title || 'unknown')
      .split('\n')[0]
      .slice(0, 160);
    if (!clusters.has(msg)) clusters.set(msg, []);
    clusters.get(msg).push({
      testId: t.testId || t.id,
      title: t.testName || t.title,
      spec: t.specPath || t.spec || t.file,
    });
  }
  return [...clusters.entries()].map(([error, items]) => ({ error, count: items.length, items }));
}

function summarizeLane(lane, projectId, runNumber) {
  let run = null;
  if (runNumber) {
    run = cyCloud(['run', 'get', '--projectId', projectId, '--runNumber', String(runNumber)]);
  } else {
    run = latestFailedRun(projectId);
  }
  if (!run) return { lane, projectId, run: null, clusters: [] };
  const number = run.runNumber || run.number || runNumber;
  const tests = number ? failedTests(projectId, number) : [];
  return {
    lane,
    projectId,
    run: {
      runNumber: number,
      status: run.status,
      branch: run.branch,
      sha: run.commitSha || run.sha,
      url: run.url || run.runUrl,
      passed: run.totalPassed ?? run.passed,
      failed: run.totalFailed ?? run.failed,
      flaky: run.totalFlaky ?? run.flaky,
    },
    clusters: clusterErrors(tests),
  };
}

function toMarkdown(summaries) {
  const lines = ['# Cypress night brief', '', `_Generated ${new Date().toISOString()}_`, ''];
  for (const s of summaries) {
    lines.push(`## ${s.lane} (\`${s.projectId}\`)`);
    if (!s.run) {
      lines.push('No failed run found.', '');
      continue;
    }
    const r = s.run;
    lines.push(
      `- Run **#${r.runNumber}** — ${r.status} — branch \`${r.branch || '?'}\` — sha \`${(r.sha || '?').slice(0, 8)}\``,
      `- Counts: passed=${r.passed ?? '?'} failed=${r.failed ?? '?'} flaky=${r.flaky ?? '?'}`,
    );
    if (r.url) lines.push(`- URL: ${r.url}`);
    lines.push('', '### Error clusters', '');
    if (!s.clusters.length) lines.push('_No failed tests listed (or CLI shape differed)._', '');
    for (const c of s.clusters.slice(0, 20)) {
      lines.push(`- **×${c.count}** ${c.error}`);
      for (const item of c.items.slice(0, 5)) {
        lines.push(`  - \`${item.spec || '?'}\` — ${item.title || '?'} (\`${item.testId || '?'}\`)`);
      }
    }
    lines.push('');
    if (s.lane === 'e2e' && s.clusters.length) {
      const exemplar = s.clusters[0].items[0];
      if (exemplar?.testId) {
        lines.push(
          '### Next (E2E debugger)',
          '```bash',
          `FHF_LANE=e2e cy-cloud replay timeline --testId ${exemplar.testId} --aroundFailure 5 --commands --network --logs`,
          '```',
          '',
        );
      }
    } else if (s.lane === 'smoke') {
      lines.push('_Smoke is metadata-only — do not pull replay timelines without owner opt-in._', '');
    }
  }
  lines.push('See `docs/framework/triage-runbook.md`.');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`night-brief.mjs — latest failed Cloud runs (metadata only)

  --e2e-run <n>     pin E2E run number (default: latest failed)
  --smoke-run <n>   pin Smoke run number
  --json            machine-readable
  --record          reserved (use record-execution-evidence.mjs manually)
`);
    process.exit(0);
  }

  const summaries = [
    summarizeLane('e2e', PROJECTS.e2e, args.e2eRun),
    summarizeLane('smoke', PROJECTS.smoke, args.smokeRun),
  ];

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), summaries }, null, 2)}\n`);
  } else {
    process.stdout.write(toMarkdown(summaries));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
