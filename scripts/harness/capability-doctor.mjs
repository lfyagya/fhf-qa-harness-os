#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = [path.resolve(here, "..", ".."), path.resolve(here, "..")]
  .find((candidate) => fs.existsSync(path.join(candidate, ".claude", "hooks", "lib", "harness-config.mjs")));
if (!root) {
  console.error("CAPABILITY DOCTOR FAILED: generated hook libraries are missing; regenerate the consumer projection.");
  process.exit(2);
}
const library = path.join(root, ".claude", "hooks", "lib");
const { loadHarnessConfig } = await import(pathToFileURL(path.join(library, "harness-config.mjs")).href);
const { capabilityStatus, formatCapabilityStatus, recordCapabilityOutcome } = await import(pathToFileURL(path.join(library, "capability-control.mjs")).href);
const option = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const id = option("--capability");
const subject = option("--subject");
const outcome = option("--outcome");
if (!id || !subject) {
  console.error("Usage: node .harness/capability-doctor.mjs --capability <id> --subject <task-safe-label> [--outcome <observed-outcome>]");
  process.exit(2);
}
try {
  const config = loadHarnessConfig();
  if (outcome) recordCapabilityOutcome({ id, subject, root, config, outcome });
  const result = capabilityStatus({ id, subject, root, config });
  console.log(JSON.stringify(result, null, 2));
  console.log(formatCapabilityStatus(result));
  process.exit(result.exitCode);
} catch (error) {
  console.error(`CAPABILITY DOCTOR FAILED: ${error.message}`);
  process.exit(2);
}
