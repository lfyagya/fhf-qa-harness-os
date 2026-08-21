import fs from "node:fs";
import path from "node:path";
import { workspaceConnectorDeclarations } from "./workspace-contract.mjs";
import { capabilityStatus, formatCapabilityStatus, recordCapabilityOutcome } from "./capability-control.mjs";

export function ticketKeyFromPrompt(value = "") {
  const match = String(value).match(/\b(SERV-\d+)\b/i);
  return match?.[1].toUpperCase() ?? null;
}

function ticketPolicy(config) {
  const policy = config?.connectors?.atlassianMcp?.ticketAccess;
  if (!policy || typeof policy !== "object") {
    throw new Error("Harness configuration is missing connectors.atlassianMcp.ticketAccess");
  }
  return policy;
}

function statePath(root, policy, ticket) {
  const directory = String(policy.loop?.stateDirectory ?? "").trim();
  if (!directory || path.isAbsolute(directory) || directory.includes("..")) {
    throw new Error("Jira ticket-access stateDirectory must be a relative workspace path");
  }
  return path.resolve(root, directory, `${ticket}.json`);
}

function readState(file) {
  if (!fs.existsSync(file)) return null;
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  if (state?.schema !== "fhf-harness/jira-ticket-access-state/v1") {
    throw new Error(`Invalid Jira access state: ${file}`);
  }
  return state;
}

function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function outcomeDecision({ policy, ticket, state, declared }) {
  if (!declared) {
    return {
      status: "access-request-required",
      exitCode: 2,
      reason: "The local workspace does not declare an Atlassian MCP/OAuth connection.",
      requiredInput: policy.accessRequest,
    };
  }
  if (!state) {
    return {
      status: "live-probe-required",
      exitCode: 2,
      reason: "The connector is declared configured, but no live read result for this ticket has been recorded.",
      requiredInput: policy.liveProbe,
    };
  }
  const outcome = policy.loop?.outcomes?.[state.outcome];
  if (!outcome) throw new Error(`Unsupported recorded Jira access outcome: ${state.outcome}`);
  if (outcome.retryable && state.attempts <= policy.loop.maxRetryableTransportFailures) {
    return {
      status: "retry-required",
      exitCode: 2,
      reason: `${outcome.reason} Retry ${state.attempts} of ${policy.loop.maxRetryableTransportFailures}.`,
      requiredInput: outcome,
    };
  }
  if (outcome.retryable) {
    return {
      status: "escalated",
      exitCode: 2,
      reason: `${outcome.reason} Retry budget is exhausted.`,
      requiredInput: policy.loop.escalation,
    };
  }
  return {
    status: outcome.status,
    exitCode: outcome.status === "ready-to-ground" ? 0 : 2,
    reason: outcome.reason,
    requiredInput: outcome,
  };
}

export function recordJiraTicketAccessOutcome({ ticket, root, config, outcome } = {}) {
  const key = ticketKeyFromPrompt(ticket);
  if (!key) throw new Error("A Jira ticket key such as SERV-11887 is required");
  const mapped = {
    readable: "ready",
    "sanitized-export-provided": "fallback-ready",
    "ticket-not-found": "invalid-input",
    "transport-unavailable": "unavailable",
  }[outcome] ?? outcome;
  if (config?.engineering?.capabilityControl) {
    return recordCapabilityOutcome({ id: "jira-ticket-read", subject: key, root, config, outcome: mapped });
  }
  const policy = ticketPolicy(config);
  if (!policy.loop?.outcomes?.[outcome]) throw new Error(`Unsupported Jira access outcome: ${outcome}`);
  const file = statePath(root, policy, key);
  const previous = readState(file);
  const state = {
    schema: "fhf-harness/jira-ticket-access-state/v1",
    ticket: key,
    outcome,
    attempts: (previous?.attempts ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  writeState(file, state);
  return state;
}

export function jiraTicketAccess({ ticket, root, config } = {}) {
  const key = ticketKeyFromPrompt(ticket);
  if (!key) throw new Error("A Jira ticket key such as SERV-11887 is required");
  if (config?.engineering?.capabilityControl) {
    const result = capabilityStatus({ id: "jira-ticket-read", subject: key, root, config });
    return { ...result, ticket: key, connector: "atlassianMcp", status: result.status === "ready" ? "ready-to-ground" : result.status };
  }
  const policy = ticketPolicy(config);
  const declarations = workspaceConnectorDeclarations({ root, config });
  const declared = declarations.jiraMcp;
  const file = statePath(root, policy, key);
  const state = readState(file);
  const base = {
    schema: "fhf-harness/jira-ticket-access/v1",
    ticket: key,
    connector: "atlassianMcp",
    authentication: policy.authentication,
    transport: policy.transport,
    requiredCapability: policy.requiredCapability,
    prohibited: policy.prohibited,
    stateFile: path.relative(root, file).replaceAll("\\", "/"),
  };
  return { ...base, ...outcomeDecision({ policy, ticket: key, state, declared }) };
}

export function formatJiraTicketAccess(result) {
  if (result.schema === "fhf-harness/capability-status/v1") {
    return formatCapabilityStatus({ ...result, status: result.status === "ready-to-ground" ? "ready" : result.status });
  }
  const capability = result.requiredCapability ?? {};
  const lines = [
    result.status === "ready-to-ground" ? "JIRA ACCESS READY" : "JIRA ACCESS BLOCKED",
    `Ticket: ${result.ticket}`,
    `Reason: ${result.reason}`,
    `Required capability: ${capability.operation ?? "read-selected-ticket"} through ${result.connector} (${result.authentication}).`,
  ];
  for (const step of result.requiredInput?.nextSteps ?? result.requiredInput?.steps ?? []) lines.push(`- ${step}`);
  if (result.requiredInput?.fallback) lines.push(`- Fallback: ${result.requiredInput.fallback}`);
  for (const item of result.prohibited ?? []) lines.push(`- Never: ${item}`);
  return lines.join("\n");
}
