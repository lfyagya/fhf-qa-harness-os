// Single source of truth for sub-repo loader shim content.
// sync-loader-shims.mjs writes these; check-loader-drift.mjs verifies against these.
// Never duplicate this content in either script.

import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HARNESS_CONFIG = JSON.parse(
  fs.readFileSync(path.join(HARNESS_ROOT, "config", "qa-control-plane.json"), "utf8"),
);
const ENGINEERING = HARNESS_CONFIG.engineering;
const HOOKS = ENGINEERING.harness.hooks;
const ADAPTERS = ENGINEERING.harness.adapters;
const BOUNDARIES = ENGINEERING.harness.boundaries;

if (ADAPTERS.cursor.promptRouting !== "session-context") {
  throw new Error("Cursor prompt routing must use the session-context capability fallback");
}
if (ADAPTERS.cursor.compatibleHookDeduplication !== "identical-command") {
  throw new Error("Cursor/Claude compatible hooks must deduplicate by identical command");
}
if (ADAPTERS.codex.instructionFile !== "AGENTS.md" || ADAPTERS.codex.hookCapability !== "instruction-only") {
  throw new Error("Codex must use the verified AGENTS.md instruction-only adapter");
}

export const HARNESS_CONFIG_TEXT = `${JSON.stringify(HARNESS_CONFIG, null, 2)}\n`;

export const VENDORED_HOOKS = "project-hooks";

const cursorWriteMatcher = "Write|StrReplace|Edit|ApplyPatch|write|str_replace|apply_patch";
const cursorPostWriteMatcher = "Write|StrReplace|write|str_replace|apply_patch|ApplyPatch";

function hookCommand(root, script, args = "") {
  if (root === VENDORED_HOOKS) {
    const loader = "const p=require('node:path'),u=require('node:url');const r=process.env.CLAUDE_PROJECT_DIR||process.env.CURSOR_PROJECT_DIR||process.cwd();import(u.pathToFileURL(p.join(r,'.claude','hooks',process.argv[1])).href)";
    return `node -e "${loader}" "${script}"${args ? ` ${args}` : ""}`;
  }
  return `node "${root}/${script}"${args ? ` ${args}` : ""}`;
}

function cursorCommand(root, script, { matcher, failClosed, loopLimit, args = "" } = {}) {
  return {
    command: hookCommand(root, script, args),
    ...(matcher ? { matcher } : {}),
    ...(failClosed === undefined ? {} : { failClosed }),
    ...(loopLimit === undefined ? {} : { loop_limit: loopLimit }),
  };
}

