import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { detectLane, loadHarnessConfig } from "./harness-config.mjs";

const PROJECT_ROOT = path.resolve(
  process.env.CLAUDE_PROJECT_DIR ?? process.env.CURSOR_PROJECT_DIR ?? process.cwd(),
);

function bool(value) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return undefined;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function setupPath(root, config) {
  const configured = process.env.FHF_HARNESS_WORKSPACE_CONFIG;
  return path.resolve(root, configured || config.workspaceContract.setupFile);
}

function loadSetup(root, config) {
  const file = setupPath(root, config);
  const environmentFields = [
    "FHF_CONSUMER_ROOT",
    "FHF_MODULE_SPECS_ROOT",
    "FHF_E2E_ROOT",
    "FHF_SMOKE_ROOT",
    "FHF_BACKEND_ROOT",
    "FHF_JIRA_MCP",
    "FHF_CONFLUENCE_MCP",
    "FHF_CYPRESS_CLOUD",
  ];
  const hasEnvironmentSetup = environmentFields.some((field) => process.env[field] !== undefined);
  if (!fs.existsSync(file) && !hasEnvironmentSetup) return { file, values: null, error: null };
  const parsed = fs.existsSync(file)
    ? (() => {
        try {
          return JSON.parse(fs.readFileSync(file, "utf8"));
        } catch (error) {
          return { __error: error.message };
        }
      })()
    : {};
  if (parsed?.__error) return { file, values: null, error: parsed.__error };
  try {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { file, values: null, error: "setup file must contain a JSON object" };
    }
    const optional = parsed.optional && typeof parsed.optional === "object" ? parsed.optional : {};
    const values = {
      ...parsed,
      ...optional,
      consumerRoot: process.env.FHF_CONSUMER_ROOT ?? parsed.consumerRoot,
      moduleSpecsRoot: process.env.FHF_MODULE_SPECS_ROOT ?? parsed.moduleSpecsRoot,
      e2eRoot: process.env.FHF_E2E_ROOT ?? parsed.e2eRoot,
      smokeRoot: process.env.FHF_SMOKE_ROOT ?? parsed.smokeRoot,
      backendRoot: process.env.FHF_BACKEND_ROOT ?? parsed.backendRoot ?? optional.backendRoot,
      jiraMcp: bool(process.env.FHF_JIRA_MCP) ?? bool(parsed.jiraMcp ?? optional.jiraMcp),
      confluenceMcp: bool(process.env.FHF_CONFLUENCE_MCP) ?? bool(parsed.confluenceMcp ?? optional.confluenceMcp),
      cypressCloud: bool(process.env.FHF_CYPRESS_CLOUD) ?? bool(parsed.cypressCloud ?? optional.cypressCloud),
    };
    return { file, values, error: null };
  } catch (error) {
    return { file, values: null, error: error.message };
  }
}

function resolveInput(root, value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  return path.resolve(root, value);
}

