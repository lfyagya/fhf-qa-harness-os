#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { jiraTicketAccess, recordJiraTicketAccessOutcome } from "../../.claude/hooks/lib/jira-ticket-access.mjs";

const root = mkdtempSync(path.join(os.tmpdir(), "fhf-jira-access-"));
const config = {
  paths: { lanes: {} },
  workspaceContract: { setupFile: ".harness/workspace.local.json", lanes: { root: { required: false } } },
  connectors: { atlassianMcp: { ticketAccess: {
    authentication: "oauth", transport: "claude.ai-connector",
    requiredCapability: { operation: "read-selected-ticket" },
    accessRequest: { steps: ["connect"] }, liveProbe: { steps: ["probe"] }, prohibited: ["never paste credentials"],
    loop: {
      stateDirectory: ".harness/jira-access", maxRetryableTransportFailures: 1,
      outcomes: {
        readable: { status: "ready-to-ground", reason: "read", nextSteps: ["ground"] },
        "authorization-required": { status: "blocked-authorization", reason: "denied", nextSteps: ["request"] },
        "transport-unavailable": { retryable: true, reason: "offline", nextSteps: ["retry"] },
      },
      escalation: { nextSteps: ["escalate"] },
    },
  } } },
};
try {
  const missing = jiraTicketAccess({ ticket: "SERV-11887", root, config });
  assert.equal(missing.status, "access-request-required");
  assert.equal(missing.exitCode, 2);
  mkdirSync(path.join(root, ".harness"), { recursive: true });
  writeFileSync(path.join(root, ".harness", "workspace.local.json"), JSON.stringify({ optional: { jiraMcp: true } }), "utf8");
  const configured = jiraTicketAccess({ ticket: "serv-11887", root, config });
  assert.equal(configured.status, "live-probe-required");
  assert.equal(configured.exitCode, 2);
  assert.equal(configured.ticket, "SERV-11887");
  recordJiraTicketAccessOutcome({ ticket: "SERV-11887", root, config, outcome: "authorization-required" });
  assert.equal(jiraTicketAccess({ ticket: "SERV-11887", root, config }).status, "blocked-authorization");
  recordJiraTicketAccessOutcome({ ticket: "SERV-11887", root, config, outcome: "readable" });
  const ready = jiraTicketAccess({ ticket: "SERV-11887", root, config });
  assert.equal(ready.status, "ready-to-ground");
  assert.equal(ready.exitCode, 0);
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log("Jira ticket access tests passed");