export function cursorHooks(HARNESS_HOOKS = VENDORED_HOOKS, lane = "root") {
  const contextReadGuard = HOOKS.preRead.map((script) =>
    cursorCommand(HARNESS_HOOKS, script, {
      matcher: "Read|read",
      failClosed: true,
    }));
  const productionArtifactGuard = lane === "e2e"
    ? []
    : HOOKS.preReadExceptE2e.map((script) =>
        cursorCommand(HARNESS_HOOKS, script, {
          matcher: "Read|Bash|read|bash",
          failClosed: true,
        }));

  return {
    version: 1,
    hooks: {
      sessionStart: HOOKS.sessionStart.map((script) =>
        cursorCommand(HARNESS_HOOKS, script, { failClosed: false })),
      preToolUse: [
        ...HOOKS.preWrite.map((script) =>
          cursorCommand(HARNESS_HOOKS, script, {
            matcher: cursorWriteMatcher,
            failClosed: true,
          })),
        ...HOOKS.preShell.map((script) =>
          cursorCommand(HARNESS_HOOKS, script, {
            matcher: "Shell|Bash|shell|bash",
            failClosed: true,
          })),
        ...HOOKS.preSkill.map((script) =>
          cursorCommand(HARNESS_HOOKS, script, {
            matcher: "Skill|skill",
            failClosed: true,
          })),
        ...contextReadGuard,
        ...productionArtifactGuard,
      ],
      subagentStart: HOOKS.subagentStart.map((script) =>
        cursorCommand(HARNESS_HOOKS, script, {
          matcher: ENGINEERING.harness.forbiddenAgents.flatMap((name) =>
            name === "general-purpose"
              ? [name, "generalPurpose"]
              : name === "explore"
                ? [name, "Explore"]
                : [name]).join("|"),
          failClosed: true,
          args: "--deny-matched-subagent",
        })),
      postToolUse: HOOKS.postWrite.map((script) =>
        cursorCommand(HARNESS_HOOKS, script, { matcher: cursorPostWriteMatcher })),
      postToolUseFailure: HOOKS.postToolFailure.map((script) =>
        cursorCommand(HARNESS_HOOKS, script, { failClosed: false })),
      preCompact: HOOKS.preCompact.map((script) =>
        cursorCommand(HARNESS_HOOKS, script, { failClosed: false })),
      sessionEnd: HOOKS.sessionEnd.map((script) =>
        cursorCommand(HARNESS_HOOKS, script, { failClosed: false })),
      stop: HOOKS.stop.map((script) =>
        cursorCommand(HARNESS_HOOKS, script, {
          failClosed: false,
          ...(script === "spec-sweep-stop-hook.mjs"
            ? { loopLimit: ENGINEERING.loops.specSweepLimit }
            : {}),
        })),
    },
  };
}

export const CURSOR_HOOKS = cursorHooks(VENDORED_HOOKS, "root");

function claudeCommand(root, script) {
  return { type: "command", command: hookCommand(root, script) };
}

function claudeGroup(root, scripts) {
  return scripts.map((script) => claudeCommand(root, script));
}

export function claudeSettings(HARNESS_HOOKS = VENDORED_HOOKS, lane = "root") {
  const preToolUse = [
    { matcher: "Edit|Write", hooks: claudeGroup(HARNESS_HOOKS, HOOKS.preWrite) },
    { matcher: "Bash", hooks: claudeGroup(HARNESS_HOOKS, HOOKS.preShell) },
    { matcher: "Task|Agent", hooks: claudeGroup(HARNESS_HOOKS, HOOKS.preSubagent) },
    { matcher: "Skill", hooks: claudeGroup(HARNESS_HOOKS, HOOKS.preSkill) },
    { matcher: "Read", hooks: claudeGroup(HARNESS_HOOKS, HOOKS.preRead) },
  ];
  if (lane !== "e2e") {
    preToolUse.push({
      matcher: "Read|Bash",
      hooks: claudeGroup(HARNESS_HOOKS, HOOKS.preReadExceptE2e),
    });
  }

  return {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    effortLevel: ENGINEERING.context.effortLevel,
    env: !ENGINEERING.context.autoCompact.enabled
      ? { DISABLE_AUTO_COMPACT: "1" }
      : ENGINEERING.context.autoCompact.windowTokens != null
        ? {
          [ADAPTERS.claudeCode.autoCompactWindowEnv]:
            String(ENGINEERING.context.autoCompact.windowTokens),
        }
        : {},
    hooks: {
      SessionStart: [{ hooks: claudeGroup(HARNESS_HOOKS, HOOKS.sessionStart) }],
      UserPromptSubmit: [{ hooks: claudeGroup(HARNESS_HOOKS, HOOKS.prompt) }],
      PreToolUse: preToolUse,
      SubagentStart: [{ hooks: claudeGroup(HARNESS_HOOKS, HOOKS.subagentStart) }],
      Stop: [{ hooks: claudeGroup(HARNESS_HOOKS, HOOKS.stop) }],
      PreCompact: [{ hooks: claudeGroup(HARNESS_HOOKS, HOOKS.preCompact) }],
      SessionEnd: [{ hooks: claudeGroup(HARNESS_HOOKS, HOOKS.sessionEnd) }],
      PostToolUse: [{
        matcher: "Edit|Write",
        hooks: claudeGroup(HARNESS_HOOKS, HOOKS.postWrite),
      }],
      PostToolUseFailure: [{
        hooks: claudeGroup(HARNESS_HOOKS, HOOKS.postToolFailure),
      }],
    },
    autoCompactEnabled: ENGINEERING.context.autoCompact.enabled,
    skillListingMaxDescChars: ENGINEERING.context.skillListing.maxDescriptionChars,
    skillListingBudgetFraction: ENGINEERING.context.skillListing.budgetFraction,
    skillOverrides: ADAPTERS.claudeCode.skillOverrides,
    permissions: ADAPTERS.claudeCode.permissionsByLane?.[lane] ?? ADAPTERS.claudeCode.permissions,
    sandbox: {
      filesystem: {
        denyWrite: BOUNDARIES.applicationSource.denyWriteByLane[lane],
      },
    },
  };
}

