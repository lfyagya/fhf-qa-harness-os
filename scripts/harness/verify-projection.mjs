#!/usr/bin/env node
// Consumer-runnable projection check. Canonical tests live in fhf-harness-os.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const issues = [];
const projectionOnly = ["change", "projection", "--projection-only"].includes(process.argv[2]);
const settingsPath = path.join(ROOT, ".claude", "settings.json");
const configPath = path.join(ROOT, ".claude", "harness.config.json");
const hooksPath = path.join(ROOT, ".cursor", "hooks.json");
const gitignorePath = path.join(ROOT, ".gitignore");
const lanePath = path.join(ROOT, ".harness", "lane.json");
const workspaceExamplePath = path.join(ROOT, ".harness", "workspace.example.json");
const setupPath = path.join(ROOT, ".harness", "setup.mjs");
const workspaceContractPath = path.join(ROOT, ".claude", "hooks", "lib", "workspace-contract.mjs");
const runtimeStatePath = path.join(ROOT, ".harness", "portable-runtime-state.mjs");
const recordLoopEventPath = path.join(ROOT, ".harness", "record-loop-event.mjs");

function readJson(file) {
  if (!fs.existsSync(file)) {
    issues.push(`Missing ${path.relative(ROOT, file).replaceAll("\\", "/")}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    issues.push(`Invalid JSON in ${path.relative(ROOT, file).replaceAll("\\", "/")}: ${error.message}`);
    return null;
  }
}

function assertNoHomePath(file, text) {
  if (/(?:[A-Za-z]:[\\/](?:Users|home)[\\/]|\/(?:Users|home)\/)/.test(text)) {
    issues.push(`${path.relative(ROOT, file).replaceAll("\\", "/")} embeds a machine-specific path`);
  }
}

const settings = readJson(settingsPath);
const config = readJson(configPath);
const cursorHooks = fs.existsSync(hooksPath) ? fs.readFileSync(hooksPath, "utf8") : "";
const lane = readJson(lanePath);
const workspaceExample = readJson(workspaceExamplePath);
for (const file of [setupPath]) {
  if (!fs.existsSync(file)) issues.push(`Missing ${path.relative(ROOT, file).replaceAll("\\", "/")}`);
}
for (const file of [runtimeStatePath, recordLoopEventPath]) {
  if (!fs.existsSync(file)) issues.push(`Missing ${path.relative(ROOT, file).replaceAll("\\", "/")}`);
}
if (settings) assertNoHomePath(settingsPath, JSON.stringify(settings));
if (cursorHooks) assertNoHomePath(hooksPath, cursorHooks);
if (fs.existsSync(setupPath)) assertNoHomePath(setupPath, fs.readFileSync(setupPath, "utf8"));
for (const file of [runtimeStatePath, recordLoopEventPath]) {
  if (fs.existsSync(file)) assertNoHomePath(file, fs.readFileSync(file, "utf8"));
}

const verify = config?.engineering?.harness?.verify;
if (!verify || typeof verify !== "object" || Array.isArray(verify)) {
  issues.push("engineering.harness.verify must be { canonical, consumer }");
} else {
  if (!Array.isArray(verify.canonical) || verify.canonical.length === 0) {
    issues.push("engineering.harness.verify.canonical must be a non-empty list");
  }
  if (!Array.isArray(verify.consumer) || !verify.consumer.includes(".harness/verify.mjs")) {
    issues.push("engineering.harness.verify.consumer must include .harness/verify.mjs");
  }
  for (const script of verify.canonical ?? []) {
    if (fs.existsSync(path.join(ROOT, script))) {
      issues.push(`Canonical-only verifier is present in this clone: ${script}`);
    }
  }
  for (const script of verify.consumer ?? []) {
    if (script.replaceAll("\\", "/").startsWith("scripts/harness/")) {
      issues.push(`Consumer verify must not advertise canonical-only ${script}`);
    }
    if (!fs.existsSync(path.join(ROOT, script))) {
      issues.push(`Consumer verifier is missing: ${script}`);
    }
  }
}

const commands = JSON.stringify(settings ?? {});
if (!commands.includes("CLAUDE_PROJECT_DIR") || !commands.includes("CURSOR_PROJECT_DIR")) {
  issues.push("Generated settings must resolve hooks through runtime project variables");
}

const hookFiles = [...commands.matchAll(/"([a-z0-9-]+\.mjs)"/gi)].map((match) => match[1]);
for (const script of new Set(hookFiles)) {
  if (!fs.existsSync(path.join(ROOT, ".claude", "hooks", script))) {
    issues.push(`Vendored hook is missing: .claude/hooks/${script}`);
  }
}

if (issues.length) {
  console.error("Consumer harness projection check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  console.error("Repair guidance: regenerate generated policy from fhf-harness-os, then rerun node .harness/verify.mjs change.");
  process.exit(1);
}

if (!lane || !["root", "e2e", "smoke", "backend"].includes(lane.lane)) {
  issues.push(".harness/lane.json must declare root, e2e, smoke, or backend");
}
if (!workspaceExample || workspaceExample.schema !== "fhf-harness/workspace-setup/v1") {
  issues.push(".harness/workspace.example.json has an invalid schema");
}

if ((lane?.lane === "e2e" || lane?.lane === "smoke" || lane?.lane === "backend") && config) {
  if (!fs.existsSync(workspaceContractPath)) {
    issues.push("Missing .claude/hooks/lib/workspace-contract.mjs");
  }
  if (!fs.existsSync(gitignorePath) || !fs.readFileSync(gitignorePath, "utf8").includes(".harness/workspace.local.json")) {
    issues.push(".gitignore must ignore .harness/workspace.local.json");
  }
  if (!projectionOnly) {
    const { workspacePreflight } = await import(pathToFileURL(path.join(ROOT, ".claude", "hooks", "lib", "workspace-contract.mjs")).href);
    const result = workspacePreflight({ root: ROOT, config });
    for (const issue of result.issues) issues.push(issue);
    for (const warning of result.warnings) console.warn(`OPTIONAL: ${warning}`);
  }
}

if (issues.length) {
  console.error("Consumer harness projection check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  console.error("Repair guidance: complete node .harness/setup.mjs for local paths, or regenerate generated policy from fhf-harness-os.");
  process.exit(1);
}

console.log(
  projectionOnly
    ? "Consumer harness projection is portable and complete; workspace preflight was skipped for projection-only mode."
    : "Consumer harness projection and workspace contract are complete.",
);
