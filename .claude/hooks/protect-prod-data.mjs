#!/usr/bin/env node
// PreToolUse:Read|Bash|PowerShell — block agent access to production-data artifacts by default.
// exit 2 = BLOCK the tool call.
//
// Why this exists (2026-07-27): the smoke lane runs against LIVE PRODUCTION, so every
// failure screenshot, mochawesome report and downloaded file contains real customer
// records — names, VINs, loan numbers, invoice numbers, dealer names. Nothing stopped an
// agent from reading them: settings.json only gated Edit|Write, Bash and Task, so `Read`
// was completely ungated, and a failure screenshot was opened during triage with all of
// that data in frame. The image was needed for LAYOUT (a filter panel's open/closed
// state); the customer data came along for the ride and entered model context.
//
// Policy: artifacts are readable for UI/layout diagnosis ONLY on explicit, per-session
// owner opt-in. The owner says so; the agent never grants itself access.
//
// Opt-in is an environment variable on purpose, not a file the agent can create:
//   FHF_ALLOW_PROD_DATA=1
// Shell state does not persist between agent Bash calls, so the agent cannot set this for
// itself — only the human launching the session can. That is the point.
//
// Lane-aware Cloud CLI (2026-08-05): connectors.cypressCloud.cli.laneAccess grants E2E
// full-read. When FHF_LANE=e2e (or the tool cwd is the E2E package), allow
// `cy-cloud replay info|timeline` and `test get --screenshot`. Smoke and root stay
// metadata-only unless FHF_ALLOW_PROD_DATA=1.
//
// This guards INGEST (agent reading). It does NOT fix EGRESS — screenshots are still
// base64-inlined into HTML reports (cypress.config.js embeddedScreenshots/inlineAssets),
// still uploaded as CodeBuild artifacts and emailed (buildspec.yml), and Test Replay still
// ships prod DOM snapshots to Cypress Cloud. Those are tracked separately and remain open.
//
// See .claude/rules/prod-data-handling.md for the full policy.
import { readFileSync } from 'fs';
import { detectLane, loadHarnessConfig } from './lib/harness-config.mjs';
import { hookFilePath, hookInput } from './lib/hook-payload.mjs';
import { emitAllow } from './lib/hook-runtime.mjs';

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  emitAllow(payload);
  process.exit(0);
}
process.on('exit', code => code === 0 && emitAllow(payload));

if (process.env.FHF_ALLOW_PROD_DATA === '1') process.exit(0);

const harness = loadHarnessConfig();
const cloudGuard = harness.connectors?.cypressCloud?.cli?.guard ?? {};
const laneAccess = harness.connectors?.cypressCloud?.cli?.laneAccess ?? {};
const CLOUD_SAFE_FLAGS = cloudGuard.safeNoNetworkFlags ?? [];
const CLOUD_SENSITIVE = (cloudGuard.productionSensitivePatterns ?? [])
  .map((source) => new RegExp(source, 'i'));

// Artifacts that carry real production records.
const PROD_ARTIFACT = /(cypress\/(screenshots|videos|downloads)\/|reports\/mocha|mochaReports|reports\/[^/]*\.(html|json))/i;
// JUnit XML is test names and timings only — no row data. Needed for triage, safe to read.
const SAFE = /reports\/junit\/[^/]*\.xml$/i;

function deny(what, detail) {
  console.error(`BLOCKED: ${what} holds live production customer data (smoke runs against prod).`);
  if (detail) console.error(detail);
  console.error('');
  console.error('These artifacts are for UI/layout diagnosis only, on explicit owner opt-in —');
  console.error('never to read, transcribe, or summarise customer records.');
  console.error('If you need it, ask the owner; they re-launch with FHF_ALLOW_PROD_DATA=1.');
  console.error('The agent must not set this itself.');
  console.error('For E2E Test Replay only: set FHF_LANE=e2e on the shell command, or run from');
  console.error('the configured E2E checkout.');
  console.error('Safe alternatives: reports/junit/*.xml, the Cypress Cloud MCP or CLI');
  console.error('run/spec/test metadata lists, or the terminal run log.');
  process.exit(2);
}

/** E2E full-read context: explicit lane env, or cwd under the E2E package and not smoke. */
export function isE2eFullReadContext(payloadObj = {}, command = '', env = process.env, config = harness) {
  // Inline env on the command itself (agents cannot persist shell env across Bash calls).
  if (/\bFHF_LANE\s*=\s*['"]?e2e\b/i.test(command)) return true;
  if (String(env.FHF_LANE || '').toLowerCase() === 'e2e') return true;
  if (String(laneAccess.e2e || '') !== 'full-read') return false;

  const cwd = String(
    payloadObj?.cwd
    || payloadObj?.tool_input?.working_directory
    || env.CURSOR_PROJECT_DIR
    || env.CLAUDE_PROJECT_DIR
    || process.cwd()
    || '',
  ).replace(/\\/g, '/');
  const lane = detectLane(cwd, config);
  if (lane === 'smoke') return false;
  return lane === 'e2e';
}

const toolName = payload?.tool_name ?? payload?.name ?? '';

// ── Read (and any file-path-bearing tool) ──
const filePath = hookFilePath(payload);
if (filePath && PROD_ARTIFACT.test(filePath) && !SAFE.test(filePath)) {
  deny(filePath);
}

// ── Shell — protected artifact references default-deny ──
// Only single, metadata-only commands may name a production artifact. Content readers,
// interpreters, redirects, substitutions, pipes, and chained commands are denied.
if (/^(?:bash|shell|powershell)$/i.test(toolName) || payload?.tool_input?.command) {
  const cmd = String(hookInput(payload).command ?? '');
  const normalised = cmd.replace(/\\/g, '/');
  const lowerCmd = cmd.toLowerCase();
  const isNoNetworkInspection = !/[;&|]/.test(cmd) && CLOUD_SAFE_FLAGS
    .some((flag) => lowerCmd.includes(String(flag).toLowerCase()));
  const e2eFullRead = isE2eFullReadContext(payload, cmd);
  if (
    !isNoNetworkInspection
    && !e2eFullRead
    && CLOUD_SENSITIVE.some((pattern) => pattern.test(cmd))
  ) {
    deny(
      'that Cypress Cloud CLI command',
      'Test Replay and downloaded failure screenshots can contain live production customer data.',
    );
  }
  if (
    PROD_ARTIFACT.test(normalised) &&
    !isMetadataOnlyCommand(cmd)
  ) {
    deny('that command', `Command: ${cmd.slice(0, 200)}`);
  }
}

process.exit(0);

function isMetadataOnlyCommand(command) {
  const value = command.trim();
  if (!value || /[\r\n;&|><`$]/.test(value)) return false;
  const executable = value.match(/^([a-z-]+)/i)?.[1]?.toLowerCase();
  return new Set([
    'dir',
    'du',
    'get-childitem',
    'get-item',
    'gci',
    'gi',
    'ls',
    'stat',
    'test-path',
  ]).has(executable);
}
