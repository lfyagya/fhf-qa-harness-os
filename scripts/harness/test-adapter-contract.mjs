import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { HARNESS_CONFIG_TEXT, baselineAgents, claudeSettings, codexHooks, copilotInstructions, cursorHooks, geminiInstructions } from "./loader-templates.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "qa-control-plane.json"), "utf8"));
const engineering = config.engineering;
const claude = claudeSettings();
const cursor = cursorHooks();
const codex = codexHooks();
const failures = [];
const projections = JSON.stringify({ claude, cursor });
const sharedArtifacts = `${projections}\n${HARNESS_CONFIG_TEXT}`;

function check(condition, message) {
  if (!condition) failures.push(message);
}

function claudeCommands(event) {
  return (claude.hooks[event] ?? [])
    .flatMap((group) => group.hooks ?? [])
    .map((hook) => hook.command);
}

function cursorCommands(event) {
  return (cursor.hooks[event] ?? []).map((hook) => hook.command);
}

const eventPairs = [
  ["sessionStart", "SessionStart"],
  ["preToolUse", "PreToolUse"],
  ["postToolUse", "PostToolUse"],
  ["postToolUseFailure", "PostToolUseFailure"],
  ["preCompact", "PreCompact"],
  ["sessionEnd", "SessionEnd"],
  ["stop", "Stop"],
];

for (const [cursorEvent, claudeEvent] of eventPairs) {
  const cursorSet = new Set(cursorCommands(cursorEvent));
  const claudeSet = new Set(claudeCommands(claudeEvent));
  for (const command of [...cursorSet].filter((value) => claudeSet.has(value))) {
    check(command.startsWith('node -e "'), `${cursorEvent}/${claudeEvent} does not use the portable launcher`);
    check(!command.includes("--cursor"), `${cursorEvent}/${claudeEvent} uses a runtime-specific command`);
    check(!command.includes("--runtime-adapter"), `${cursorEvent}/${claudeEvent} still guesses the runtime`);
  }
}

check(
  cursorCommands("beforeSubmitPrompt").some((command) => command.includes("prompt-router.mjs")),
  "Cursor beforeSubmitPrompt must run the same prompt router",
);
check(
  cursorCommands("preToolUse").some((command) => command.includes("repeat-tool-guard.mjs")) &&
    cursorCommands("postToolUse").some((command) => command.includes("repeat-tool-guard.mjs")),
  "Cursor must compare the next tool call with the last recorded output",
);
function hookScripts(commands) {
  return commands.map((command) => command.match(/"([^"]+\.mjs)"\s*$/)?.[1]).filter(Boolean);
}
const claudeScripts = new Set(Object.keys(claude.hooks).flatMap((event) => hookScripts(claudeCommands(event))));
const cursorScripts = new Set(Object.keys(cursor.hooks).flatMap((event) => hookScripts(cursorCommands(event))));
for (const script of claudeScripts) {
  check(cursorScripts.has(script), `Cursor is missing hook ${script}`);
}
for (const script of cursorScripts) {
  check(claudeScripts.has(script), `Claude is missing hook ${script}`);
}
check(
  cursorCommands("subagentStop").some((command) => command.includes("verify-subagent-citations.mjs")) &&
    cursorCommands("preToolUse").some((command) => command.includes("block-generic-agents.mjs")),
  "Cursor must run the same subagent guards as Claude",
);
check(
  !/(?:[A-Za-z]:[\\/](?:Users|home)[\\/]|\/(?:Users|home)\/|Leapfrog)/i.test(sharedArtifacts),
  "Generated adapters must not contain machine-specific home paths",
);
check(
  projections.includes("process.env.CLAUDE_PROJECT_DIR") &&
    projections.includes("process.env.CURSOR_PROJECT_DIR"),
  "Generated adapters must resolve hooks through runtime project variables",
);
check(
  cursorCommands("sessionStart").some((command) => command.includes("session-context.mjs")),
  "Cursor sessionStart must inject the tool-neutral routing contract",
);
check(
  claudeCommands("UserPromptSubmit").some((command) => command.includes("prompt-router.mjs")),
  "Claude UserPromptSubmit must retain dynamic route context",
);
const compactWindowEnv = engineering.harness.adapters.claudeCode.autoCompactWindowEnv;
check(
  engineering.context.autoCompact.windowTokens == null
    ? !(compactWindowEnv in claude.env)
    : claude.env[compactWindowEnv] === String(engineering.context.autoCompact.windowTokens),
  "Claude auto-compaction window environment projection is wrong",
);
check(
  claudeCommands("PreToolUse").some((command) => command.includes("context-read-guard.mjs")) &&
    cursorCommands("preToolUse").some((command) => command.includes("context-read-guard.mjs")),
  "Claude and Cursor must guard unbounded reads",
);
check(!("autoCompactWindow" in claude), "Unsupported autoCompactWindow setting must not be generated");
check(
  JSON.stringify(claude.sandbox.filesystem.denyWrite) ===
    JSON.stringify(engineering.harness.boundaries.applicationSource.denyWriteByLane.root),
  "Claude sandbox denyWrite must come from the application-source boundary",
);
check(
  cursor.hooks.stop.find((hook) => hook.command.includes("spec-sweep-stop-hook.mjs"))?.loop_limit ===
    engineering.loops.specSweepLimit,
  "Cursor stop loop_limit must come from engineering.loops.specSweepLimit",
);
check(
  engineering.harness.adapters.codex.instructionFile === "AGENTS.md" &&
    engineering.harness.adapters.codex.hookCapability === "hooks-json",
  "Codex must read AGENTS.md and project the hook list",
);
function codexCommands(event) {
  return (codex.hooks[event] ?? []).flatMap((group) => group.hooks ?? []).map((hook) => hook.command);
}
check(!codex.hooks.PostToolUseFailure, "Codex has no PostToolUseFailure event");
const codexScripts = new Set(Object.keys(codex.hooks).flatMap((event) => hookScripts(codexCommands(event))));
for (const script of claudeScripts) {
  if (script === "failure-loop-guard.mjs") continue;
  check(codexScripts.has(script), `Codex is missing hook ${script}`);
}
check(
  codexCommands("UserPromptSubmit").some((command) => command.startsWith("FHF_HOOK_HOST=codex ") && command.includes("prompt-router.mjs")),
  "Codex UserPromptSubmit must run the shared prompt router",
);
check(
  codexCommands("PreToolUse").some((command) => command.includes("repeat-tool-guard.mjs")) &&
    codexCommands("PostToolUse").some((command) => command.includes("repeat-tool-guard.mjs")),
  "Codex must compare the next tool call with the last recorded output",
);

