#!/usr/bin/env node
// PreToolUse:Edit|Write — block wiki/.raw scaffolding landing outside claude-obsidian/.
// The claude-obsidian plugin (installed at user scope) is global; only its vault at
// ../claude-obsidian legitimately owns a top-level wiki/ or .raw/ folder. If /wiki or
// ingest ever fires with the wrong cwd, this stops it from scaffolding a stray vault
// inside the QA harness itself. exit 2 = BLOCK.
import { readFileSync } from 'fs';
import { hookFilePath } from './lib/hook-payload.mjs';
import { emitAllow } from './lib/hook-runtime.mjs';
import { workspaceRoot } from './lib/memory-state.mjs';

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  emitAllow(payload);
  process.exit(0);
}

const filePath = hookFilePath(payload);
const requestedRoot = payload?.cwd ?? payload?.workspace_roots?.[0] ?? process.env.CLAUDE_CWD ?? "";
const root = /^[A-Za-z]:[\\/]/.test(requestedRoot) || requestedRoot.startsWith("/") || requestedRoot.startsWith("\\")
  ? requestedRoot
  : workspaceRoot(payload);
const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
const normalizedFile = filePath.replace(/\\/g, "/");
const absolutePath = /^[A-Za-z]:\//.test(normalizedFile) || normalizedFile.startsWith("/")
  ? normalizedFile
  : `${normalizedRoot}/${normalizedFile}`.replace(/\/+/g, "/");
const isWorkspaceScaffold = ['wiki', '.raw'].some((directory) =>
  absolutePath === `${normalizedRoot}/${directory}` ||
  absolutePath.startsWith(`${normalizedRoot}/${directory}/`));
const isObsidianVault = /(?:^|\/)claude-obsidian(?:\/|$)/i.test(absolutePath);

if (isWorkspaceScaffold && !isObsidianVault) {
  console.error('BLOCKED: wiki/.raw scaffolding outside claude-obsidian/ — the second-brain vault only lives there.');
  console.error('If you meant to use claude-obsidian, cd into that folder first.');
  process.exit(2);
}
emitAllow(payload);
process.exit(0);
