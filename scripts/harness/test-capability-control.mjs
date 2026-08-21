#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { capabilityStatus, recordCapabilityOutcome } from "../../.claude/hooks/lib/capability-control.mjs";

const root = mkdtempSync(path.join(os.tmpdir(), "fhf-capability-"));
const config = {
  paths: { lanes: {} }, workspaceContract: { setupFile: ".harness/workspace.local.json", lanes: { root: { required: false } } },
  engineering: { capabilityControl: {
    stateDirectory: "cypress/handoff/capabilities", maxRetryableUnavailable: 1,
    capabilities: {
      "figma-design-read": { label: "Figma", workspaceDeclaration: "figmaMcp", accessRequest: { steps: ["connect"] }, liveProbe: { steps: ["probe"] }, escalation: { nextSteps: ["escalate"] }, outcomes: {
        ready: { status: "ready", reason: "read" }, "authentication-required": { status: "blocked-authentication", reason: "auth" }, unavailable: { retryable: true, reason: "down" },
      } },
      "testrail-read-report": { label: "TestRail", workspaceDeclaration: "testRail", accessRequest: { steps: ["connect"] }, liveProbe: { steps: ["probe"] }, escalation: { nextSteps: ["escalate"] }, outcomes: {
        ready: { status: "ready", reason: "read" }, "authorization-required": { status: "blocked-authorization", reason: "denied" }, unavailable: { retryable: true, reason: "down" },
      } },
    },
  } },
};
mkdirSync(path.join(root, ".harness"), { recursive: true });
writeFileSync(path.join(root, ".harness", "workspace.local.json"), JSON.stringify({ optional: { figmaMcp: true, testRail: true } }));

assert.equal(capabilityStatus({ id: "figma-design-read", subject: "file/node", root, config }).status, "live-probe-required");
recordCapabilityOutcome({ id: "figma-design-read", subject: "file/node", root, config, outcome: "ready" });
assert.equal(capabilityStatus({ id: "figma-design-read", subject: "file/node", root, config }).exitCode, 0);
recordCapabilityOutcome({ id: "testrail-read-report", subject: "run-12", root, config, outcome: "unavailable" });
assert.equal(capabilityStatus({ id: "testrail-read-report", subject: "run-12", root, config }).status, "retry-required");
recordCapabilityOutcome({ id: "testrail-read-report", subject: "run-12", root, config, outcome: "unavailable" });
assert.equal(capabilityStatus({ id: "testrail-read-report", subject: "run-12", root, config }).status, "escalated");
rmSync(root, { recursive: true, force: true });
console.log("Capability control self-test passed.");