export function claudeSettingsText(HARNESS_HOOKS = VENDORED_HOOKS, lane = "root") {
  return `${JSON.stringify(claudeSettings(HARNESS_HOOKS, lane), null, 2)}\n`;
}

export function portableSettings(lane) {
  return claudeSettingsText(VENDORED_HOOKS, lane);
}

export function parentCopilotInstructions() {
  return `# Copilot Instructions â€” FHF Parent Workspace

Read the workspace-root \`CLAUDE.md\`, then the selected lane's
\`.github/copilot-instructions.md\`. Do not preload FHF documentation.
`;
}

export function parentGeminiInstructions() {
  return `# Gemini Instructions â€” FHF Parent Workspace

Read the workspace-root \`CLAUDE.md\`, then the selected lane's \`GEMINI.md\`.
Do not preload FHF documentation.
`;
}

export function baselineClaude() {
  return `# Frontend Automation Harness

This is the shared, clone-ready harness baseline. For E2E work, checkout \`dev\`; for production
smoke work, checkout \`staging\`. The selected branch provides the lane-specific instructions and
execution boundaries. \`fhf-backend-automation\` is read-only evidence only.
`;
}

export function baselineAgents() {
  return `# Frontend Automation Harness

Read \`CLAUDE.md\`. Choose the branch that matches the work before editing tests:

| Work | Branch | Agent |
| --- | --- | --- |
| E2E / Dev-QA | \`dev\` | \`cypress-generator\`, \`cypress-gate\`, \`cypress-debugger\`, \`cypress-shipper\` |
| Production smoke | \`staging\` | \`cypress-generator\`, \`cypress-gate\`, \`cypress-debugger\`, \`cypress-shipper\` |

Generated harness files live in \`.claude/\`, \`.cursor/hooks.json\`,
\`.github/copilot-instructions.md\`, \`GEMINI.md\`, and \`.harness/\`. Edit their canonical source
in \`fhf-harness-os\` and regenerate; do not hand-edit generated files.
`;
}

export function baselineReadme() {
  return `# Frontend Automation

This branch carries the shared clone-ready harness baseline. Checkout \`dev\` for E2E work or
\`staging\` for production smoke work before changing or executing tests.
`;
}

export function baselineArchitecture() {
  return `# Harness Baseline Architecture

The shared harness is vendored in \`.claude/\`. Lane-specific test architecture and execution
constraints are defined by the \`dev\` (E2E) and \`staging\` (Smoke) branches.
`;
}

export function baselineContributing() {
  return `# Contributing

Choose the correct lane branch before changing tests: \`dev\` for E2E or \`staging\` for Smoke.
Run \`node .harness/verify.mjs\` after updating generated harness configuration.
`;
}

export function baselineDocsReadme() {
  return `# Harness Documentation

This branch contains the shared harness baseline. Lane-specific documentation is maintained on
\`dev\` for E2E and \`staging\` for Smoke.
`;
}

