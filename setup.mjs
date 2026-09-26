#!/usr/bin/env node
// FHF QA engine setup. Same command for a new machine and for an engine update:
//   node setup.mjs [workspace-dir]     (default: ../FHF-GSD-Workspace)
// 1. clones missing FHF repos (existing checkouts are never touched)
// 2. installs GSD Core (pinned) locally into the workspace for Claude Code, Cursor and Codex
// 3. copies the FHF QA layer (overlay/) on top
// 4. writes .claude/settings.json: permissions + team plugins
// 5. registers the Oracle SQLcl MCP connector
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GSD_CORE = '@opengsd/gsd-core@1.14.0'; // bump deliberately, then re-run setup
const engine = dirname(fileURLToPath(import.meta.url));
const ws = resolve(process.argv[2] ?? process.env.FHF_WORKSPACE ?? join(engine, '..', 'FHF-GSD-Workspace'));
const repos = JSON.parse(readFileSync(join(engine, 'repos.json'), 'utf8'));
const run = (cmd, args, cwd, shell = false) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell });

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error(`Node 24+ required (GSD Core), found ${process.version}.`);
  process.exit(1);
}
mkdirSync(ws, { recursive: true });
console.log(`Workspace: ${ws}`);

// 1. Clone what's missing. ponytail: no pull — a QA member's local branch is theirs.
const failed = [];
for (const [name, { url, branch }] of Object.entries({ ...repos.lanes, ...repos.readOnly })) {
  if (existsSync(join(ws, name))) continue;
  try { run('git', ['clone', '-b', branch, url, name], ws); } catch { failed.push(name); }
}

// 2. GSD Core, local to the workspace. shell: npx is npx.cmd on Windows.
run('npx', ['--yes', GSD_CORE, '--claude', '--cursor', '--codex', '--local'], ws, true);

// 3. FHF QA layer. Overwrites FHF files only; GSD files keep their gsd- prefix.
const overlay = join(engine, 'overlay');
cpSync(overlay, ws, { recursive: true });
cpSync(join(overlay, 'CLAUDE.md'), join(ws, 'AGENTS.md')); // Cursor + Codex read AGENTS.md
for (const rt of ['.cursor', '.codex']) {
  cpSync(join(overlay, '.claude', 'skills'), join(ws, rt, 'skills'), { recursive: true });
}

// 4. Hard boundaries as native permissions (not hooks): product source is read-only,
// production smoke artifacts carry customer data, secrets stay unread.
const smoke = '/front-end-automation-smoke/CypressFHF/fhf-dashboards';
const deny = [
  ...Object.keys(repos.readOnly).map((r) => `Edit(/${r}/**)`),
  ...['cypress/screenshots', 'cypress/videos', 'cypress/downloads', 'reports'].map((p) => `Read(${smoke}/${p}/**)`),
  'Read(/front-end-automation-smoke/reports/**)',
  'Read(**/.env)',
  'Read(**/.npmrc)',
  'Bash(git push:*)',
  // SQLcl MCP: no DB writes (annotations) and no skill downloads. ponytail: sql_run can't be
  // filtered by statement; use a read-only DB user for fhf-dev if DML must be impossible.
  'mcp__oracle-sqlcl__annotation_generate',
  'mcp__oracle-sqlcl__skills_sync',
];
const settingsPath = join(ws, '.claude', 'settings.json');
const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
settings.permissions = { ...settings.permissions, deny };
// Team plugins: Claude Code offers to install these when a member trusts the workspace.
settings.extraKnownMarketplaces = {
  ...settings.extraKnownMarketplaces,
  papercuts: { source: { source: 'github', repo: 'claylevering/papercuts' } },
};
settings.enabledPlugins = { ...settings.enabledPlugins, 'papercuts@papercuts': true };
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

// 5. Oracle SQLcl MCP (needs `sql` on PATH + a saved `fhf-dev` connection; see ONBOARDING).
for (const file of ['.mcp.json', join('.cursor', 'mcp.json')]) {
  const p = join(ws, file);
  const cfg = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
  cfg.mcpServers = { ...cfg.mcpServers, 'oracle-sqlcl': { command: 'sql', args: ['-mcp'] } };
  writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
}

console.log(`\nFHF workspace ready. Open ${ws} (the root, not a lane) in Claude Code, Cursor or Codex.`);
console.log('Next: finish the one-time steps in ONBOARDING.md (lane deps, Oracle, papercuts).');
if (failed.length) {
  console.error(`\nCould not clone: ${failed.join(', ')} — check GitHub SSH access to treacyandcoventures, then re-run.`);
  process.exit(1);
}
