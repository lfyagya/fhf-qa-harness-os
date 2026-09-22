import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  publishEvidenceBundle,
  withFileLock,
  writeBundleAtomic,
} from "./evidence-export-policy.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_CONFIG = path.join(HARNESS_ROOT, "config", "qa-control-plane.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  writeBundleAtomic([{ file, content: `${JSON.stringify(value, null, 2)}\n` }]);
}

function walkFiles(dir, extensions, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(file, extensions, output);
    else if (extensions.some((extension) => entry.name.endsWith(extension))) output.push(file);
  }
  return output;
}

function resolveConfig(configPath = DEFAULT_CONFIG) {
  const file = path.resolve(configPath);
  const config = readJson(file);
  const consumerRoot = path.resolve(
    HARNESS_ROOT,
    process.env.FHF_CONSUMER_ROOT ?? config.paths.consumerRoot,
  );
  const setup = workspaceSetup({ ...config, consumerRoot });
  const moduleSpecsRoot = path.resolve(
    consumerRoot,
    process.env.FHF_MODULE_SPECS_ROOT ?? setup.moduleSpecsRoot ?? consumerRoot,
  );
  const resolved = {
    ...config,
    configFile: file,
    consumerRoot,
    moduleSpecsRoot,
    evidenceDir: path.join(consumerRoot, config.paths.evidenceDir),
  };
  validateConfig(resolved);
  return resolved;
}

function workspaceSetup(config) {
  const configured = process.env.FHF_HARNESS_WORKSPACE_CONFIG;
  const file = path.resolve(config.consumerRoot, configured || config.workspaceContract?.setupFile || ".harness/workspace.local.json");
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = readJson(file);
    return parsed?.optional && typeof parsed.optional === "object"
      ? { ...parsed, ...parsed.optional }
      : parsed;
  } catch {
    return {};
  }
}

function laneRoot(config, lane) {
  const value = config.paths?.lanes?.[lane] ?? {};
  const setup = workspaceSetup(config);
  const configured = value.root
    ?? (value.rootEnv ? process.env[value.rootEnv] : null)
    ?? setup[`${lane}Root`];
  if (!configured) return null;
  return path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.resolve(config.consumerRoot, configured);
}