export function baselineCopilotInstructions() {
  return `# Copilot Instructions - Frontend Automation Baseline

Read \`CLAUDE.md\`. Checkout \`dev\` for E2E work or \`staging\` for Smoke work before editing or
executing tests.
`;
}

export function baselineGeminiInstructions() {
  return `# Gemini Instructions - Frontend Automation Baseline

Read \`CLAUDE.md\`. Checkout \`dev\` for E2E work or \`staging\` for Smoke work before editing or
executing tests.
`;
}

export function docsReadme(lane) {
  return `# ${lane === "e2e" ? "E2E" : "Smoke"} Docs Pointer

Shared documentation is routed by \`../../docs/README.md\`. Read only the path required by the task.
`;
}

export function rootReadme(lane) {
  const isE2e = lane === "e2e";
  return `# FHF ${isE2e ? "E2E" : "Smoke"} Lane

Read \`CLAUDE.md\`, then \`CypressFHF/fhf-dashboards/CLAUDE.md\`.
Path: \`CypressFHF/fhf-dashboards/cypress/tests/fhf-dashboard/${isE2e ? "e2e" : "smoke"}/\`.
${isE2e ? "Dev/QA mutations require synthetic data and cleanup; never run against production." : "Production smoke is GET-only and must never trigger a side effect."}
`;
}

export function architectureOverlay(lane) {
  return `# ${lane === "e2e" ? "E2E" : "Smoke"} Architecture Pointer

Read \`CLAUDE.md\` and \`../../docs/framework/testing-standards/TESTS.md\`.
`;
}

export function contributingOverlay(lane) {
  return `# Contributing (${lane === "e2e" ? "E2E" : "Smoke"})

Read \`CLAUDE.md\` and \`../../docs/framework/testing-standards/TESTS.md\` before changing tests.
`;
}

function toolInstructions(tool, lane) {
  const isE2e = lane === "e2e";
  const sharedRouter = tool === "Copilot" ? "../../../CLAUDE.md" : "../../CLAUDE.md";
  return `# ${tool} Instructions â€” ${isE2e ? "E2E" : "Smoke"}

Read \`${sharedRouter}\`, then the repository's \`CypressFHF/fhf-dashboards/CLAUDE.md\`.
${isE2e
  ? "Use Dev/QA only. Mutations require synthetic data and cleanup; never run against production."
  : "Production smoke is GET-only. Never mutate, submit, export, download, upload, or send."}
`;
}

export function copilotInstructions(lane) {
  return toolInstructions("Copilot", lane);
}

export function geminiInstructions(lane) {
  return toolInstructions("Gemini", lane);
}

export function consumerVerifierReadme() {
  return `# Consumer harness verification

This clone does not contain \`fhf-harness-os/scripts/harness/*\`.

Run \`node .harness/verify.mjs\` here. Canonical checks (\`test-hooks\`, \`test-adapter-contract\`,
\`test-sync-loader\`, \`check-docs-links\`, \`check-loader-drift\`) run only from \`fhf-harness-os\`.
Runtime loop evidence is recorded with \`node .harness/record-loop-event.mjs '<json>'\`; state and
trace files under \`cypress/handoff/\` are transient and ignored.
`;
}

export const CONSUMER_VERIFIER_TEXT = fs.readFileSync(
  path.join(HARNESS_ROOT, "scripts", "harness", "verify-projection.mjs"),
  "utf8",
).replace(/\r\n/g, "\n");

export const PORTABLE_RUNTIME_STATE_TEXT = fs.readFileSync(
  path.join(HARNESS_ROOT, "scripts", "harness", "portable-runtime-state.mjs"),
  "utf8",
).replace(/\r\n/g, "\n");

export const RECORD_LOOP_EVENT_TEXT = fs.readFileSync(
  path.join(HARNESS_ROOT, "scripts", "harness", "record-loop-event.mjs"),
  "utf8",
).replace(/\r\n/g, "\n");