function normalize(value) {
  return String(value).replace(/\\/g, "/").replace(/^\.\//, "");
}

function pathMatches(file, type) {
  if (type === "directory") return fs.existsSync(file) && fs.statSync(file).isDirectory();
  return fs.existsSync(file) && fs.statSync(file).isFile();
}

function gitBranch(root) {
  const result = spawnSync("git", ["branch", "--show-current"], {
    cwd: root,
    encoding: "utf8",
    timeout: 5000,
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function specTarget(moduleRoot, target, prefix) {
  const normalizedTarget = normalize(target);
  const normalizedPrefix = normalize(prefix).replace(/\/$/, "");
  const relative = normalizedTarget.startsWith(`${normalizedPrefix}/`)
    ? normalizedTarget.slice(normalizedPrefix.length + 1)
    : normalizedTarget;
  return path.resolve(moduleRoot, relative);
}

export function workspacePreflight({ root = PROJECT_ROOT, config = loadHarnessConfig() } = {}) {
  const projectRoot = path.resolve(root);
  const lane = detectLane(projectRoot, config);
  if (lane === "unknown") {
    return {
      ready: false,
      lane,
      issues: [
        "Harness lane configuration is missing or invalid: .harness/lane.json must declare root, e2e, or smoke.",
        "Set FHF_LANE explicitly only for the current session, then regenerate the consumer projection.",
      ],
      warnings: [],
      setupFile: config.workspaceContract?.setupFile ?? ".harness/workspace.local.json",
      values: null,
    };
  }
  const workspaceContract = config.workspaceContract;
  const contract = workspaceContract?.lanes?.[lane];
  const laneLabel = lane === "e2e" ? "E2E" : lane === "smoke" ? "Smoke" : lane;
  if ((lane === "e2e" || lane === "smoke") && (!workspaceContract || !contract)) {
    return {
      ready: false,
      lane,
      issues: [
        `Harness configuration is incomplete: workspaceContract.lanes.${lane} is missing.`,
        "Regenerate the consumer projection from fhf-harness-os, then run node .harness/verify.mjs change.",
      ],
      warnings: [],
      setupFile: workspaceContract?.setupFile ?? ".harness/workspace.local.json",
      values: null,
    };
  }
  if (!contract?.required) {
    return { ready: true, lane, issues: [], warnings: [], setupFile: null, values: null };
  }

  const contractIssues = [];
  for (const field of ["setupFile", "setupExample", "setupCommand"]) {
    if (typeof workspaceContract?.[field] !== "string" || workspaceContract[field].trim() === "") {
      contractIssues.push(`Harness configuration is incomplete: workspaceContract.${field} is missing.`);
    }
  }
  if (!Array.isArray(contract.requiredInputs) || contract.requiredInputs.length === 0) {
    contractIssues.push(`Harness configuration is incomplete: ${laneLabel} requiredInputs are missing.`);
  }
  if (contractIssues.length > 0) {
    return {
      ready: false,
      lane,
      issues: [
        ...contractIssues,
        "Repair the canonical policy or regenerate the consumer projection; do not continue with a partial config.",
      ],
      warnings: [],
      setupFile: workspaceContract.setupFile ?? ".harness/workspace.local.json",
      values: null,
    };
  }

  const issues = [];
  const warnings = [];
  const setup = loadSetup(projectRoot, config);
  const values = setup.values;

  if (setup.error) issues.push(`Invalid workspace setup ${setup.file}: ${setup.error}`);
  if (!values) {
    issues.push(`Workspace setup is required. Run ${config.workspaceContract.setupCommand} and provide the requested paths.`);
  }

  for (const input of contract.requiredInputs ?? []) {
    if (!values || typeof values[input.field] !== "string" || values[input.field].trim() === "") {
      issues.push(`Missing required setup input: ${input.label} (${input.field})`);
    }
  }

  for (const entry of contract.requiredLocalPaths ?? []) {
    const target = path.join(projectRoot, entry.path);
    if (!pathMatches(target, entry.type)) {
      issues.push(`Missing ${laneLabel} ${entry.type}: ${entry.path}`);
    }
  }

  const consumerRoot = resolveInput(projectRoot, values?.consumerRoot);
  const moduleSpecsRoot = resolveInput(projectRoot, values?.moduleSpecsRoot);
  const e2eRoot = resolveInput(projectRoot, values?.e2eRoot);
  const smokeRoot = resolveInput(projectRoot, values?.smokeRoot);
  const laneRootField = lane === "e2e" ? "e2eRoot" : lane === "smoke" ? "smokeRoot" : null;
  const laneRoot = laneRootField === "e2eRoot" ? e2eRoot : laneRootField === "smokeRoot" ? smokeRoot : null;
  if (laneRoot && path.resolve(laneRoot) !== projectRoot) {
    issues.push(`${laneLabel} repository root must match the current checkout: ${laneRoot}`);
  }
  if (consumerRoot) {
    for (const entry of contract.requiredWorkspacePaths ?? []) {
      const base = entry.field === "moduleSpecsRoot" ? moduleSpecsRoot : consumerRoot;
      const target = base && path.join(base, entry.path);
      if (!target || !pathMatches(target, entry.type)) {
        issues.push(`Missing ${entry.label}: ${entry.field}/${entry.path}`);
      }
    }
  }

  if (moduleSpecsRoot) {
    for (const [module, targets] of Object.entries(config.moduleSpecPaths ?? {})) {
      for (const target of targets ?? []) {
        const resolved = specTarget(moduleSpecsRoot, target, contract.moduleSpecsPathPrefix);
        if (!fs.existsSync(resolved)) {
          issues.push(`Missing application spec for ${module}: ${normalize(target)}`);
        }
      }
    }
  }

  const backendRoot = resolveInput(projectRoot, values?.backendRoot);
  if (values?.backendRoot !== undefined && values.backendRoot !== "" && typeof values.backendRoot !== "string") {
    issues.push("Configured optional backend repository must be a path string");
  } else if (typeof values?.backendRoot === "string" && values.backendRoot.trim() !== "" && !pathMatches(backendRoot, "directory")) {
    issues.push(`Configured optional backend repository is not a directory: ${values.backendRoot}`);
  }

  if (contract.requireBranch !== false) {
    const branch = gitBranch(projectRoot);
    if (!branch) {
      issues.push(`Cannot determine the current Git branch from ${projectRoot}`);
    } else if (contract.branch && branch !== contract.branch) {
      issues.push(`${laneLabel} work must run on branch ${contract.branch}; current branch is ${branch}`);
    }
  }

  if (!values?.backendRoot) warnings.push("Backend evidence repository is not configured; backend evidence remains unavailable.");
  if (!values?.jiraMcp) warnings.push("Jira MCP/OAuth is not configured; Jira discovery and writes are unavailable.");
  if (!values?.confluenceMcp) warnings.push("Confluence MCP/OAuth is not configured; Confluence discovery and writes are unavailable.");
  if (!values?.cypressCloud) warnings.push("Cypress Cloud is not configured; use local JUnit and run metadata only.");

  return {
    ready: issues.length === 0,
    lane,
    issues,
    warnings,
    setupFile: setup.file,
    values: values
      ? {
          consumerRoot,
          moduleSpecsRoot,
          e2eRoot,
          smokeRoot,
          backendRoot,
          jiraMcp: Boolean(values.jiraMcp),
          confluenceMcp: Boolean(values.confluenceMcp),
          cypressCloud: Boolean(values.cypressCloud),
        }
      : null,
  };
}

export function formatWorkspacePreflight(result, config = loadHarnessConfig()) {
  const setupCommand = config.workspaceContract?.setupCommand ?? "node .harness/setup.mjs";
  const lines = [
    `WORKSPACE BLOCKED: Harness configuration is incomplete for lane '${result.lane}'.`,
    `Setup file: ${result.setupFile ?? config.workspaceContract?.setupFile ?? ".harness/workspace.local.json"}`,
  ];
  for (const issue of result.issues) lines.push(`- ${issue}`);
  for (const warning of result.warnings) lines.push(`- OPTIONAL: ${warning}`);
  lines.push(`Complete the setup form, then run ${setupCommand} or ${setupCommand.replace("setup", "verify")}.`);
  return lines.join("\n");
}

export function enforceWorkspaceReady(options = {}) {
  const config = options.config ?? loadHarnessConfig();
  const result = workspacePreflight({ ...options, config });
  if (!result.ready) {
    console.error(formatWorkspacePreflight(result, config));
    process.exit(2);
  }
  return result;
}

export function isWorkspaceBootstrapCommand(command = "") {
  return /(?:node|npx)\b[^\r\n;&|]*\.harness[\\/]setup\.mjs\b/i.test(command)
    || /(?:node|npx)\b[^\r\n;&|]*\.harness[\\/]verify\.mjs\b/i.test(command);
}
