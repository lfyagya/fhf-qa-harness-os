import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FHF_ROOT = path.resolve(HARNESS_ROOT, "..", "FHF");
const DOCS_ROOT = path.join(FHF_ROOT, "docs");
const CONFIG = path.join(HARNESS_ROOT, "config", "qa-control-plane.json");
const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

function walk(dir, extensions) {
  if (!fs.existsSync(dir)) return [];
  if (fs.statSync(dir).isFile()) return extensions.some((ext) => dir.endsWith(ext)) ? [dir] : [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, extensions) : extensions.some((ext) => entry.name.endsWith(ext)) ? [full] : [];
  });
}

function repoPath(value) {
  return value.replaceAll("\\", "/").replace(/^\.?\//, "");
}

const issues = [];
let config;
let documentation;
let engineering;
try {
  config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  documentation = config.documentation;
  engineering = config.engineering;
} catch (error) {
  issues.push(`Invalid harness config: ${error.message}`);
}

if (documentation) {
  const precedence = documentation.sourcePrecedence;
  if (!Array.isArray(precedence) || precedence.length === 0 || new Set(precedence).size !== precedence.length) {
    issues.push("documentation.sourcePrecedence must be a non-empty list without duplicates");
  } else if (precedence.at(-1) !== "obsidian-derived-index") {
    issues.push("obsidian-derived-index must remain the lowest-precedence source");
  }

  const owners = Object.entries(documentation.owners ?? {});
  if (owners.length === 0) issues.push("documentation.owners must not be empty");
  for (const [concern, owner] of owners) {
    if (typeof owner !== "string" || !fs.existsSync(path.resolve(FHF_ROOT, repoPath(owner)))) {
      issues.push(`Documentation owner '${concern}' is missing: ${owner}`);
    }
  }

}

if (engineering) {
  for (const pillar of ["context", "memory", "harness", "loops"]) {
    if (!engineering[pillar] || typeof engineering[pillar] !== "object") {
      issues.push(`engineering.${pillar} must be configured`);
    }
  }

  const routes = engineering.context?.routes;
  if (!Array.isArray(routes) || routes.length === 0) {
    issues.push("engineering.context.routes must not be empty");
  } else {
    const routeIds = new Set();
    routes.forEach((route, index) => {
      if (!route.id || routeIds.has(route.id)) {
        issues.push(`engineering.context.routes[${index}] needs a unique id`);
      }
      routeIds.add(route.id);
      if (!Number.isInteger(route.priority)) {
        issues.push(`engineering.context.routes[${index}] needs an integer priority`);
      }
      try {
        new RegExp(route.match, "i");
      } catch (error) {
        issues.push(`engineering.context.routes[${index}] has invalid match: ${error.message}`);
      }
      if (!route.hint) issues.push(`engineering.context.routes[${index}] needs a hint`);
      if (route.lanes) {
        const known = new Set(["root", "e2e", "smoke", "backend"]);
        if (!Array.isArray(route.lanes) || route.lanes.length === 0 || route.lanes.some((name) => !known.has(name))) {
          issues.push(`engineering.context.routes[${index}] lanes must be a non-empty subset of root|e2e|smoke|backend`);
        }
      }
    });
  }

  if (engineering.memory?.obsidian?.authority !== "derived-only" || engineering.memory?.obsidian?.writeBack !== false) {
    issues.push("Obsidian must remain derived-only with writeBack=false");
  }
  if (!Number.isInteger(engineering.memory?.handoffMaxAgeHours) || engineering.memory.handoffMaxAgeHours < 1) {
    issues.push("engineering.memory.handoffMaxAgeHours must be a positive integer");
  }
  const extractors = engineering.memory?.factExtractors ?? [];
  const extractorNames = new Set(extractors.map((extractor) => extractor.name));
  for (const fact of engineering.memory?.preserveExactly ?? []) {
    if (!extractorNames.has(fact)) issues.push(`Missing memory fact extractor for ${fact}`);
  }
  for (const [index, extractor] of extractors.entries()) {
    try {
      const regex = new RegExp(extractor.match, extractor.flags);
      if (!regex.global) issues.push(`engineering.memory.factExtractors[${index}] must be global`);
    } catch (error) {
      issues.push(`engineering.memory.factExtractors[${index}] is invalid: ${error.message}`);
    }
  }

  const appBoundary = engineering.harness?.boundaries?.applicationSource;
  if (appBoundary?.mode !== "read-only") {
    issues.push("engineering.harness.boundaries.applicationSource must be read-only");
  }
  for (const [index, source] of (appBoundary?.pathPatterns ?? []).entries()) {
    try {
      new RegExp(source, "i");
    } catch (error) {
      issues.push(`applicationSource.pathPatterns[${index}] is invalid: ${error.message}`);
    }
  }
  for (const lane of ["root", "e2e", "smoke", "backend"]) {
    if (!Array.isArray(appBoundary?.denyWriteByLane?.[lane]) || appBoundary.denyWriteByLane[lane].length === 0) {
      issues.push(`applicationSource.denyWriteByLane.${lane} must not be empty`);
    }
  }

  const adapters = engineering.harness?.adapters;
  if (adapters?.claudeCode?.autoCompactWindowEnv !== "CLAUDE_CODE_AUTO_COMPACT_WINDOW") {
    issues.push("Claude adapter must use CLAUDE_CODE_AUTO_COMPACT_WINDOW");
  }
  if (adapters?.cursor?.promptRouting !== "session-context") {
    issues.push("Cursor adapter must use session-context prompt routing");
  }
  if (adapters?.cursor?.compatibleHookDeduplication !== "identical-command") {
    issues.push("Cursor compatible hooks must deduplicate by identical command");
  }
  if (adapters?.codex?.instructionFile !== "AGENTS.md" || adapters?.codex?.hookCapability !== "instruction-only") {
    issues.push("Codex must use the verified AGENTS.md instruction-only adapter");
  }
  if (engineering.harness?.skillOverrides || engineering.harness?.permissions) {
    issues.push("Tool-specific settings must live under engineering.harness.adapters");
  }

  for (const agent of engineering.harness?.agents ?? []) {
    if (!fs.existsSync(path.join(HARNESS_ROOT, ".claude", "agents", `${agent}.md`))) {
      issues.push(`Configured harness agent is missing: ${agent}`);
    }
  }
  for (const skill of engineering.harness?.skills ?? []) {
    if (!fs.existsSync(path.join(HARNESS_ROOT, ".claude", "skills", skill, "SKILL.md"))) {
      issues.push(`Configured harness skill is missing: ${skill}`);
    }
  }
  for (const scripts of Object.values(engineering.harness?.hooks ?? {})) {
    for (const script of scripts) {
      if (!fs.existsSync(path.join(HARNESS_ROOT, ".claude", "hooks", script))) {
        issues.push(`Configured harness hook is missing: ${script}`);
      }
    }
  }
  const verify = engineering.harness?.verify;
  if (!verify || typeof verify !== "object" || Array.isArray(verify)) {
    issues.push("engineering.harness.verify must be { canonical, consumer }");
  } else {
    if (!Array.isArray(verify.canonical) || verify.canonical.length === 0) {
      issues.push("engineering.harness.verify.canonical must be a non-empty list");
    }
    if (!Array.isArray(verify.consumer) || verify.consumer.length === 0) {
      issues.push("engineering.harness.verify.consumer must be a non-empty list");
    }
    for (const script of verify.canonical ?? []) {
      if (!fs.existsSync(path.join(HARNESS_ROOT, repoPath(script)))) {
        issues.push(`Canonical verification script is missing: ${script}`);
      }
    }
    for (const script of verify.consumer ?? []) {
      if (String(script).replaceAll("\\", "/").startsWith("scripts/harness/")) {
        issues.push(`Consumer verification must not advertise canonical-only ${script}`);
      }
    }
    if (!fs.existsSync(path.join(HARNESS_ROOT, "scripts", "harness", "verify-projection.mjs"))) {
      issues.push("Consumer verifier source is missing: scripts/harness/verify-projection.mjs");
    }
  }
  for (const [name, value] of Object.entries(engineering.loops ?? {})) {
    if (name.endsWith("Limit") && (!Number.isInteger(value) || value < 1)) {
      issues.push(`engineering.loops.${name} must be a positive integer`);
    }
  }
} else if (config) {
  issues.push("engineering must configure context, memory, harness, and loops");
}

const cloud = config?.connectors?.cypressCloud;
const cloudCli = cloud?.cli;
if (!cloudCli) {
  issues.push("connectors.cypressCloud.cli must be configured");
} else {
  if (!Array.isArray(cloud.queryOrder) || !cloud.queryOrder.includes("cloud-cli")) {
    issues.push("connectors.cypressCloud.queryOrder must include cloud-cli");
  } else if (cloud.queryOrder.at(-1) !== cloud.fallback) {
    issues.push("connectors.cypressCloud.fallback must be the final queryOrder entry");
  }
  if (cloudCli.documentation !== "https://docs.cypress.io/cloud/integrations/cloud-cli") {
    issues.push("connectors.cypressCloud.cli.documentation must use the official Cypress page");
  }
  if (cloudCli.package !== "@cypress/cloud" || cloudCli.command !== "cy-cloud") {
    issues.push("connectors.cypressCloud.cli must configure the official package and command");
  }
  if (!/^\d+\.\d+\.\d+$/.test(cloudCli.minimumNodeVersion ?? "")) {
    issues.push("connectors.cypressCloud.cli.minimumNodeVersion must be a semver version");
  }
  const auth = cloudCli.authentication ?? {};
  if (auth.local !== "oauth" || auth.ciTokenEnv !== "CYPRESS_CLOUD_TOKEN" || auth.credentialsInConfig !== false) {
    issues.push("Cloud CLI auth must use local OAuth, external CI token env, and no config credentials");
  }
  const expectedAccess = { e2e: "full-read", smoke: "metadata-only", root: "metadata-only", backend: "none" };
  for (const [lane, access] of Object.entries(expectedAccess)) {
    if (cloudCli.laneAccess?.[lane] !== access) {
      issues.push(`connectors.cypressCloud.cli.laneAccess.${lane} must be ${access}`);
    }
  }
  if (typeof cloudCli.projectIdSource !== "string" || !cloudCli.projectIdSource) {
    issues.push("connectors.cypressCloud.cli.projectIdSource must be configured");
  } else {
    for (const lane of ["e2e", "smoke"]) {
      const lanePath = config.paths?.lanes?.[lane];
      const projectConfig = lanePath && path.resolve(
        FHF_ROOT,
        repoPath(lanePath.root),
        repoPath(lanePath.package),
        repoPath(cloudCli.projectIdSource),
      );
      if (!projectConfig || !fs.existsSync(projectConfig)) {
        issues.push(`Cloud CLI ${lane} projectIdSource is missing: ${projectConfig ?? "unconfigured"}`);
      } else if (!/\bprojectId\s*:/.test(fs.readFileSync(projectConfig, "utf8"))) {
        issues.push(`Cloud CLI ${lane} projectIdSource has no projectId: ${projectConfig}`);
      }
    }
  }
  const guard = cloudCli.guard ?? {};
  if (!Array.isArray(guard.safeNoNetworkFlags) || !guard.safeNoNetworkFlags.includes("--schema")) {
    issues.push("Cloud CLI guard must allow no-network schema inspection");
  }
  for (const listName of ["inlineCredentialPatterns", "productionSensitivePatterns"]) {
    const patterns = guard[listName];
    if (!Array.isArray(patterns) || patterns.length === 0) {
      issues.push(`connectors.cypressCloud.cli.guard.${listName} must not be empty`);
      continue;
    }
    patterns.forEach((source, index) => {
      try {
        new RegExp(source, "i");
      } catch (error) {
        issues.push(`Cloud CLI ${listName}[${index}] is invalid: ${error.message}`);
      }
    });
  }
}

const referrers = [
  path.join(FHF_ROOT, "CLAUDE.md"),
  path.join(FHF_ROOT, "AGENTS.md"),
  path.join(FHF_ROOT, ".claude", "rules"),
  DOCS_ROOT,
].flatMap((root) => walk(root, [".md", ".yaml", ".yml"]));

for (const file of referrers) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const match of line.matchAll(LINK_RE)) {
      const target = match[1].trim();
      if (/^([a-z]+:)?\/\//i.test(target) || target.startsWith("mailto:") || target.startsWith("#")) continue;
      const [targetPath] = target.split("#");
      if (!targetPath || (!targetPath.includes("/") && !/\.(md|json|ya?ml)$/i.test(targetPath))) continue;
      if (!fs.existsSync(path.resolve(path.dirname(file), targetPath))) {
        issues.push(`${path.relative(FHF_ROOT, file)}:${index + 1} links to missing "${target}"`);
      }
    }
  });
}

if (issues.length) {
  console.error("Documentation check failed:");
  issues.forEach((issue) => console.error(`- ${issue}`));
  process.exit(1);
}

console.log("Documentation routes and links are valid.");