function validateConfig(config) {
  const requiredArrays = [
    ["workflow.stages", config.workflow?.stages],
    ["workflow.statuses", config.workflow?.statuses],
    ["connectors.atlassianMcp.sources", config.connectors?.atlassianMcp?.sources],
    ["connectors.cypressCloud.queryOrder", config.connectors?.cypressCloud?.queryOrder],
  ];
  for (const [name, value] of requiredArrays) {
    if (!Array.isArray(value) || value.length === 0) throw new Error(`Config ${name} must be a non-empty array.`);
  }
  for (const [name, value] of Object.entries(config.metricThresholds ?? {})) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Config metricThresholds.${name} must be a non-negative number.`);
  }
  for (const stage of config.workflow.approvalRequiredStages ?? []) {
    if (!config.workflow.stages.includes(stage)) throw new Error(`Unknown approval-required stage: ${stage}`);
  }
  const moduleSpecPaths = config.moduleSpecPaths;
  if (!moduleSpecPaths || typeof moduleSpecPaths !== "object" || Array.isArray(moduleSpecPaths)) {
    throw new Error("Config moduleSpecPaths must be a non-empty object.");
  }
  for (const module of Object.keys(config.moduleAliases ?? {})) {
    const targets = moduleSpecPaths[module];
    if (!Array.isArray(targets) || targets.length === 0) {
      throw new Error(`Config moduleSpecPaths.${module} must contain at least one product contract path.`);
    }
    if (targets.some((target) => typeof target !== "string" || !target || path.isAbsolute(target))) {
      throw new Error(`Config moduleSpecPaths.${module} must contain only relative paths.`);
    }
  }
  if (config.moduleSpecPathsBase !== "paths.consumerRoot") {
    throw new Error("Config moduleSpecPathsBase must resolve from paths.consumerRoot.");
  }
}

function valueOf(field) {
  if (field === null || field === undefined) return null;
  if (typeof field === "string" || typeof field === "number") return String(field);
  return field.value ?? field.name ?? field.displayName ?? field.key ?? null;
}

function textOf(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (value.content) return textOf(value.content);
    return Object.values(value).map(textOf).join(" ");
  }
  return "";
}

function sourceIssues(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.issues)) return raw.issues;
  if (Array.isArray(raw.data?.issues)) return raw.data.issues;
  throw new Error("Snapshot must contain an issues array.");
}

const ISSUE_KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;

function firstIssueKey(...candidates) {
  for (const candidate of candidates) {
    const match = String(candidate ?? "").toUpperCase().match(ISSUE_KEY);
    if (match) return match[1];
  }
  return null;
}

function unwrapGraphNode(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (value.data && (value.data.object || value.data.relationships || value.data.data || value.data.graphContexts)) {
    return unwrapGraphNode(value.data);
  }
  return value;
}

function asGraphContextList(graph) {
  if (!graph) return [];
  if (Array.isArray(graph)) return graph;
  const node = unwrapGraphNode(graph) ?? graph;
  if (Array.isArray(node)) return node;
  if (Array.isArray(node.graphContexts)) return node.graphContexts;
  if (Array.isArray(node.contexts)) return node.contexts;
  if (node.object || Array.isArray(node.relationships)) return [node];
  return [];
}

function graphContextIssueKey(context) {
  if (!context || typeof context !== "object") return null;
  return firstIssueKey(
    context.issueKey,
    context.key,
    context.objectIdentifier,
    context.object?.key,
    context.data?.object?.key,
    context.data?.data?.object?.key,
  );
}

function graphParentKey(context) {
  if (!context || typeof context !== "object") return null;
  const named = firstIssueKey(
    context.parentKey,
    context.parent?.key,
    context.object?.parent?.key,
  );
  if (named) return named;
  for (const relation of context.relationships ?? []) {
    if (!/parent|epic|child_of|belongs_to/i.test(relation.relationshipName ?? "")) continue;
    for (const target of relation.targets ?? []) {
      const key = firstIssueKey(target.key, target.issueKey, graphContextIssueKey(target));
      if (key && key !== context.issueKey) return key;
    }
  }
  return null;
}

function graphEvidenceText(context) {
  if (!context) return "";
  const parts = [
    context.object?.summary,
    context.object?.key,
    context.issueKey,
    ...(context.relationships ?? []).flatMap((relation) => [
      relation.relationshipName,
      ...(relation.targets ?? []).flatMap((target) => [
        target.key,
        target.issueKey,
        target.summary,
        target.title,
        target.userName,
        target.name,
      ]),
    ]),
  ];
  return parts.filter(Boolean).join(" ");
}

function normalizeGraphContexts(graph) {
  return asGraphContextList(graph).flatMap((raw) => {
    const context = unwrapGraphNode(raw) ?? raw;
    const issueKey = graphContextIssueKey(raw) ?? graphContextIssueKey(context);
    if (!issueKey) return [];
    return [{
      ...context,
      issueKey,
      relationships: context.relationships ?? raw.relationships ?? [],
      jiraModuleValue: context.jiraModuleValue ?? context.object?.jiraModuleValue ?? raw.jiraModuleValue ?? null,
    }];
  });
}

function snapshotIsComplete(raw) {
  return raw.metadata?.complete === true || raw.isLast === true;
}

function normalizeIssue(issue, config) {
  const fields = issue.fields ?? issue;
  const custom = config.atlassian.fields;
  const moduleValue = valueOf(fields[custom.module] ?? fields.module);
  const serviceApp = valueOf(fields[custom.serviceApp] ?? fields.serviceApp);
  return {
    key: issue.key,
    url: issue.url ?? `${config.atlassian.siteUrl}/browse/${issue.key}`,
    summary: fields.summary ?? "",
    description: textOf(fields.description),
    status: valueOf(fields.status) ?? "Unknown",
    statusCategory: valueOf(fields.status?.statusCategory) ?? "Unknown",
    issueType: valueOf(fields.issuetype ?? fields.issueType) ?? "Unknown",
    priority: valueOf(fields.priority) ?? "Unknown",
    severity: valueOf(fields[custom.severity] ?? fields.severity),
    serviceApp,
    moduleValue,
    labels: (fields.labels ?? []).map(valueOf).filter(Boolean),
    components: (fields.components ?? []).map(valueOf).filter(Boolean),
    assignee: valueOf(fields.assignee),
    parent: fields.parent?.key ?? valueOf(fields.parent),
    updated: fields.updated ?? null,
    graphText: textOf(issue.graph ?? issue.teamworkGraph),
  };
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function moduleMatches(text, config) {
  const normalized = ` ${normalize(text)} `;
  const matches = [];
  for (const [module, aliases] of Object.entries(config.moduleAliases)) {
    const hits = aliases.filter((alias) => normalized.includes(` ${normalize(alias)} `));
    if (hits.length) matches.push({ module, hits });
  }
  return matches.sort((a, b) => b.hits.length - a.hits.length || a.module.localeCompare(b.module));
}

function explicitModule(value, config) {
  const text = normalize(value);
  if (!text) return null;
  const matches = Object.entries(config.jiraModulePrefixes ?? {})
    .filter(([, prefixes]) => prefixes.some((prefix) => text.startsWith(normalize(prefix))))
    .map(([module]) => module);
  return matches.length === 1 ? matches[0] : null;
}

function classifyModule(issue, config) {
  const explicit = explicitModule(issue.moduleValue, config);
  if (explicit) return { modules: [explicit], confidence: "high", reason: `Jira Module: ${issue.moduleValue}` };
  const parentExplicit = explicitModule(issue.parentModuleValue, config);
  if (parentExplicit) {
    return {
      modules: [parentExplicit],
      confidence: "high",
      reason: `Parent ${issue.parent} Jira Module: ${issue.parentModuleValue}`,
    };
  }

  const evidence = [
    issue.summary,
    issue.description,
    issue.components.join(" "),
    issue.labels.join(" "),
    issue.graphText,
    issue.parentText,
  ].join(" ");
  const inferred = moduleMatches(evidence, config);
  if (!inferred.length) return { modules: [], confidence: "review", reason: "No module signal" };
  return {
    modules: inferred.map((match) => match.module),
    confidence: inferred.length === 1 ? "medium" : "review",
    reason: inferred.map((match) => `${match.module}: ${match.hits.join(", ")}`).join("; "),
  };
}

function classifyLanes(issue) {
  const text = normalize([
    issue.summary,
    issue.labels.join(" "),
    issue.components.join(" "),
  ].join(" "));
  const lanes = new Set();
  if (/\b(api|backend|database|db|oracle|endpoint|trigger|cron|ords)\b/.test(text)) lanes.add("backendEvidence");
  if (/\b(smoke|production|prod|availability|auth|sanity)\b/.test(text)) lanes.add("smoke");
  if (/\b(frontend|ui|dashboard|cypress|data cy|filter|sort|modal|tab)\b/.test(text)) lanes.add("e2e");
  if (!lanes.size) lanes.add("review");
  return [...lanes];
}

function deliveryStage(status) {
  const value = normalize(status);
  if (["open", "groomed", "ready for dev"].includes(value)) return "intake";
  if (["in development", "in progress"].includes(value)) return "implementing";
  if (["pr review", "code complete", "code completed"].includes(value)) return "gate-review";
  if (["ready for test", "ready for testing", "in testing", "fix failed"].includes(value)) return "executing";
  if (["done", "fix verified", "complete", "ready for release", "released"].includes(value)) return "completed";
  return "review";
}

function specTargetDetails(modules, config) {
  return modules.flatMap((module) => (config.moduleSpecPaths?.[module] ?? []).map((relativePath) => {
    const file = path.join(config.moduleSpecsRoot ?? config.consumerRoot, relativePath);
    return {
      path: relativePath,
      exists: fs.existsSync(file),
      updatedAt: fs.existsSync(file) ? fs.statSync(file).mtime.toISOString() : null,
    };
  }));
}

function classifyIssues(issues, config) {
  const byKey = new Map(issues.map((issue) => [issue.key, issue]));
  return issues.map((issue) => {
    const parentIssue = byKey.get(issue.parent);
    const enriched = {
      ...issue,
      parentModuleValue: parentIssue?.moduleValue,
      parentText: parentIssue ? `${parentIssue.summary} ${parentIssue.description}` : "",
    };
    const module = classifyModule(enriched, config);
    return {
      ...issue,
      module,
      suggestedLanes: classifyLanes(issue),
      deliveryStage: deliveryStage(issue.status),
      specTargets: module.modules.flatMap((name) => config.moduleSpecPaths?.[name] ?? []),
      specTargetDetails: specTargetDetails(module.modules, config),
    };
  });
}

function publishableIssue(issue) {
  const {
    key,
    url,
    summary,
    status,
    statusCategory,
    issueType,
    priority,
    severity,
    serviceApp,
    moduleValue,
    labels,
    components,
    parent,
    updated,
    module,
    suggestedLanes,
    deliveryStage,
    specTargets,
    specTargetDetails,
  } = issue;
  return {
    key,
    url,
    summary,
    status,
    statusCategory,
    issueType,
    priority,
    severity,
    serviceApp,
    moduleValue,
    labels,
    components,
    parent,
    updated,
    module,
    suggestedLanes,
    deliveryStage,
    specTargets,
    specTargetDetails,
  };
}

function buildSnapshot(raw, config) {
  if (!snapshotIsComplete(raw)) {
    throw new Error("Jira snapshot is paginated. Fetch every page and set metadata.complete=true.");
  }
  const graphContexts = normalizeGraphContexts(raw);
  const confluencePages = raw.confluencePages ?? [];
  const graphByIssue = new Map();
  for (const context of graphContexts) {
    if (!graphByIssue.has(context.issueKey)) graphByIssue.set(context.issueKey, context);
  }
  const issues = sourceIssues(raw).map((issue) => {
    const normalized = normalizeIssue(issue, config);
    const graphContext = graphByIssue.get(issue.key);
    const confluenceText = confluencePages
      .filter((page) => (page.issueKeys ?? []).includes(issue.key) || textOf(page).includes(issue.key))
      .map(textOf)
      .join(" ");
    return {
      ...normalized,
      parent: normalized.parent ?? graphParentKey(graphContext),
      moduleValue: normalized.moduleValue ?? graphContext?.jiraModuleValue ?? null,
      graphText: [normalized.graphText, graphEvidenceText(graphContext), confluenceText].filter(Boolean).join(" "),
    };
  });
  const wrongProject = issues.filter((issue) => !issue.key?.startsWith(`${config.atlassian.projectKey}-`));
  if (wrongProject.length) throw new Error(`Snapshot contains non-${config.atlassian.projectKey} issue keys.`);
  const uniqueKeys = new Set(issues.map((issue) => issue.key));
  if (uniqueKeys.size !== issues.length) throw new Error("Snapshot contains duplicate issue keys.");
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      type: "Atlassian MCP",
      siteUrl: config.atlassian.siteUrl,
      projectKey: config.atlassian.projectKey,
      jql: config.atlassian.currentSprintJql,
      complete: true,
      jiraIssues: issues.length,
      teamworkGraphContexts: graphContexts.length,
      confluencePages: confluencePages.length,
    },
    issues: classifyIssues(issues, config).map(publishableIssue),
  };
}

function workflowFile(config) {
  return path.join(config.evidenceDir, "qa-workflow-state.json");
}

function emptyStages(config) {
  return Object.fromEntries(config.workflow.stages.map((stage) => [
    stage,
    { status: "pending", updatedAt: null, evidence: null, approval: null },
  ]));
}

function repositoryTicketEvidence(config) {
  const index = new Map();
  const roots = Object.entries(config.paths.lanes).map(([lane, value]) => {
    const root = laneRoot(config, lane);
    return root ? { lane, root: path.join(root, value.package ?? "") } : null;
  }).filter(Boolean);
  for (const { lane, root } of roots) {
    for (const file of walkFiles(root, [".js", ".ts", ".json", ".py"])) {
      const relative = path.relative(root, file).replace(/\\/g, "/");
      if (!/cypress\/(configs|support|tests)\/|^tests\/|^api\//.test(relative)) continue;
      const content = fs.readFileSync(file, "utf8");
      for (const match of content.matchAll(/\bSERV-\d+\b/g)) {
        const evidence = index.get(match[0]) ?? { configured: [], implemented: [] };
        const stage = /cypress\/configs\//.test(relative) ? "configured" : "implemented";
        evidence[stage].push(`${lane}:${relative}`);
        index.set(match[0], evidence);
      }
    }
  }
  return index;
}

function inferredWorkflow(issue, config, repositoryEvidence) {
  const stages = emptyStages(config);
  stages.intake = {
    status: "completed",
    updatedAt: issue.updated,
    evidence: issue.url,
    approval: null,
  };
  stages.specProposal = {
    status: "completed",
    updatedAt: issue.updated,
    evidence: "spec-delta-proposals.md",
    approval: null,
  };
  const evidence = repositoryEvidence.get(issue.key);
  for (const stage of ["configured", "implemented"]) {
    if (evidence?.[stage]?.length) {
      stages[stage] = {
        status: "completed",
        updatedAt: new Date().toISOString(),
        evidence: evidence[stage].slice(0, 10).join(", "),
        approval: null,
      };
    }
  }
  return { key: issue.key, summary: issue.summary, jiraStatus: issue.status,
    jiraDerivedStage: config.workflow.jiraStatusStageMap?.[issue.status] ?? "intake", stages };
}

function syncWorkflowUnlocked(snapshot, config, persist = true) {
  const file = workflowFile(config);
  const previous = fs.existsSync(file) ? readJson(file) : { tickets: {} };
  const repositoryEvidence = repositoryTicketEvidence(config);
  const tickets = {};
  for (const issue of snapshot?.issues ?? []) {
    const inferred = inferredWorkflow(issue, config, repositoryEvidence);
    const existing = previous.tickets?.[issue.key];
    const retainedStages = Object.fromEntries(Object.entries(existing?.stages ?? {}).filter(([, stage]) =>
      (stage.updatedAt || stage.evidence) && !String(stage.evidence).startsWith("Jira status:")
    ));
    tickets[issue.key] = {
      ...inferred,
      ...existing,
      summary: issue.summary,
      jiraStatus: issue.status,
      stages: { ...inferred.stages, ...retainedStages },
    };
  }
  const state = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    stages: config.workflow.stages,
    consumedApprovals: previous.consumedApprovals ?? {},
    tickets,
  };
  if (persist) writeJson(file, state);
  return state;
}

function syncWorkflow(snapshot, config) {
  const file = workflowFile(config);
  return withFileLock(file, () => syncWorkflowUnlocked(snapshot, config));
}

function updateWorkflowUnlocked(args, config, persist = true) {
  const file = workflowFile(config);
  if (!fs.existsSync(file)) throw new Error("Run snapshot or refresh before updating workflow state.");
  const state = readJson(file);
  const ticket = state.tickets?.[args.ticket];
  if (!ticket) throw new Error(`Unknown workflow ticket: ${args.ticket}`);
  if (!config.workflow.stages.includes(args.stage)) throw new Error(`Unknown workflow stage: ${args.stage}`);
  if (!config.workflow.statuses.includes(args.status)) throw new Error(`Unknown workflow status: ${args.status}`);
  const payloadHash = args.payloadHash ?? args["payload-hash"];
  const approvalRequired =
    config.workflow.approvalRequiredStages.includes(args.stage) && args.status === "completed";
  if (approvalRequired && (!args.approval || !args.target || !payloadHash)) {
    throw new Error(
      `Stage ${args.stage} requires --approval, --target, and --payload-hash bound to the approved write.`
    );
  }
  if (approvalRequired && !/^sha256:[a-f0-9]{64}$/i.test(payloadHash)) {
    throw new Error("--payload-hash must be sha256:<64 hexadecimal characters>.");
  }
  state.consumedApprovals ??= {};
  if (approvalRequired && state.consumedApprovals[args.approval]) {
    throw new Error(`Approval reference was already consumed: ${args.approval}`);
  }
  const stageIndex = config.workflow.stages.indexOf(args.stage);
  if (args.status === "completed" && stageIndex > 0) {
    const priorStage = config.workflow.stages[stageIndex - 1];
    const priorStatus = ticket.stages[priorStage]?.status;
    if (!["completed", "skipped"].includes(priorStatus)) {
      throw new Error(`Complete or skip ${priorStage} before completing ${args.stage}.`);
    }
  }
  ticket.stages[args.stage] = {
    status: args.status,
    updatedAt: new Date().toISOString(),
    evidence: args.evidence ?? null,
    approval: args.approval ?? null,
  };
  if (approvalRequired) {
    state.consumedApprovals[args.approval] = {
      ticket: args.ticket,
      stage: args.stage,
      target: args.target,
      payloadHash,
      consumedAt: new Date().toISOString(),
    };
  }
  state.generatedAt = new Date().toISOString();
  if (persist) writeJson(file, state);
  return state;
}

function updateWorkflow(args, config) {
  const file = workflowFile(config);
  return withFileLock(file, () => updateWorkflowUnlocked(args, config));
}

function groupCounts(values) {
  return values.reduce((counts, value) => {
    const key = value || "Unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function coverageSummary(coverage) {
  if (!coverage) return { status: "unknown", lanes: {} };
  const lanes = {};
  for (const [lane, laneData] of Object.entries(coverage.lanes ?? {})) {
    const moduleEntries = Object.entries(laneData.modules ?? {});
    const modules = moduleEntries.map(([, module]) => module);
    lanes[lane] = {
      modules: modules.length,
      full: modules.filter((module) => module.state === "FULL").length,
      partial: modules.filter((module) => module.state === "PARTIAL").length,
      none: modules.filter((module) => module.state === "NONE").length,
      rubric: laneData.rubric ?? [],
      moduleStates: Object.fromEntries(moduleEntries.map(([name, module]) => [
        name,
        {
          state: module.state,
          missing: (laneData.rubric ?? []).filter((layer) => !module[layer]),
          tests: module.its ?? module.testCount ?? 0,
          jiraMapped: module.jiraMapped ?? module.testrailCount ?? 0,
        },
      ])),
    };
  }
  return { status: "available", generatedAt: coverage.generatedAt, lanes };
}

function parseExecutionHistory(file) {
  if (!fs.existsSync(file)) return [];
  const rows = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.startsWith("| "));
  const data = rows.slice(2).map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  return data.map(([date, module, lane, run, passed, failed, flaky, categories, notes]) => ({
    date, module, lane, run, passed: Number(passed), failed: Number(failed), flaky: Number(flaky),
    categories, notes, source: "execution-history",
  }));
}

function junitRun(file, lane, testRailRunFile) {
  if (!fs.existsSync(file)) return null;
  const xml = fs.readFileSync(file, "utf8");
  const suites = [...xml.matchAll(/<testsuite\b[^>]*>/g)].map((match) => match[0]);
  const number = (name) => suites.reduce(
    (total, suite) => total + Number(suite.match(new RegExp(`${name}="([^"]+)"`))?.[1] ?? 0),
    0,
  );
  const tests = number("tests");
  const failed = number("failures") + number("errors");
  const skipped = number("skipped");
  const testRailRunId = testRailRunFile && fs.existsSync(testRailRunFile)
    ? fs.readFileSync(testRailRunFile, "utf8").trim()
    : null;
  return {
    date: fs.statSync(file).mtime.toISOString(),
    module: "all",
    lane,
    run: path.basename(file),
    passed: Math.max(0, tests - failed - skipped),
    failed,
    flaky: 0,
    skipped,
    categories: "",
    notes: "",
    source: path.relative(HARNESS_ROOT, file).replace(/\\/g, "/"),
    testRailRunId: testRailRunId || null,
  };
}

