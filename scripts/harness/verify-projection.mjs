#!/usr/bin/env node
// Consumer-runnable projection check. Canonical tests live in fhf-harness-os.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const issues = [];
const settingsPath = path.join(ROOT, ".claude", "settings.json");
const configPath = path.join(ROOT, ".claude", "harness.config.json");
const hooksPath = path.join(ROOT, ".cursor", "hooks.json");
const runtimeStatePath = path.join(ROOT, ".harness", "portable-runtime-state.mjs");
const recordLoopEventPath = path.join(ROOT, ".harness", "record-loop-event.mjs");

function readJson(file) {
  if (!fs.existsSync(file)) {
    issues.push(`Missing ${path.relative(ROOT, file).replaceAll("\\", "/")}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assertNoHomePath(file, text) {
  if (/(?:[A-Za-z]:[\\/](?:Users|home)[\\/]|\/(?:Users|home)\/)/.test(text)) {
    issues.push(`${path.relative(ROOT, file).replaceAll("\\", "/")} embeds a machine-specific path`);
  }
}

const settings = readJson(settingsPath);
const config = readJson(configPath);
const cursorHooks = fs.existsSync(hooksPath) ? fs.readFileSync(hooksPath, "utf8") : "";
for (const file of [runtimeStatePath, recordLoopEventPath]) {
  if (!fs.existsSync(file)) issues.push(`Missing ${path.relative(ROOT, file).replaceAll("\\", "/")}`);
}
if (settings) assertNoHomePath(settingsPath, JSON.stringify(settings));
if (cursorHooks) assertNoHomePath(hooksPath, cursorHooks);
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
  process.exit(1);
}

console.log("Consumer harness projection is portable and complete.");
