#!/usr/bin/env node
// PreToolUse:Task — block forbidden agent types (Explore, general-purpose, deleted agents).
// exit 2 = BLOCK the Task spawn.
import { readFileSync } from "fs";

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  if (!process.argv.includes("--deny-matched-subagent")) process.exit(0);
}

const subagentType = String(
  payload.tool_input?.subagent_type ??
    payload.subagent_type ??
    payload.subagentType ??
    "",
).toLowerCase();
const GENERIC = ["general-purpose", "explore"];
const RETIRED = [
  "documentation-writer",
  "test-execution-planner",
  // 2026-07-10 roster consolidation — folded into the 4 survivors below.
  // See docs/adr/0003-agent-roster-consolidation.md for the full mapping.
  "cypress-bug-hunter",
  "cypress-cloud-investigator",
  "cypress-e2e-automation",
  "cypress-explorer",
  "cypress-performance-auditor",
  "cypress-runner",
  "cypress-test-automation",
  "cypress-ui-coverage-analyst",
  "pr-creator",
  "pre-merge-qa-gate",
  "qa-ticket-router",
  "spec-generation-loop",
  "test-design-reviewer",
];
const FORBIDDEN = [...GENERIC, ...RETIRED];

// Cursor's subagentStart matcher has already selected a forbidden type. Keep the
// roster in one place above while sharing this hook with Claude Code's Task event.
if (process.argv.includes("--deny-matched-subagent")) {
  console.error("BLOCKED: this subagent type is forbidden by the FHF routing roster.");
  process.exit(2);
}

for (const name of FORBIDDEN) {
  if (subagentType === name) {
    console.error(`BLOCKED: agent "${name}" is forbidden.`);
    if (GENERIC.includes(name))
      console.error(
        "Use Grep/Glob/Read for lookups. See .claude/rules/agent-spawning-gate.md.",
      );
    else
      console.error(
        `"${name}" no longer exists. Use cypress-generator, cypress-gate, cypress-debugger, or cypress-shipper — see .claude/rules/agent-spawning-gate.md.`,
      );
    process.exit(2);
  }
}
process.exit(0);