function discoverExecution(config) {
  const configured = parseExecutionHistory(path.join(config.consumerRoot, config.paths.executionHistory));
  const lanePath = (lane) => {
    const value = config.paths.lanes[lane];
    const root = laneRoot(config, lane);
    return root ? path.join(root, value.package ?? "") : null;
  };
  const discovered = [
    ...["e2e", "smoke"].flatMap((lane) => {
      const root = lanePath(lane);
      return root ? [junitRun(path.join(root, "reports", "junit", "merged.xml"), lane)] : [];
    }),
  ];
  const backend = config.paths.automationLanes?.backend;
  if (backend && fs.existsSync(path.join(config.consumerRoot, backend.root))) {
    discovered.push(junitRun(
      path.join(config.consumerRoot, backend.root, backend.execution.junit),
      "backendEvidence",
      path.join(config.consumerRoot, backend.root, backend.execution.testRailRun),
    ));
  }
  const available = discovered.filter(Boolean);
  const runs = [...configured, ...available].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { status: runs.length ? "available" : "unknown", generatedAt: runs[0]?.date, runs };
}

function parseChainRisk(file) {
  if (!fs.existsSync(file)) return { status: "unknown", counts: {} };
  const text = fs.readFileSync(file, "utf8");
  const matches = [...text.matchAll(/^\|\s*(?:🟢|🟡|🔵|🔴)\s*(?:\*\*)?([^|*]+?)(?:\*\*)?\s*\|\s*(\d+)\s*\|/gm)];
  return {
    status: matches.length ? "available" : "unknown",
    generatedAt: fs.statSync(file).mtime.toISOString(),
    counts: Object.fromEntries(matches.map((match) => [match[1].trim(), Number(match[2])])),
  };
}

