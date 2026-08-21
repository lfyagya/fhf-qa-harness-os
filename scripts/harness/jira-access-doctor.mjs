#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = [path.resolve(here, "..", ".."), path.resolve(here, "..")]
  .find((candidate) => fs.existsSync(path.join(candidate, ".claude", "hooks", "lib", "harness-config.mjs")));
if (!root) {
  console.error("JIRA ACCESS DOCTOR FAILED: generated hook libraries are missing; regenerate the consumer projection.");
  process.exit(2);
}
const hookLibrary = path.join(root, ".claude", "hooks", "lib");
const { loadHarnessConfig } = await import(pathToFileURL(path.join(hookLibrary, "harness-config.mjs")).href);
const { formatJiraTicketAccess, jiraTicketAccess, recordJiraTicketAccessOutcome } = await import(pathToFileURL(path.join(hookLibrary, "jira-ticket-access.mjs")).href);
const ticketIndex = process.argv.indexOf("--ticket");
const ticket = ticketIndex === -1 ? null : process.argv[ticketIndex + 1];
const outcomeIndex = process.argv.indexOf("--outcome");
const outcome = outcomeIndex === -1 ? null : process.argv[outcomeIndex + 1];
if (!ticket) {
  console.error("Usage: node scripts/harness/jira-access-doctor.mjs --ticket SERV-11887");
  process.exit(2);
}
try {
  const config = loadHarnessConfig();
  if (outcome) recordJiraTicketAccessOutcome({ ticket, root, config, outcome });
  const result = jiraTicketAccess({ ticket, root, config });
  console.log(JSON.stringify(result, null, 2));
  console.log(formatJiraTicketAccess(result));
  process.exit(result.exitCode);
} catch (error) {
  console.error(`JIRA ACCESS DOCTOR FAILED: ${error.message}`);
  process.exit(2);
}
