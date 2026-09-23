// Single source of truth for sub-repo loader shim content.
// sync-loader-shims.mjs writes these; check-loader-drift.mjs verifies against these.
// Never duplicate this content in either script.

import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// FHF_HARNESS_CONFIG override matches task-protocol.mjs, so tests can supply a config fixture.
const HARNESS_CONFIG = JSON.parse(
  fs.readFileSync(
    process.env.FHF_HARNESS_CONFIG || path.join(HARNESS_ROOT, "config", "qa-control-plane.json"),
    "utf8",
  ),
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

const agentRuntime = ENGINEERING.harness.agentRuntime;
if (!Number.isInteger(agentRuntime?.maxTurns) || agentRuntime.maxTurns < 1) {
  throw new Error("engineering.harness.agentRuntime.maxTurns must be a positive integer");
}
for (const agent of ENGINEERING.harness.agents) {
  const source = fs.readFileSync(path.join(HARNESS_ROOT, ".claude", "agents", `${agent}.md`), "utf8");
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  if (!new RegExp(`^maxTurns:\\s*${agentRuntime.maxTurns}\\s*$`, "m").test(frontmatter)) {
    throw new Error(`${agent} must declare maxTurns: ${agentRuntime.maxTurns}`);
  }
  for (const skill of agentRuntime.preloadedSkills?.[agent] ?? []) {
    if (!new RegExp(`^\\s*-\\s*${skill}\\s*$`, "m").test(frontmatter)) {
      throw new Error(`${agent} must preload skill ${skill}`);
    }
  }
}

export const HARNESS_CONFIG_TEXT = `${JSON.stringify(HARNESS_CONFIG, null, 2)}\n`;

// A consumer receives only the agents and skills its lane can act on (laneScope). The projected
// harness.config.json must agree with what is on disk: block-generic-agents.mjs and
// block-forbidden-skills.mjs read these lists, so a roster naming an agent the lane never
// received would allow a spawn that then fails on a missing file.
export const LANE_SCOPE = ENGINEERING.harness.laneScope ?? {};

export function laneAllows(lane, kind) {
  const scope = LANE_SCOPE[lane];
  if (!scope || scope === "all") return null;          // null = no filtering, take everything
  const list = scope[kind];
  return Array.isArray(list) ? new Set(list) : null;
}

export function harnessConfigTextForLane(lane = "root") {
  const agents = laneAllows(lane, "agents");
  const skills = laneAllows(lane, "skills");
  if (!agents && !skills) return HARNESS_CONFIG_TEXT;
  const scoped = JSON.parse(HARNESS_CONFIG_TEXT);
  const harness = scoped.engineering?.harness;
  if (harness) {
    if (agents) harness.agents = (harness.agents ?? []).filter((name) => agents.has(name));
    if (skills) harness.skills = (harness.skills ?? []).filter((name) => skills.has(name));
    if (agents && harness.agentRuntime?.preloadedSkills) {
      harness.agentRuntime.preloadedSkills = Object.fromEntries(
        Object.entries(harness.agentRuntime.preloadedSkills).filter(([name]) => agents.has(name)),
      );
    }
  }
  return `${JSON.stringify(scoped, null, 2)}
`;
}


export function laneMarker(lane) {
  return `${JSON.stringify({ schema: "fhf-harness/lane/v1", lane }, null, 2)}\n`;
}

export function workspaceExample(lane) {
  const example = {
    schema: "fhf-harness/workspace-setup/v1",
    lane,
    consumerRoot: "",
    moduleSpecsRoot: "",
    // Not optional: a QA task spans frontend and backend, so the backend checkout is part of
    // every workspace. loadSetup() still reads a legacy optional.backendRoot, so a setup file
    // written before this stays valid.
    backendRoot: "",
  };
  if (lane === "e2e") example.e2eRoot = "";
  if (lane === "smoke") example.smokeRoot = "";
  example.optional = {
    jiraMcp: false,
    confluenceMcp: false,
    cypressCloud: false,
    figmaMcp: false,
    testRail: false,
    teamworkGraphCli: false,
  };
  return `${JSON.stringify(example, null, 2)}\n`;
}

export function lanePackage(lane) {
  return (HARNESS_CONFIG.paths ?? ENGINEERING.paths)?.lanes?.[lane]?.package ?? null;
}

// The lane .npmrc is gitignored because it carries Cypress Cloud record keys. That also hides the
// non-secret script-shell line every Windows clone needs, so ship a key-less template beside it.
export function npmrcExample(lane) {
  return NPMRC_EXAMPLE_TEXT.replace(
    "cypress_record_key_LANE=",
    `cypress_record_key_${lane === "smoke" ? "smoke" : "e2e"}=`,
  );
}

export const VENDORED_HOOKS = "project-hooks";

const PHASE_MATCHERS = {
  preReadExceptE2e: "Read|Bash",
  preWrite: "Edit|Write",
  preShell: "Bash",
  preSubagent: "Task|Agent",
  preSkill: "Skill",
  preRead: "Read",
  postWrite: "Edit|Write",
  stop: "Stop",
};

export function hookPhaseOrder(lane = "root") {
  return [
    ...(lane === "e2e" ? [] : ["preReadExceptE2e"]),
    "preWrite",
    "preShell",
    "preSubagent",
    "preSkill",
    "preRead",
  ];
}

export function hookChains(lane = "root") {
  return [
    ...hookPhaseOrder(lane).map((phase) => ({
      phase,
      tools: PHASE_MATCHERS[phase].split("|"),
      scripts: HOOKS[phase] ?? [],
    })),
    { phase: "postWrite", tools: PHASE_MATCHERS.postWrite.split("|"), scripts: HOOKS.postWrite ?? [] },
    { phase: "stop", tools: PHASE_MATCHERS.stop.split("|"), scripts: HOOKS.stop ?? [] },
  ];
}

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
  const cursorMatcher = {
    preReadExceptE2e: "Read|Bash|read|bash",
    preWrite: cursorWriteMatcher,
    preShell: "Shell|Bash|shell|bash",
    preSkill: "Skill|skill",
    preRead: "Read|read",
  };
  return {
    version: 1,
    hooks: {
      sessionStart: HOOKS.sessionStart.map((script) =>
        cursorCommand(HARNESS_HOOKS, script, { failClosed: false })),
      preToolUse: hookPhaseOrder(lane)
        .filter((phase) => cursorMatcher[phase])
        .flatMap((phase) => (HOOKS[phase] ?? []).map((script) =>
          cursorCommand(HARNESS_HOOKS, script, {
            matcher: cursorMatcher[phase],
            failClosed: true,
          }))),
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
        cursorCommand(HARNESS_HOOKS, script, {
          matcher: cursorPostWriteMatcher,
          failClosed: true,
        })),
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
  const preToolUse = hookPhaseOrder(lane).map((phase) => ({
    matcher: PHASE_MATCHERS[phase],
    hooks: claudeGroup(HARNESS_HOOKS, HOOKS[phase] ?? []),
  }));

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
      SubagentStop: [{ hooks: claudeGroup(HARNESS_HOOKS, HOOKS.subagentStop) }],
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

export function parentAgents() {
  const spawn = ENGINEERING.harness.spawnBudget ?? { maxSpecialists: 1, maxDepth: 1, concurrent: 1 };
  const tiers = ENGINEERING.harness.modelTiers ?? { default: "standard" };
  const invocation = ENGINEERING.harness.skillInvocation ?? { mode: "route-or-explicit" };
  const extraSkills = (ENGINEERING.harness.skills ?? []).filter((name) =>
    !["cypress-explain", "cypress-docs", "cypress-tap", "cypress-author", "backend-test-author", "twg", "twg-jira", "twg-confluence"].includes(name),
  );
  const extraLines = extraSkills.length
    ? extraSkills.map((name) => `- \`${name}\` — root-lane only; invoke when the matched route names it`).join("\n")
    : "";
  return `# FHF Agent Entry

Read \`CLAUDE.md\` first; it is the shared workspace router.

Then read only:

1. the selected repository's \`CLAUDE.md\` (pointer);
2. that package's \`docs/*-STANDARDS.md\` or guide named by the pointer;
3. the exact document selected by \`.claude/harness.config.json\` → \`engineering.context.routes\`.

| Work | Agent |
| --- | --- |
| Build Cypress-only tests | \`cypress-generator\` |
| Review Cypress-only changes | \`cypress-gate\` |
| Debug Cypress-only failures/flakiness | \`cypress-debugger\` |
| Open Cypress PR or report coverage | \`cypress-shipper\` |
| Build backend-only or combined FE/BE automation | \`qa-automation-generator\` |
| Review backend-only or combined FE/BE automation | \`qa-automation-gate\` |
| Debug backend-only or combined FE/BE automation | \`qa-automation-debugger\` |

Allowed Cypress AI Toolkit skills stay in the parent (do not spawn). Read
\`.claude/skills/<name>/SKILL.md\` when the matched route's \`invoke\` names the skill:

- \`cypress-explain\` — explain or review tests with no edits
- \`cypress-docs\` — official Cypress documentation lookup
- \`cypress-tap\` — drive a live \`cypress open\` session (Cypress 15.21+, Chromium; not headless \`cypress run\`)
- \`cypress-author\` — Cypress-native conventions only on FHF work; must not Write specs. Parent spawns \`cypress-generator\`
- \`backend-test-author\` — backend pytest/API/Oracle work under the active task manifest
- \`twg\` / \`twg-jira\` / \`twg-confluence\` — same Atlassian overlay as MCP graph. Configure then use: install from \`connectors.teamworkGraphCli.agentsMd\`, \`twg doctor\`, then \`capability-doctor teamwork-graph-cli\`. Not a second ticket oracle.
${extraLines ? `${extraLines}\n` : ""}
\`cypress-author\` may load; on FHF work it must not write specs. New Cypress specs spawn
\`cypress-generator\`.

Spawn at most ${spawn.maxSpecialists} specialist, depth ${spawn.maxDepth}, concurrent ${spawn.concurrent},
and only when the matched route \`invoke.kind\` is \`agent\`. Otherwise stay in parent.
\`engineering.harness.spawnBudget\` and \`engineering.harness.modelTiers\` are authoritative.
Default model tier is \`${tiers.default ?? "standard"}\`. Frontier only on cloud-failure,
test-failure, and test-flake after an explicit request or a recorded insufficient standard
diagnosis. Those tiers are parent policy, not hook gates. Skill invocation mode is
\`${invocation.mode}\`: follow the matched route \`invoke\`; do not load an unmapped
marketplace plugin. The skill hook enforces the allow-list and \`skillLanes\` only.
Backend writes and pytest runs require a validated active manifest, resolved from the ticket or task
title the prompt names (\`FHF_ACTIVE_TASK\` overrides; ADR-0043);
application source remains read-only.
Root \`.claude/\`, Cursor, Copilot, and Gemini loaders are generated from \`fhf-harness-os\`; never
hand-edit generated copies. Agent changes stay uncommitted for owner review.
`;
}

// The FHF workspace root needs its own CLAUDE.md: workspaceContract.lanes.<lane>.requiredWorkspacePaths
// declares consumerRoot/CLAUDE.md, and every lane hook goes WORKSPACE BLOCKED without it. It was
// never generated because the engine used to be checked out AT the workspace root, so the engine's
// own CLAUDE.md satisfied the check by accident. Separating the trees (ADR-0026) removed it and
// blocked both Cypress lanes. This is a router, not a copy of the engine's CLAUDE.md - the
// workspace is an aggregation point, not the harness.
export function parentClaudeInstructions() {
  return `# FHF Workspace

This is the local aggregation workspace, not a project. It holds the lane repositories, the
application specs checkout, and the generated harness projection. Everything in \`.claude/\` here is
generated by \`fhf-harness-os/scripts/harness/sync-loader-shims.mjs\` and is local-only.

Read this file, then the selected repository's own \`CLAUDE.md\`. Do not preload FHF documentation;
\`.claude/harness.config.json\` -> \`engineering.context.routes\` selects the one document a task needs.

| Work | Repository | Branch |
| --- | --- | --- |
| E2E / Dev-QA | the configured E2E lane root | \`dev\` |
| Production smoke (GET-only) | the configured Smoke lane root | \`staging\` |
| Backend API / Oracle | \`fhf-backend-automation\` | \`master\`, task-scoped |

Application source is read-only. Production smoke must never mutate, submit, export, download, or
send. Backend writes and pytest runs require an active, validated task manifest: name its ticket or
title in the prompt and the router selects it (\`FHF_ACTIVE_TASK\` overrides; ADR-0043).

Two unrelated repositories are named \`fhf-dashboards\`, and both declare \`"name": "fhf-dashboards"\`
in \`package.json\`: \`fhf-dashboards/\` at the workspace root is the React application and is
read-only, while \`<lane>/CypressFHF/fhf-dashboards/\` is that lane's Cypress suite and is writable.
Resolve which one by full path, never by folder name.

The harness engine lives in a separate checkout; edit policy there and re-run sync rather than
hand-editing anything generated here.

This workspace's \`docs/\` tree is the documentation payload, versioned on branch \`fhf-docs\` of the
engine's remote, \`git@github.com:lfyagya/fhf-qa-harness-os.git\`. Its history is unrelated to \`main\`
and is never merged into it (ADR-0018, ADR-0035). Keep this tree on \`fhf-docs\`: checking out an
engine branch here removes every payload-only file (ADR-0026). To obtain it on a new machine:

\`\`\`text
git clone -b fhf-docs --single-branch git@github.com:lfyagya/fhf-qa-harness-os.git FHF
\`\`\`

Payload access is repository-scoped, so it also grants the engine on \`main\`. If someone needs the
documentation without the harness internals, that is a hosting question, not a checkout trick.
`;
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
execution boundaries. \`fhf-backend-automation\` is task-scoped: use the active manifest for
selected writes and Dev/QA pytest runs; application source remains read-only.
`;
}

export function baselineAgents() {
  return `# Frontend Automation Harness

Read \`CLAUDE.md\`. Choose the branch that matches the work before editing tests:

| Work | Branch | Agent |
| --- | --- | --- |
| E2E / Dev-QA | \`dev\` | \`cypress-generator\`, \`cypress-gate\`, \`cypress-debugger\`, \`cypress-shipper\` |
| Production smoke | \`staging\` | \`cypress-generator\`, \`cypress-gate\`, \`cypress-debugger\`, \`cypress-shipper\` |
| Backend-only or combined FE/BE automation | active task manifest | \`qa-automation-generator\`, \`qa-automation-gate\`, \`qa-automation-debugger\` |

For a ticket, Figma reference, Cypress diagnostic, backend proof, or TestRail case/report, run
\`node .harness/capability-doctor.mjs --capability <id> --subject <task-safe-label>\` before grounding or execution.
If it requests access, stop and request OAuth Jira Browse/Read or a sanitized ticket export; a declared connector still requires a successful live ticket read.

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
  if (lane === "e2e") {
    return `# E2E Docs Pointer

Read \`docs/framework/testing-strategy.md\` and \`docs/framework/framework-standards.md\`,
then only the documentation required by the task. Use the Smoke lane as the structural
baseline when generating remaining E2E coverage; this checkout stays the E2E lane.
Product contracts remain in the configured application-spec repository.
`;
  }
  return `# Smoke Docs Pointer

Read the local \`docs/framework/DOCUMENTATION-INDEX.md\` and then only the documentation required by
the task. Product contracts remain in the configured application-spec repository.
`;
}

export function rootReadme(lane) {
  const isE2e = lane === "e2e";
  return `# FHF ${isE2e ? "E2E" : "Smoke"} Lane

Read \`CLAUDE.md\`, then \`CypressFHF/fhf-dashboards/CLAUDE.md\`.
Path: \`CypressFHF/fhf-dashboards/cypress/tests/fhf-dashboard/${isE2e ? "e2e" : "smoke"}/\`.
${isE2e
  ? "Dev/QA mutations require synthetic data and cleanup; never run against production."
  : "Production smoke is GET-only and must never trigger a side effect. Run `node .harness/setup.mjs`, then `node .harness/verify.mjs`, before starting work."}
`;
}

export function architectureOverlay(lane) {
  return `# ${lane === "e2e" ? "E2E" : "Smoke"} Architecture Pointer

Read \`CLAUDE.md\` and \`docs/framework/testing-standards/TESTS.md\`.

## Policy placement

The generated \`.claude/harness.config.json#policyGovernance\` section is the reusable decision
contract. It classifies authority, adoption, applicability, placement, and fail-closed outcomes. It
does not own loan thresholds, statuses, dropdown values, calculations, or state transitions.

- Put reusable classifications, adoption gates, hard safety boundaries, and routing defaults in the
  harness config.
- Put approved business rules and source citations in the configured application specification.
- Treat frontend/API/DB behavior as implementation evidence, and run/coverage artifacts as execution
  evidence; neither automatically becomes policy.
- Put machine paths in ignored workspace setup and credentials only in environment/secret stores.

A rule is enforceable only when it is approved and its applicability is confirmed or explicitly
conditional with jurisdiction and conditions. Missing fields, unknown applicability, conflicting
authority, or missing owner approval blocks enforcement and requires owner resolution.
`;
}

export function executionProfileExample(lane) {
  const example = {
    schema: "fhf-harness/execution-profile/v1",
    lane,
    packageRoot: "CypressFHF/fhf-dashboards",
    baseUrl: "",
    workspace: { consumerRoot: "", moduleSpecsRoot: "" },
    dependencySource: "",
    credentials: { cypressEnv: "" },
    optional: { cypressCloud: false },
  };
  example.credentials.npmrc = "";
  return `${JSON.stringify(example, null, 2)}\n`;
}

export function contributingOverlay(lane) {
  return `# Contributing (${lane === "e2e" ? "E2E" : "Smoke"})

Run \`node .harness/verify.mjs\`, then read \`CLAUDE.md\` and
\`docs/framework/testing-standards/TESTS.md\` before changing tests.
`;
}

function toolInstructions(tool, lane) {
  const isE2e = lane === "e2e";
  const sharedRouter = "CLAUDE.md";
  return `# ${tool} Instructions â€” ${isE2e ? "E2E" : "Smoke"}

Read \`${sharedRouter}\`, then the repository's \`CypressFHF/fhf-dashboards/CLAUDE.md\`.
${isE2e
  ? "Use Dev/QA only. Mutations require synthetic data and cleanup; never run against production."
  : "Production smoke is GET-only. Never mutate, submit, export, download, upload, or send."}
For a Jira ticket, run \`node .harness/capability-doctor.mjs --capability jira-ticket-read --subject <SERV-ID>\` before grounding.
If it requests access, stop and request OAuth Jira Browse/Read or a sanitized ticket export; a declared connector still requires a successful live ticket read.
Teamwork Graph CLI skills (\`twg\`, \`twg-jira\`, \`twg-confluence\`) are on the same allow-list. Do not treat them as ready until \`teamwork-graph-cli\` is ready. Jira MCP remains the ticket oracle.
`;
}

export function copilotInstructions(lane) {
  return toolInstructions("Copilot", lane);
}

export function geminiInstructions(lane) {
  return toolInstructions("Gemini", lane);
}

export function consumerVerifierReadme(lane = "root") {
  const name = lane === "e2e" ? "E2E" : lane === "smoke" ? "Smoke" : "FHF root";
  const required = lane === "e2e" || lane === "smoke";
  const backendRunner = lane === "root"
    ? `For backend API/Oracle execution, validate the active task and run
\`node .harness/backend-task-runner.mjs preflight --manifest <absolute-task.json> --test-id <id>\`
before replacing \`preflight\` with \`run\`. The runner forces the exact manifest-selected pytest
path, Dev/QA, sequential execution, current source SHA, scoped dirty paths, and fresh JUnit evidence.
It never uploads TestRail or sends email.\n`
    : "";
  return `# Consumer harness verification

Everything under \`.harness/\` and \`.claude/\` here is GENERATED by
\`fhf-harness-os/scripts/harness/sync-loader-shims.mjs\`. Fix the canonical source in that
repository and re-run sync. An edit made here is blocked by the sync hash-guard and has to be
ported upstream before any lane can receive it.

This clone does not contain \`fhf-harness-os/scripts/harness/*\`.

For the ${name} lane, run \`node .harness/setup.mjs\` once and provide the local FHF workspace root
and the separate application-spec repository root. The generated \`.harness/workspace.example.json\`
is the input form; \`.harness/workspace.local.json\` is ignored and must never contain credentials.
Run \`node .harness/verify.mjs\` here before starting work. It validates the vendored projection,
the selected branch, local ${name} documentation, the FHF workspace instructions, and every configured
application-spec target.${required ? ` Missing required setup blocks ${name} work.` : ""} Canonical checks (\`test-hooks\`,
\`test-adapter-contract\`, \`test-sync-loader\`, \`check-docs-links\`, \`check-loader-drift\`) run
only from \`fhf-harness-os\`. ${required ? `For an executable local or Cloud worktree, copy \`.harness/execution.example.json\` to a profile outside the worktree and run
\`node .harness/prepare-execution.mjs --profile <external-profile.json> --mode local\` (or
\`cloud\`). The profile contains local file paths only; it must never contain credential values.` : ""}
Runtime loop evidence is recorded with \`node .harness/record-loop-event.mjs '<json>'\`; state and
trace files under \`cypress/handoff/\` are transient and ignored.
For task-required Jira, Figma, Cypress Cloud, backend, or TestRail access, run
\`node .harness/capability-doctor.mjs --capability <id> --subject <task-safe-label>\`. It requests
the exact safe access or approved fallback when a selected capability cannot be read; it never accepts credentials.
TestRail is task-selected for case lookup/reporting only; uploads always need separate explicit approval.
Use \`node .harness/task-protocol.mjs contract\` to inspect the task schema, then \`validate\`,
\`digest\`, and \`next\` against one runtime-only task manifest. Those three commands are read-only
and never approve. A human stamps a gate with \`approve --manifest <task.json> --gate <id>\`;
agents cannot.${backendRunner ? `
${backendRunner.trimEnd()}` : ""}
`;
}