function freshness(timestamp, maxDays) {
  if (!timestamp) return "unknown";
  const ageDays = (Date.now() - new Date(timestamp).getTime()) / 86_400_000;
  return ageDays <= maxDays ? "fresh" : "stale";
}

function percent(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 10_000) / 100 : null;
}

function metricChecks(snapshot, coverage, execution, config) {
  const issues = snapshot?.issues ?? [];
  const unmapped = issues.filter((issue) => issue.module.modules.length === 0).length;
  const review = issues.filter((issue) => issue.module.confidence === "review").length;
  const cypressModules = ["e2e", "smoke"].flatMap((lane) =>
    Object.values(coverage?.lanes?.[lane]?.modules ?? {}));
  const scenarios = cypressModules.reduce((sum, module) => sum + (module.scenarios ?? 0), 0);
  const jiraMapped = cypressModules.reduce((sum, module) => sum + (module.jiraMapped ?? 0), 0);
  const checks = [
    {
      metric: "Unmapped sprint tickets",
      value: percent(unmapped, issues.length),
      unit: "%",
      target: `<= ${config.metricThresholds.maxUnmappedSprintPercent}%`,
      pass: issues.length ? percent(unmapped, issues.length) <= config.metricThresholds.maxUnmappedSprintPercent : null,
    },
    {
      metric: "Module review queue",
      value: percent(review, issues.length),
      unit: "%",
      target: `<= ${config.metricThresholds.maxReviewQueuePercent}%`,
      pass: issues.length ? percent(review, issues.length) <= config.metricThresholds.maxReviewQueuePercent : null,
    },
    {
      metric: "Scenario Jira traceability",
      value: percent(jiraMapped, scenarios),
      unit: "%",
      target: `>= ${config.metricThresholds.jiraTraceabilityPercent}%`,
      pass: scenarios ? percent(jiraMapped, scenarios) >= config.metricThresholds.jiraTraceabilityPercent : null,
    },
    {
      metric: "Cypress UI Coverage",
      value: null,
      unit: "%",
      target: `>= ${config.metricThresholds.uiCoveragePercent}%`,
      pass: null,
    },
    {
      metric: "Execution freshness",
      value: execution.generatedAt
        ? Math.round((Date.now() - new Date(execution.generatedAt).getTime()) / 86_400_000)
        : null,
      unit: "days",
      target: `<= ${config.metricThresholds.maxExecutionAgeDays} days`,
      pass: execution.generatedAt
        ? (Date.now() - new Date(execution.generatedAt).getTime()) / 86_400_000 <= config.metricThresholds.maxExecutionAgeDays
        : null,
    },
  ];
  return checks;
}

