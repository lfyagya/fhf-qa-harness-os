#!/usr/bin/env node
/**
 * cloud-access-doctor.mjs — detect existing Cypress Cloud access before configuring anything.
 *
 * "Look first, configure only what is missing."
 *
 * Cypress Cloud has TWO independent access paths, and they are frequently confused because both
 * are called "a Cypress Cloud token". They are not the same credential:
 *
 *   Cloud MCP   remote server https://mcp.cypress.io/mcp, used by AI clients.
 *               PAT generated under Cloud profile -> "MCP personal access token".
 *               Conventional env var: CYPRESS_MCP_TOKEN (per Cypress's own client examples).
 *               OAuth is the recommended method and needs no env var at all.
 *
 *   Cloud CLI   local binary `cy-cloud`, used by humans, scripts, and shell-running agents.
 *               PAT generated under Cloud profile -> "Cloud CLI access" -> "Personal access token".
 *               Env var read: CYPRESS_CLOUD_TOKEN — this is the ONLY name cy-cloud reads.
 *               `cy-cloud login` stores credentials so no env var is needed.
 *
 * They are separate PATs, separate org integrations, and separate 100-request/hour limits. So
 * CYPRESS_CLOUD_TOKEN is not "taken" by the MCP — putting an MCP token there is what creates the
 * appearance of a conflict.
 *
 * THE PRECEDENCE TRAP this script exists to catch: CYPRESS_CLOUD_TOKEN takes precedence over
 * credentials stored by `cy-cloud login`. So a wrong or MCP-issued value in that variable silently
 * overrides a perfectly good stored CLI session, and every command fails with an auth error that
 * looks like the stored login never worked.
 *
 * This script NEVER reads, prints, logs, or transmits a token value. It reports presence only.
 *
 * Usage:
 *   node scripts/execution/cloud-access-doctor.mjs
 *   node scripts/execution/cloud-access-doctor.mjs --json
 *   node scripts/execution/cloud-access-doctor.mjs --probe   # also runs `cy-cloud status` (network)
 *   node scripts/execution/cloud-access-doctor.mjs --strict  # exit 1 on any error-level finding
 *
 * Exit codes: 0 = at least one path is usable; 1 = neither is usable; 2 = script error.
 */

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_NODE = [22, 21, 0];

// Presence only. The value is never read into a variable that could be printed.
const isSet = (name) => {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
};

export function compareVersion(actual, min) {
  const a = String(actual).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < min.length; i += 1) {
    if ((a[i] ?? 0) > min[i]) return 1;
    if ((a[i] ?? 0) < min[i]) return -1;
  }
  return 0;
}

function cliConfigDir() {
  // Per the CLI docs: ~/.config/cy-cloud, or $XDG_CONFIG_HOME/cy-cloud when set.
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, 'cy-cloud') : join(homedir(), '.config', 'cy-cloud');
}

