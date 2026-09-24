#!/usr/bin/env node
// PreToolUse:Edit|Write — block wiki/.raw scaffolding landing outside the configured vault.
// engineering.harness.boundaries.secondBrain owns the vault directory and scaffold names.
// A drive-letter path stays a drive-letter path on every host, so the same payload
// matches on Linux and Windows. exit 2 = BLOCK.
import { readFileSync } from 'fs';
import { hookFilePath } from './lib/hook-payload.mjs';
import { emitAllow } from './lib/hook-runtime.mjs';
import { loadHarnessConfig } from './lib/harness-config.mjs';

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  emitAllow(payload);
  process.exit(0);
}

function slash(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function isAbsolute(value) {
  return value.startsWith("/") || /^[A-Za-z]:\//.test(value);
}

function boundaryPath(root, filePath) {
  const file = slash(filePath);
  if (isAbsolute(file)) return file.replace(/\/+$/, "");
  const base = slash(root).replace(/\/+$/, "");
  const relative = file.replace(/^\.\//, "");
  return relative ? `${base}/${relative}`.replace(/\/+/g, "/") : base;
}

const config = loadHarnessConfig();
const boundary = config.engineering?.harness?.boundaries?.secondBrain ?? {};
const vault = String(boundary.vaultDirectory ?? "claude-obsidian");
const scaffolds = Array.isArray(boundary.scaffoldDirectories) && boundary.scaffoldDirectories.length
  ? boundary.scaffoldDirectories
  : ["wiki", ".raw"];
const root = slash(payload.cwd ?? payload.workspace_roots?.[0] ?? process.cwd()).replace(/\/+$/, "");
const absolutePath = boundaryPath(root, hookFilePath(payload));
const isWorkspaceScaffold = scaffolds.some((directory) =>
  absolutePath === `${root}/${directory}` || absolutePath.startsWith(`${root}/${directory}/`));
const escapedVault = vault.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isObsidianVault = new RegExp(`(?:^|/)${escapedVault}(?:/|$)`, "i").test(absolutePath);

if (isWorkspaceScaffold && !isObsidianVault) {
  console.error(`BLOCKED: ${scaffolds.join("/")} scaffolding outside ${vault}/ — the second-brain vault only lives there.`);
  console.error(`If you meant to use ${vault}, cd into that folder first.`);
  process.exit(2);
}
emitAllow(payload);
process.exit(0);