function prioritizedActions(issues, coverage, config) {
  const weights = config.prioritization;
  return issues.map((issue) => {
    let score = weights.severityWeights[issue.severity ?? "Unknown"] ?? weights.severityWeights.Unknown;
    if (issue.issueType.toLowerCase() === "bug") score += weights.bugWeight;
    if (!issue.module.modules.length) score += weights.unmappedWeight;
    if (issue.module.confidence === "review") score += weights.reviewWeight;
    const laneStates = issue.suggestedLanes
      .filter((lane) => ["e2e", "smoke", "backendEvidence"].includes(lane))
      .flatMap((lane) => issue.module.modules.map((module) => coverage?.lanes?.[lane]?.modules?.[module]?.state))
      .filter(Boolean);
    if (laneStates.includes("NONE")) score += weights.noCoverageWeight;
    else if (laneStates.includes("PARTIAL")) score += weights.partialCoverageWeight;
    const action = !issue.module.modules.length
      ? "Resolve parent/Teamwork Graph context and assign a module"
      : issue.module.confidence === "review"
        ? "Review cross-module mapping and approve spec targets"
        : laneStates.includes("NONE")
          ? "Create the missing lane architecture from config through tests"
          : laneStates.includes("PARTIAL")
            ? "Complete the missing coverage layers"
            : "Validate acceptance criteria against existing coverage";
    return {
      key: issue.key,
      summary: issue.summary,
      score,
      action,
      modules: issue.module.modules,
      lanes: issue.suggestedLanes,
    };
  }).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

function workflowSummary(workflow, config) {
  const tickets = Object.values(workflow?.tickets ?? {});
  return {
    totalTickets: tickets.length,
    byStage: Object.fromEntries(config.workflow.stages.map((stage) => [
      stage,
      groupCounts(tickets.map((ticket) => ticket.stages?.[stage]?.status ?? "pending")),
    ])),
    tickets,
  };
}

function buildCommandCenter(snapshot, coverage, workflow, config) {
  const issues = snapshot?.issues ?? [];
  const bugs = issues.filter((issue) => issue.issueType.toLowerCase() === "bug");
  const unmapped = issues.filter((issue) => issue.module.modules.length === 0);
  const review = issues.filter((issue) => issue.module.confidence === "review");
  const modules = issues.flatMap((issue) => issue.module.modules);
  const confirmedModules = issues
    .filter((issue) => issue.module.confidence !== "review" && issue.module.modules.length === 1)
    .flatMap((issue) => issue.module.modules);
  const execution = discoverExecution(config);
  const chainRisk = parseChainRisk(path.join(config.consumerRoot, config.paths.chainRisk));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sources: {
      sprint: {
        status: snapshot ? "available" : "unknown",
        generatedAt: snapshot?.generatedAt,
        freshness: freshness(snapshot?.generatedAt, config.freshnessDays.sprintSnapshot),
      },
      coverage: {
        status: coverage ? "available" : "unknown",
        generatedAt: coverage?.generatedAt,
        freshness: freshness(coverage?.generatedAt, config.freshnessDays.coverage),
      },
      execution: {
        status: execution.status,
        generatedAt: execution.generatedAt,
        freshness: freshness(execution.generatedAt, config.freshnessDays.execution),
      },
      chainRisk: {
        status: chainRisk.status,
        generatedAt: chainRisk.generatedAt,
        freshness: freshness(chainRisk.generatedAt, config.freshnessDays.coverage),
      },
    },
    connectors: {
      jira: { status: snapshot ? "available" : "unknown", items: snapshot?.source?.jiraIssues ?? 0 },
      teamworkGraph: {
        status: snapshot?.source?.teamworkGraphContexts ? "available" : "unknown",
        items: snapshot?.source?.teamworkGraphContexts ?? 0,
      },
      confluence: {
        status: snapshot?.source?.confluencePages ? "available" : "unknown",
        items: snapshot?.source?.confluencePages ?? 0,
      },
      cypressCloud: {
        status: "unknown",
        providers: config.connectors.cypressCloud.queryOrder,
        fallback: config.connectors.cypressCloud.fallback,
      },
      testRail: {
        status: execution.runs.some((run) => run.testRailRunId) ? "available" : "unknown",
        fallback: config.connectors.testRail.fallback,
      },
    },
    sprint: {
      total: issues.length,
      bugs: bugs.length,
      unmapped: unmapped.length,
      reviewRequired: review.length,
      byStatus: groupCounts(issues.map((issue) => issue.status)),
      byType: groupCounts(issues.map((issue) => issue.issueType)),
      byModule: groupCounts(modules),
      byConfirmedModule: groupCounts(confirmedModules),
      bySeverity: groupCounts(bugs.map((issue) => issue.severity)),
      byDeliveryStage: groupCounts(issues.map((issue) => issue.deliveryStage)),
    },
    approvals: {
      specProposals: issues.length,
      jiraWrites: [],
      confluenceWrites: [],
      policy: "Every external or application-spec write requires explicit single-use approval.",
    },
    coverage: coverageSummary(coverage),
    execution,
    chainRisk,
    workflow: workflowSummary(workflow, config),
    metricChecks: metricChecks(snapshot, coverage, execution, config),
    prioritizedActions: prioritizedActions(issues, coverage, config).slice(0, 25),
    queues: {
      moduleReview: review.map(({ key, summary, module, suggestedLanes }) => ({
        key, summary, reason: module.reason, suggestedLanes,
      })),
      unmapped: unmapped.map(({ key, summary, suggestedLanes }) => ({ key, summary, suggestedLanes })),
    },
  };
}

