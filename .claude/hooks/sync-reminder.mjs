#!/usr/bin/env node
// PostToolUse:Edit|Write — remind to keep AGENTS.md and cross-system rules in sync.
// exit 0 always (pure advisory).
import { readFileSync } from 'fs';

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const filePath = (payload.tool_input?.file_path ?? '').replace(/\\/g, '/');

// Only fire when agents, rules, or framework files change
const isFramework = filePath.includes('.claude/agents/') || filePath.includes('.claude/rules/') ||
                    filePath.includes('docs/framework/');
if (!isFramework) process.exit(0);

console.log('[sync-reminder] Framework/agent file changed — sync AGENTS.md registry, .cursor/rules/fhf-cypress-core.mdc, .github/copilot-instructions.md (AGENTS.md §AI System Synchronization Rule).');
process.exit(0);