function which(cmd) {
  try {
    const finder = platform() === 'win32' ? 'where' : 'which';
    return execFileSync(finder, [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/)[0].trim() || null;
  } catch {
    return null;
  }
}

/**
 * Project-level MCP configs. `.mcp.json` at the repo root is the shared project scope; worktrees and
 * sibling checkouts each carry their own and drift independently, which is exactly how a stale
 * variable reference survives a rename.
 */
const REPO_ROOT_FOR_SCAN = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const MCP_CONFIG_CANDIDATES = [
  join(REPO_ROOT_FOR_SCAN, '.mcp.json'),
  join(REPO_ROOT_FOR_SCAN, '.cursor', 'mcp.json'),
  join(REPO_ROOT_FOR_SCAN, '.vscode', 'mcp.json'),
  join(REPO_ROOT_FOR_SCAN, '.codex-worktrees', 'fix-prod-reporter', '.mcp.json'),
];

/** Known AI-client MCP config locations. Presence of the file only; contents are not parsed for secrets. */
function mcpClientConfigs() {
  const home = homedir();
  const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
  return [
    { client: 'Claude Desktop', path: join(appData, 'Claude', 'claude_desktop_config.json') },
    { client: 'Claude Desktop (macOS)', path: join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json') },
    { client: 'Claude Code (user)', path: join(home, '.claude.json') },
    { client: 'Cursor', path: join(home, '.cursor', 'mcp.json') },
    { client: 'Codex CLI', path: join(home, '.codex', 'config.toml') },
    { client: 'Copilot CLI', path: join(home, '.copilot', 'mcp-config.json') },
  ].filter((c) => existsSync(c.path));
}

export function diagnose(env = process.env, opts = {}) {
  const findings = [];
  const add = (level, area, message, action = null) => findings.push({ level, area, message, action });

  // ── Runtime ──
  const nodeOk = compareVersion(process.version, MIN_NODE) >= 0;
  add(nodeOk ? 'ok' : 'error', 'runtime',
    `Node ${process.version} (Cloud CLI requires >= ${MIN_NODE.join('.')})`,
    nodeOk ? null : `Upgrade Node to ${MIN_NODE.join('.')} or later; cy-cloud will not run otherwise.`);

  // ── CLI binary ──
  const cliPath = opts.cliPath !== undefined ? opts.cliPath : which('cy-cloud');
  add(cliPath ? 'ok' : 'warn', 'cli-install',
    cliPath ? `cy-cloud found at ${cliPath}` : 'cy-cloud is not on PATH',
    cliPath ? null : 'npm install --global @cypress/cloud');

  // ── Credential presence, by the name each tool actually reads ──
  const cloudTokenSet = isSet('CYPRESS_CLOUD_TOKEN');
  const mcpTokenSet = isSet('CYPRESS_MCP_TOKEN');
  const strayCliTokenSet = isSet('CYPRESS_CLOUD_CLI_TOKEN');
  const recordKeySet = isSet('CYPRESS_RECORD_KEY');

  const storedDir = opts.cliConfigDir !== undefined ? opts.cliConfigDir : cliConfigDir();
  const storedAuth = join(storedDir, 'auth.json');
  const storedAuthExists = existsSync(storedAuth);

  add('info', 'credentials',
    `CYPRESS_CLOUD_TOKEN ${cloudTokenSet ? 'set' : 'not set'} · `
    + `CYPRESS_MCP_TOKEN ${mcpTokenSet ? 'set' : 'not set'} · `
    + `CYPRESS_CLOUD_CLI_TOKEN ${strayCliTokenSet ? 'set' : 'not set'} · `
    + `CYPRESS_RECORD_KEY ${recordKeySet ? 'set' : 'not set'} (values never read)`);

  // ── The misnaming that looks like a conflict ──
  if (strayCliTokenSet) {
    add('error', 'naming',
      'CYPRESS_CLOUD_CLI_TOKEN is set, but nothing reads that name. cy-cloud reads only CYPRESS_CLOUD_TOKEN.',
      'Either rename this variable to CYPRESS_CLOUD_TOKEN, or drop it and run `cy-cloud login` once to store the credential.');
  }
  if (cloudTokenSet && mcpTokenSet) {
    add('ok', 'naming',
      'Both tokens are present under their correct, distinct names. MCP and CLI can coexist with no conflict.');
  }
  if (cloudTokenSet && !mcpTokenSet && strayCliTokenSet) {
    add('warn', 'naming',
      'CYPRESS_CLOUD_TOKEN is set while the CLI token sits under an unread name — a strong sign the MCP token was '
      + 'placed in CYPRESS_CLOUD_TOKEN. That variable is read by cy-cloud, not by the MCP.',
      'Move the MCP token to CYPRESS_MCP_TOKEN (or use MCP OAuth), then put the Cloud-CLI PAT in CYPRESS_CLOUD_TOKEN.');
  }

  // ── The precedence trap ──
  if (cloudTokenSet && storedAuthExists) {
    add('warn', 'precedence',
      'CYPRESS_CLOUD_TOKEN is set AND stored CLI credentials exist. The environment variable WINS, so the stored '
      + '`cy-cloud login` session is bypassed. If the variable holds an MCP token or an expired PAT, every CLI '
      + 'command fails even though the stored login is valid.',
      'Unset CYPRESS_CLOUD_TOKEN to use the stored session, or confirm the variable holds a Cloud-CLI PAT.');
  }

  // ── Usable paths ──
  const cliAuthPath = cloudTokenSet ? 'env:CYPRESS_CLOUD_TOKEN' : (storedAuthExists ? `stored:${storedAuth}` : null);
  add(cliAuthPath ? 'ok' : 'error', 'cli-auth',
    cliAuthPath ? `Cloud CLI auth resolves via ${cliAuthPath}` : 'Cloud CLI has no credential: no env var and no stored login',
    cliAuthPath ? null
      : 'Run `cy-cloud login` (OAuth, recommended) in your own shell. Never in an agent transcript — the harness '
        + 'inlineCredentialPatterns guard blocks credential handling by agents deliberately.');

  const clients = opts.mcpClients !== undefined ? opts.mcpClients : mcpClientConfigs();
  if (clients.length) {
    add('ok', 'mcp-client',
      `MCP-capable client config found: ${clients.map((c) => c.client).join(', ')}`);
  } else {
    add('warn', 'mcp-client', 'No known AI-client MCP config file found on this machine.',
      'Add the remote server https://mcp.cypress.io/mcp to your client. OAuth is recommended and needs no token.');
  }

  // ── Stale variable references inside MCP configs ──
  // An MCP config that interpolates ${CYPRESS_CLOUD_TOKEN} sends the CLI's credential to the MCP
  // server. That is wrong on its own, and it breaks outright the moment the variables are renamed
  // to their correct distinct names. Scanned for the reference only; values are never resolved.
  const configsToScan = opts.mcpConfigFiles !== undefined
    ? opts.mcpConfigFiles
    : [...MCP_CONFIG_CANDIDATES.map((p) => p).filter((p) => existsSync(p)), ...clients.map((c) => c.path)];

  for (const path of [...new Set(configsToScan)]) {
    let text;
    try { text = readFileSync(path, 'utf8'); } catch { continue; }
    if (!/mcp\.cypress\.io/.test(text)) continue;

    const refsCliVar = /\$\{?CYPRESS_CLOUD_TOKEN\}?/.test(text);
    const refsMcpVar = /\$\{?CYPRESS_MCP_TOKEN\}?/.test(text);
    const hasAuthHeader = /"Authorization"\s*:/i.test(text) || /bearer_token_env_var/.test(text);

    if (refsCliVar) {
      add('error', 'mcp-config',
        `${path} authenticates Cloud MCP with \${CYPRESS_CLOUD_TOKEN} — that is the Cloud CLI's variable.`,
        'Change it to ${CYPRESS_MCP_TOKEN}, or remove the Authorization header entirely to use OAuth.');
    } else if (!hasAuthHeader) {
      add('ok', 'mcp-config',
        `${path} has no Authorization header, so Cloud MCP uses OAuth. No token variable is involved.`);
    } else if (refsMcpVar) {
      add('ok', 'mcp-config', `${path} correctly references \${CYPRESS_MCP_TOKEN}.`);
    }
  }

  // ── Org integrations: cannot be detected locally ──
  add('info', 'org-integration',
    'Cloud MCP and Cloud CLI are TWO separate org integrations. Each must be enabled by an org admin on the '
    + "organization's Integrations page. Until enabled, every authenticated call fails regardless of credential.");

  add('info', 'limits',
    'Each path is rate-limited to 100 requests/hour per user. Paginate with --limit 100 rather than one request per test.');

  add('info', 'capability',
    'Only Cloud MCP exposes UI Coverage (cypress_get_ui_coverage_report / _views / _elements). The CLI does not. '
    + 'Use MCP for the per-view numbers that set coverage-ratchet R3 floors.');

  add('info', 'smart-orchestration',
    'Cloud Re-run Optimization (failed specs only) is a Cypress Cloud Smart Orchestration setting for projects nptdoe (E2E) and r5k1ro (Smoke). CI passes CYPRESS_RERUN_GROUP_ID so retries can key off the prior group; enable "Run only failed specs" in Cloud UI.',
    'Org/project admin: Cloud → Smart Orchestration → Run only failed specs. Docs: https://docs.cypress.io/cloud/features/smart-orchestration/rerun-optimization');

  add('info', 'mcp-auth',
    'Cursor project .mcp.json already points at https://mcp.cypress.io/mcp with OAuth (no Authorization header). If the Cypress Cloud MCP server shows error/needsAuth in Cursor, reconnect via the MCP auth prompt — agents never login.',
    'In Cursor: open MCP settings → Cypress Cloud → Connect / Authenticate. Prefer OAuth over pasting a PAT.');
  const usable = Boolean(cliAuthPath) || clients.length > 0;
  return { usable, findings, cliPath, storedAuth: storedAuthExists ? storedAuth : null };
}

function probe() {
  try {
    const out = execFileSync('cy-cloud', ['status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output: out.trim() };
  } catch (error) {
    return { ok: false, output: (error.stderr || error.stdout || error.message || '').toString().trim() };
  }
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const strict = args.includes('--strict');
  const doProbe = args.includes('--probe');

  const result = diagnose();
  if (doProbe && result.cliPath) result.probe = probe();

  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const mark = { ok: ' ok ', warn: 'warn', error: 'FAIL', info: 'info' };
    process.stdout.write('\nCypress Cloud access — detected state\n\n');
    for (const f of result.findings) {
      process.stdout.write(`  [${mark[f.level]}] ${f.area}: ${f.message}\n`);
      if (f.action) process.stdout.write(`           -> ${f.action}\n`);
    }
    if (result.probe) {
      process.stdout.write(`\n  cy-cloud status: ${result.probe.ok ? result.probe.output : `failed — ${result.probe.output}`}\n`);
    }
    process.stdout.write(`\nVerdict: ${result.usable ? 'at least one Cloud access path is configured' : 'no usable Cloud access path'}\n\n`);
  }
  const hasErrors = result.findings.some((f) => f.level === 'error');
  process.exit((!result.usable || (strict && hasErrors)) ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