function markdownTable(headers, rows) {
  if (!rows.length) return "_No entries._";
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function renderProposals(snapshot) {
  const rows = snapshot.issues.map((issue) => [
    `[${issue.key}](${issue.url})`,
    issue.summary.replace(/\|/g, "\\|"),
    issue.module.modules.join(", ") || "Unmapped",
    issue.module.confidence,
    issue.suggestedLanes.join(", "),
    issue.specTargetDetails.map((target) =>
      `${target.path} (${target.exists ? `exists, updated ${target.updatedAt}` : "missing"})`
    ).join("<br>") || "Review required",
    issue.module.reason.replace(/\|/g, "\\|"),
  ]);
  return [
    "# Current Sprint — Application Spec Delta Proposals",
    "",
    `> Generated ${snapshot.generatedAt} from ${snapshot.source.jql}.`,
    "> Proposal only. Jira, Confluence, and application-spec writes require explicit approval.",
    "",
    markdownTable(["Ticket", "Summary", "Module", "Confidence", "Suggested lane", "Spec targets", "Evidence"], rows),
    "",
  ].join("\n");
}

function objectRows(object) {
  return Object.entries(object ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function renderMarkdown(data) {
  const sourceRows = Object.entries(data.sources).map(([name, source]) => [
    name, source.status, source.generatedAt ?? "unknown", source.freshness ?? "unknown",
  ]);
  const connectorRows = Object.entries(data.connectors).map(([name, connector]) => [
    name, connector.status, connector.items ?? "unknown", connector.fallback ?? "—",
  ]);
  const coverageRows = Object.entries(data.coverage.lanes ?? {}).map(([lane, value]) => [
    lane, value.modules, value.full, value.partial, value.none,
  ]);
  const coverageDetailRows = Object.entries(data.coverage.lanes ?? {}).flatMap(([lane, value]) =>
    Object.entries(value.moduleStates ?? {}).map(([module, state]) => [
      lane, module, state.state, state.missing.join(", ") || "—", state.tests, state.jiraMapped,
    ])
  );
  const reviewRows = data.queues.moduleReview.map((item) => [
    item.key, item.summary.replace(/\|/g, "\\|"), item.reason.replace(/\|/g, "\\|"),
  ]);
  const executionRows = data.execution.runs.slice(0, 20).map((run) => [
    run.date, run.lane, run.module, run.passed, run.failed, run.flaky, run.testRailRunId ?? "unknown", run.source,
  ]);
  const metricRows = data.metricChecks.map((check) => [
    check.metric,
    check.value ?? "unknown",
    check.unit,
    check.target,
    check.pass === null ? "UNKNOWN" : check.pass ? "PASS" : "FAIL",
  ]);
  const workflowRows = Object.entries(data.workflow.byStage).map(([stage, counts]) => [
    stage,
    counts.pending ?? 0,
    counts.in_progress ?? 0,
    counts.completed ?? 0,
    counts.blocked ?? 0,
    counts.skipped ?? 0,
  ]);
  const actionRows = data.prioritizedActions.map((action) => [
    action.key,
    action.score,
    action.summary.replace(/\|/g, "\\|"),
    action.modules.join(", ") || "Unmapped",
    action.lanes.join(", "),
    action.action,
  ]);
  return [
    "# FHF QA Command Center",
    "",
    `> Generated ${data.generatedAt}. Metrics show unknown rather than treating unavailable data as zero.`,
    "",
    "## Source health",
    "",
    markdownTable(["Source", "Status", "Generated", "Freshness"], sourceRows),
    "",
    "## Connector health",
    "",
    markdownTable(["Connector", "Status", "Items", "Fallback"], connectorRows),
    "",
    "## Current sprint",
    "",
    `- Tickets: ${data.sprint.total}`,
    `- Bugs: ${data.sprint.bugs}`,
    `- Module review required: ${data.sprint.reviewRequired}`,
    `- Unmapped: ${data.sprint.unmapped}`,
    "",
    "### Status",
    "",
    markdownTable(["Status", "Count"], objectRows(data.sprint.byStatus)),
    "",
    "### Bug severity",
    "",
    markdownTable(["Severity", "Bugs"], objectRows(data.sprint.bySeverity)),
    "",
    "### Confirmed module assignments",
    "",
    markdownTable(["Module", "Tickets"], objectRows(data.sprint.byConfirmedModule)),
    "",
    "### Candidate module mentions (includes review queue)",
    "",
    markdownTable(["Module", "Tickets"], objectRows(data.sprint.byModule)),
    "",
    "### Delivery stage",
    "",
    markdownTable(["Stage", "Tickets"], objectRows(data.sprint.byDeliveryStage)),
    "",
    "## Structural coverage",
    "",
    data.coverage.status === "available"
      ? markdownTable(["Lane", "Modules", "Full", "Partial", "None"], coverageRows)
      : "_Coverage source unavailable._",
    "",
    data.coverage.status === "available"
      ? markdownTable(["Lane", "Module", "State", "Missing layers", "Tests", "Mapped IDs"], coverageDetailRows)
      : "",
    "",
    "## Full-chain risk",
    "",
    data.chainRisk.status === "available"
      ? markdownTable(["Status", "Modules"], objectRows(data.chainRisk.counts))
      : "_Chain-risk source unavailable._",
    "",
    "## Latest execution evidence",
    "",
    data.execution.status === "available"
      ? markdownTable(["Date", "Lane", "Module", "Passed", "Failed", "Flaky", "TestRail run", "Source"], executionRows)
      : "_Execution source unavailable._",
    "",
    "## Metric gates",
    "",
    markdownTable(["Metric", "Value", "Unit", "Target", "Result"], metricRows),
    "",
    "## Workflow state",
    "",
    markdownTable(["Stage", "Pending", "In progress", "Completed", "Blocked", "Skipped"], workflowRows),
    "",
    "## Prioritized next actions",
    "",
    markdownTable(["Ticket", "Score", "Summary", "Modules", "Lanes", "Next action"], actionRows),
    "",
    "## Module review queue",
    "",
    markdownTable(["Ticket", "Summary", "Reason"], reviewRows),
    "",
    "## Approval queue",
    "",
    `- Spec proposals: ${data.approvals.specProposals}`,
    `- Jira writes: ${data.approvals.jiraWrites.length}`,
    `- Confluence writes: ${data.approvals.confluenceWrites.length}`,
    `- Policy: ${data.approvals.policy}`,
    "",
  ].join("\n");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function htmlRows(entries) {
  if (!entries.length) return "<tr><td colspan=\"2\">No entries</td></tr>";
  return entries.map(([label, count]) =>
    `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(count)}</td></tr>`).join("");
}

function renderHtml(data) {
  const laneCards = Object.entries(data.coverage.lanes ?? {}).map(([lane, value]) =>
    `<section><h3>${escapeHtml(lane.toUpperCase())}</h3><p>${value.full} full · ${value.partial} partial · ${value.none} none</p></section>`
  ).join("");
  const connectorRows = Object.entries(data.connectors).map(([name, connector]) =>
    `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(connector.status)}</td><td>${escapeHtml(connector.items ?? "unknown")}</td><td>${escapeHtml(connector.fallback ?? "—")}</td></tr>`
  ).join("");
  const coverageRows = Object.entries(data.coverage.lanes ?? {}).flatMap(([lane, value]) =>
    Object.entries(value.moduleStates ?? {}).map(([module, state]) =>
      `<tr><td>${escapeHtml(lane)}</td><td>${escapeHtml(module)}</td><td>${escapeHtml(state.state)}</td><td>${escapeHtml(state.missing.join(", ") || "—")}</td><td>${state.tests}</td><td>${state.jiraMapped}</td></tr>`
    )
  ).join("") || "<tr><td colspan=\"6\">Coverage source unavailable</td></tr>";
  const reviewRows = data.queues.moduleReview.slice(0, 25).map((item) =>
    `<tr><td>${escapeHtml(item.key)}</td><td>${escapeHtml(item.summary)}</td><td>${escapeHtml(item.reason)}</td></tr>`
  ).join("") || "<tr><td colspan=\"3\">No module review items</td></tr>";
  const executionRows = data.execution.runs.slice(0, 10).map((run) =>
    `<tr><td>${escapeHtml(run.date)}</td><td>${escapeHtml(run.lane)}</td><td>${run.passed}</td><td>${run.failed}</td><td>${run.flaky}</td><td>${escapeHtml(run.testRailRunId ?? "unknown")}</td></tr>`
  ).join("") || "<tr><td colspan=\"6\">Execution source unavailable</td></tr>";
  const metricRows = data.metricChecks.map((check) =>
    `<tr><td>${escapeHtml(check.metric)}</td><td>${escapeHtml(check.value ?? "unknown")} ${escapeHtml(check.unit)}</td><td>${escapeHtml(check.target)}</td><td>${check.pass === null ? "UNKNOWN" : check.pass ? "PASS" : "FAIL"}</td></tr>`
  ).join("");
  const workflowRows = Object.entries(data.workflow.byStage).map(([stage, counts]) =>
    `<tr><td>${escapeHtml(stage)}</td><td>${counts.pending ?? 0}</td><td>${counts.in_progress ?? 0}</td><td>${counts.completed ?? 0}</td><td>${counts.blocked ?? 0}</td></tr>`
  ).join("");
  const actionRows = data.prioritizedActions.map((action) =>
    `<tr><td>${escapeHtml(action.key)}</td><td>${action.score}</td><td>${escapeHtml(action.summary)}</td><td>${escapeHtml(action.action)}</td></tr>`
  ).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FHF QA Command Center</title>
<style>
:root{color-scheme:light dark;font-family:Inter,Segoe UI,sans-serif}body{margin:0;background:#101214;color:#e8eaed}
main{max-width:1200px;margin:auto;padding:28px}h1{margin:0}small{color:#9aa0a6}.metrics,.lanes{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:24px 0}
section{background:#1b1e22;border:1px solid #30343a;border-radius:8px;padding:16px}.metric strong{display:block;font-size:28px;margin-top:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px}table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:8px;border-bottom:1px solid #30343a;vertical-align:top}th{color:#9aa0a6}a{color:#8ab4f8}
@media(prefers-color-scheme:light){body{background:#f6f7f8;color:#202124}section{background:#fff;border-color:#dadce0}th,td{border-color:#dadce0}}
</style></head><body><main>
<h1>FHF QA Command Center</h1><small>Generated ${escapeHtml(data.generatedAt)} · unavailable sources remain unknown</small>
<div class="metrics">
<section class="metric"><span>Sprint tickets</span><strong>${data.sprint.total}</strong></section>
<section class="metric"><span>Bugs</span><strong>${data.sprint.bugs}</strong></section>
<section class="metric"><span>Needs module review</span><strong>${data.sprint.reviewRequired}</strong></section>
<section class="metric"><span>Unmapped</span><strong>${data.sprint.unmapped}</strong></section>
</div>
<h2>Coverage by lane</h2><div class="lanes">${laneCards || "<section>Coverage source unavailable</section>"}</div>
<section><h2>Connector health</h2><table><thead><tr><th>Connector</th><th>Status</th><th>Items</th><th>Fallback</th></tr></thead><tbody>${connectorRows}</tbody></table></section>
<div class="grid">
<section><h2>Sprint status</h2><table><tbody>${htmlRows(objectRows(data.sprint.byStatus))}</tbody></table></section>
<section><h2>Bug severity</h2><table><tbody>${htmlRows(objectRows(data.sprint.bySeverity))}</tbody></table></section>
<section><h2>Confirmed module assignments</h2><table><tbody>${htmlRows(objectRows(data.sprint.byConfirmedModule))}</tbody></table></section>
<section><h2>Candidate module mentions</h2><table><tbody>${htmlRows(objectRows(data.sprint.byModule))}</tbody></table></section>
<section><h2>Delivery stage</h2><table><tbody>${htmlRows(objectRows(data.sprint.byDeliveryStage))}</tbody></table></section>
<section><h2>Full-chain risk</h2><table><tbody>${htmlRows(objectRows(data.chainRisk.counts))}</tbody></table></section>
</div>
<section><h2>Config → implementation → coverage detail</h2><table><thead><tr><th>Lane</th><th>Module</th><th>State</th><th>Missing layers</th><th>Tests</th><th>Mapped IDs</th></tr></thead><tbody>${coverageRows}</tbody></table></section>
<section><h2>Latest execution evidence</h2><table><thead><tr><th>Date</th><th>Lane</th><th>Passed</th><th>Failed</th><th>Flaky</th><th>TestRail run</th></tr></thead><tbody>${executionRows}</tbody></table></section>
<section><h2>Metric gates</h2><table><thead><tr><th>Metric</th><th>Value</th><th>Target</th><th>Result</th></tr></thead><tbody>${metricRows}</tbody></table></section>
<section><h2>Workflow state</h2><table><thead><tr><th>Stage</th><th>Pending</th><th>In progress</th><th>Completed</th><th>Blocked</th></tr></thead><tbody>${workflowRows}</tbody></table></section>
<section><h2>Prioritized next actions</h2><table><thead><tr><th>Ticket</th><th>Score</th><th>Summary</th><th>Next action</th></tr></thead><tbody>${actionRows}</tbody></table></section>
<section><h2>Module review queue</h2><table><thead><tr><th>Ticket</th><th>Summary</th><th>Evidence</th></tr></thead><tbody>${reviewRows}</tbody></table></section>
<section><h2>Approval boundary</h2><p>${escapeHtml(data.approvals.policy)}</p></section>
</main></body></html>`;
}

const RUNTIME_EVIDENCE_FILES = [
  "current-sprint.json",
  "spec-delta-proposals.md",
  "qa-workflow-state.json",
  "qa-command-center.json",
  "qa-command-center.md",
  "qa-command-center.html",
  "teamwork-graph-enrichment.json",
  "confluence-enrichment.json",
];

function snapshotCommand(input, config, enrichments = {}) {
  const pages = input.split(",").map((file) => readJson(path.resolve(file.trim())));
  const graph = enrichments.graph ? readJson(path.resolve(enrichments.graph)) : null;
  const confluence = enrichments.confluence ? readJson(path.resolve(enrichments.confluence)) : null;
  const raw = pages.length === 1
    ? { ...pages[0] }
    : {
        metadata: { complete: pages.at(-1).isLast === true },
        issues: pages.flatMap(sourceIssues),
      };
  raw.graphContexts = normalizeGraphContexts(graph ?? raw);
  raw.confluencePages = confluence?.confluencePages ?? confluence?.pages ??
    (Array.isArray(confluence) ? confluence : raw.confluencePages ?? []);
  const snapshot = buildSnapshot(raw, config);
  return {
    snapshot,
    files: [
      {
        file: path.join(config.evidenceDir, "current-sprint.json"),
        content: `${JSON.stringify(snapshot, null, 2)}\n`,
      },
      {
        file: path.join(config.evidenceDir, "spec-delta-proposals.md"),
        content: renderProposals(snapshot),
      },
    ],
  };
}

function contractCommand(config) {
  return {
    metadata: { complete: true, source: "Atlassian MCP", jql: config.atlassian.currentSprintJql },
    issues: [{
      key: "SERV-12345",
      fields: {
        summary: "Required",
        description: "Markdown or ADF",
        status: { name: "Required", statusCategory: { name: "Required" } },
        issuetype: { name: "Required" },
        updated: "ISO-8601",
        customfield_10043: { value: "Callcenter" },
        customfield_10047: null,
        customfield_10142: null
      }
    }],
    graphContexts: [{ issueKey: "SERV-12345", relationships: [] }],
    confluencePages: [{ id: "page-id", title: "Relevant specification", issueKeys: ["SERV-12345"], body: "" }]
  };
}

function commandCenterArtifacts(config, snapshotOverride, workflowOverride) {
  const snapshotFile = path.join(config.evidenceDir, "current-sprint.json");
  const coverageFile = path.join(config.evidenceDir, "coverage-computed.json");
  const snapshot = snapshotOverride ?? (fs.existsSync(snapshotFile) ? readJson(snapshotFile) : null);
  const coverage = fs.existsSync(coverageFile) ? readJson(coverageFile) : null;
  const workflow = workflowOverride ??
    (snapshot ? syncWorkflowUnlocked(snapshot, config, false) : null);
  const data = buildCommandCenter(snapshot, coverage, workflow, config);
  const files = [
    {
      file: path.join(config.evidenceDir, "qa-command-center.json"),
      content: `${JSON.stringify(data, null, 2)}\n`,
    },
    {
      file: path.join(config.evidenceDir, "qa-command-center.md"),
      content: renderMarkdown(data),
    },
    {
      file: path.join(config.evidenceDir, "qa-command-center.html"),
      content: renderHtml(data),
    },
  ];
  if (workflow) {
    files.unshift({
      file: workflowFile(config),
      content: `${JSON.stringify(workflow, null, 2)}\n`,
    });
  }
  return { data, files };
}

function selfTest() {
  const config = resolveConfig();
  const raw = {
    metadata: { complete: true },
    issues: [
      {
        key: "SERV-1",
        fields: {
          summary: "Ancillary verification dashboard filter",
          status: { name: "Open", statusCategory: { name: "To Do" } },
          issuetype: { name: "Bug" },
          priority: { name: "High" },
          customfield_10043: { value: "Callcenter" },
          customfield_10142: null,
          labels: ["QA"],
          components: [],
          updated: "2026-07-24T00:00:00Z",
        },
      },
    ],
  };
  const snapshot = buildSnapshot(raw, config);
  assert.equal(snapshot.issues.length, 1);
  assert.deepEqual(snapshot.issues[0].module.modules, ["ancillary"]);
  assert.equal(snapshot.issues[0].module.confidence, "medium");
  assert.equal("description" in snapshot.issues[0], false);
  assert.throws(() => buildSnapshot({ issues: raw.issues }, config));
  assert.throws(() => buildSnapshot({ ...raw, metadata: {}, isLast: false, nextPageToken: "x" }, config));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fhf-qa-command-center-"));
  const tempConfig = {
    ...config,
    consumerRoot: tempRoot,
  };
  try {
    tempConfig.evidenceDir = path.join(tempConfig.consumerRoot, "docs", "evidence");
    const workflow = syncWorkflow(snapshot, tempConfig);
    const commandCenter = buildCommandCenter(snapshot, null, workflow, tempConfig);
    assert.equal(commandCenter.sprint.total, 1);
    assert.equal(commandCenter.coverage.status, "unknown");
    assert.equal(commandCenter.workflow.totalTickets, 1);
    assert.equal(commandCenter.metricChecks.length, 5);
    assert.equal(commandCenter.prioritizedActions[0].key, "SERV-1");
    assert.throws(() => updateWorkflow({
      ticket: "SERV-1", stage: "approved", status: "completed",
    }, tempConfig));
    const approved = updateWorkflow({
      ticket: "SERV-1",
      stage: "approved",
      status: "completed",
      evidence: "Owner reviewed proposal",
      approval: "conversation-approval",
      target: "SERV-1",
      payloadHash: `sha256:${"0".repeat(64)}`,
    }, tempConfig);
    assert.equal(approved.tickets["SERV-1"].stages.approved.status, "completed");
    assert.throws(() => updateWorkflow({
      ticket: "SERV-1",
      stage: "approved",
      status: "completed",
      approval: "conversation-approval",
      target: "SERV-1",
      payloadHash: `sha256:${"0".repeat(64)}`,
    }, tempConfig));
    assert.match(renderMarkdown(commandCenter), /FHF QA Command Center/);
    assert.match(renderHtml(commandCenter), /<!doctype html>/);
    console.log("qa-command-center self-test passed");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function argsOf(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith("--")) values[argv[index].slice(2)] = argv[index + 1];
  }
  return values;
}

function main() {
  const [command = "build", ...argv] = process.argv.slice(2);
  if (command === "self-test") return selfTest();
  const args = argsOf(argv);
  const config = resolveConfig(args.config);
  const publish = (files) => {
    if (!config.approval.evidenceExport) return writeBundleAtomic(files);
    return publishEvidenceBundle({
      consent: args.consent,
      command,
      harnessRoot: HARNESS_ROOT,
      consumerRoot: config.consumerRoot,
      evidenceDir: config.evidenceDir,
      runtimeFiles: RUNTIME_EVIDENCE_FILES,
    }, files);
  };
  if (command === "contract") {
    console.log(JSON.stringify(contractCommand(config), null, 2));
    return;
  }
  if (command === "workflow") {
    for (const required of ["ticket", "stage", "status"]) {
      if (!args[required]) throw new Error(`workflow requires --${required}.`);
    }
    const file = workflowFile(config);
    withFileLock(file, () => {
      const workflow = updateWorkflowUnlocked(args, config, false);
      publish(commandCenterArtifacts(config, undefined, workflow).files);
    });
    console.log(`Updated ${args.ticket} ${args.stage} to ${args.status}`);
    return;
  }
  if (command === "snapshot" || command === "refresh") {
    if (!args.input) throw new Error(`${command} requires --input <jira-snapshot.json>.`);
    const prepared = snapshotCommand(args.input, config, args);
    if (command === "snapshot") {
      publish(prepared.files);
    } else {
      const file = workflowFile(config);
      withFileLock(file, () => {
        const commandCenter = commandCenterArtifacts(config, prepared.snapshot);
        publish([...prepared.files, ...commandCenter.files]);
      });
    }
    console.log(`Wrote sprint evidence to ${path.relative(config.consumerRoot, config.evidenceDir)}`);
    return;
  }
  if (command === "build") {
    const file = workflowFile(config);
    withFileLock(file, () => publish(commandCenterArtifacts(config).files));
    console.log(`Wrote QA command center to ${path.relative(config.consumerRoot, config.evidenceDir)}`);
    return;
  }
  throw new Error("Usage: qa-command-center.mjs <contract|snapshot|workflow|build|refresh|self-test> [options]");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