function pairKey(matcher, command) {
  const script = command.match(/"([^"]+\.mjs)"/)?.[1] ?? command;
  return `${matcher ?? "*"} ${script}`;
}
function claudePairs(event) {
  return (claude.hooks[event] ?? []).flatMap((group) =>
    (group.hooks ?? []).map((hook) => pairKey(group.matcher, hook.command))).sort();
}
function cursorPairs(event) {
  return (cursor.hooks[event] ?? []).map((hook) => pairKey(hook.matcher, hook.command)).sort();
}
function codexPairs(event) {
  return (codex.hooks[event] ?? []).flatMap((group) =>
    (group.hooks ?? []).map((hook) => pairKey(group.matcher, hook.command))).sort();
}
for (const [cursorEvent, claudeEvent] of [
  ["preToolUse", "PreToolUse"],
  ["postToolUse", "PostToolUse"],
  ["subagentStart", "SubagentStart"],
]) {
  const claudeSet = claudePairs(claudeEvent);
  check(JSON.stringify(cursorPairs(cursorEvent)) === JSON.stringify(claudeSet), `${cursorEvent} matchers must match Claude`);
  check(JSON.stringify(codexPairs(claudeEvent)) === JSON.stringify(claudeSet), `${claudeEvent} matchers must match on Codex`);
}
check(
  JSON.stringify(Object.keys(codex.hooks).sort()) ===
    JSON.stringify(Object.keys(claude.hooks).filter((event) => event !== "PostToolUseFailure").sort()),
  "Codex projects every Claude hook event except the one Codex does not have",
);
check(
  codex.hooks.PreToolUse.flatMap((group) => group.hooks).every((hook) => hook.commandWindows?.includes('FHF_HOOK_HOST=codex')),
  "Codex Windows commands must set the same host marker",
);
for (const [name, text] of [
  ["Codex baseline", baselineAgents()],
  ["Copilot", copilotInstructions("e2e")],
  ["Gemini", geminiInstructions("smoke")],
]) {
  check(
    text.includes("capability-doctor.mjs") && text.includes("live ticket read"),
    `${name} instruction adapter must enforce the Jira ticket-access gate`,
  );
}
check(
  Array.isArray(engineering.harness.verify?.canonical) &&
    engineering.harness.verify.canonical.includes("scripts/harness/test-sync-loader.mjs"),
  "Canonical verify must list harness-os scripts, including test-sync-loader",
);
check(
  Array.isArray(engineering.harness.verify?.consumer) &&
    engineering.harness.verify.consumer.includes(".harness/verify.mjs") &&
    engineering.harness.verify.consumer.every((script) => !String(script).includes("scripts/harness/")),
  "Consumer verify must be clone-runnable and must not advertise scripts/harness/*",
);

const launcherCommand = cursorCommands("preToolUse")
  .find((command) => command.includes("manual-task-guard.mjs"));
const launch = spawnSync(launcherCommand, {
  cwd: ROOT,
  shell: true,
  input: JSON.stringify({ tool_input: { command: "git status" } }),
  encoding: "utf8",
  env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
});
let launchOutput = {};
try { launchOutput = JSON.parse(launch.stdout); } catch {}
check(
  launch.status === 0 &&
    launchOutput.hookSpecificOutput?.permissionDecision === "allow",
  `Portable launcher failed: ${launch.stderr || launch.stdout}`,
);

if (failures.length > 0) {
  console.error("Adapter contract failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Claude and Cursor adapters satisfy the tool-neutral harness contract.");