const NPMRC_EXAMPLE_TEXT = fs.readFileSync(
  path.join(HARNESS_ROOT, "scripts", "harness", "templates", "npmrc.example"),
  "utf8",
).replace(/\r\n/g, "\n");

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

export const WORKSPACE_SETUP_TEXT = fs.readFileSync(
  path.join(HARNESS_ROOT, "scripts", "harness", "workspace-setup.mjs"),
  "utf8",
).replace(/\r\n/g, "\n");

export const JIRA_ACCESS_DOCTOR_TEXT = fs.readFileSync(
  path.join(HARNESS_ROOT, "scripts", "harness", "jira-access-doctor.mjs"),
  "utf8",
).replace(/\r\n/g, "\n");

export const CAPABILITY_DOCTOR_TEXT = fs.readFileSync(
  path.join(HARNESS_ROOT, "scripts", "harness", "capability-doctor.mjs"),
  "utf8",
).replace(/\r\n/g, "\n");

export const TASK_PROTOCOL_LIB_TEXT = fs.readFileSync(
  path.join(HARNESS_ROOT, "scripts", "harness", "task-protocol-lib.mjs"),
  "utf8",
).replace(/\r\n/g, "\n");

export const TASK_PROTOCOL_CLI_TEXT = fs.readFileSync(
  path.join(HARNESS_ROOT, "scripts", "harness", "task-protocol.mjs"),
  "utf8",
).replace(/\r\n/g, "\n");

export const BACKEND_TASK_RUNNER_TEXT = fs.readFileSync(
  path.join(HARNESS_ROOT, "scripts", "harness", "backend-task-runner.mjs"),
  "utf8",
).replace(/\r\n/g, "\n");

export const EXECUTION_SETUP_TEXT = fs.readFileSync(
  path.join(HARNESS_ROOT, "scripts", "harness", "execution-setup.mjs"),
  "utf8",
).replace(/\r\n/g, "\n");
