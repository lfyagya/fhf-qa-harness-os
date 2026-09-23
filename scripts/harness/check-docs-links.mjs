import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveConsumerRoot } from "./workspace-paths.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FHF_ROOT = resolveConsumerRoot(HARNESS_ROOT);
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

// A skill that ships but is not allowlisted is refused by block-forbidden-skills the moment it
// is invoked, and one with no description cannot be matched by intent routing at all. Nine
// skills were in exactly that state on 2026-09-16 - the whole backend authoring family - and
// every existing check passed, because nothing verified that "exists" implies "usable".
function checkSkillsAreUsable(issues, config) {
  const skillsDir = path.join(HARNESS_ROOT, ".claude", "skills");
  if (!fs.existsSync(skillsDir)) return;
  const allow = new Set(config.engineering?.harness?.skills ?? []);
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (!allow.has(name)) {
      issues.push(`Shipped skill is not allowlisted: .claude/skills/${name} - add it to engineering.harness.skills or delete the skill; a permanently blocked skill is dead weight`);
    }
    const file = path.join(skillsDir, name, "SKILL.md");
    if (!fs.existsSync(file)) {
      issues.push(`Shipped skill has no SKILL.md: .claude/skills/${name}`);
      continue;
    }
    const head = fs.readFileSync(file, "utf8").slice(0, 2000);
    const fm = head.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm || !/^description:\s*\S/m.test(fm[1])) {
      issues.push(`Shipped skill has no description: .claude/skills/${name}/SKILL.md - intent routing matches on description, so a skill without one can never be routed to`);
    }
  }
}
function repoPath(value) {
  return value.replaceAll("\\", "/").replace(/^\.?\//, "");
}

function assertAutomationRepository(issues, repositories, id, { requiredRunner, production }) {
  const boundary = repositories?.[id];
  if (!boundary || boundary.requiredRunner !== requiredRunner) {
    issues.push(`automationSource must configure ${id} with ${requiredRunner}`);
    return;
  }
  try {
    new RegExp(boundary.pathPattern, "i");
  } catch (error) {
    issues.push(`automationSource ${id} pathPattern is invalid: ${error.message}`);
  }
  for (const field of [
    "writeStages",
    "runStages",
    "allowedEnvironments",
    "allowedWriteRoots",
    "deniedWritePatterns",
    "allowedRunPrefixes",
  ]) {
    if (!Array.isArray(boundary[field]) || boundary[field].length === 0) {
      issues.push(`automationSource ${id} ${field} must not be empty`);
    }
  }
  const colonSuffixes = boundary.allowedColonSuffixPrefixes ?? [];
  if (!Array.isArray(colonSuffixes)) {
    issues.push(`automationSource ${id} allowedColonSuffixPrefixes must be an array`);
  } else {
    for (const prefix of colonSuffixes) {
      if (!(boundary.allowedRunPrefixes ?? []).includes(prefix)) {
        issues.push(`automationSource ${id} allowedColonSuffixPrefixes must be a subset of allowedRunPrefixes`);
      }
    }
    if (id === "front-end-automation-smoke" && !colonSuffixes.includes("npm run cy:run:smoke")) {
      issues.push("automationSource front-end-automation-smoke must allow colon suffixes only on npm run cy:run:smoke");
    }
    if (id === "front-end-automation-e2e" && colonSuffixes.includes("npm run cy:run")) {
      issues.push("automationSource front-end-automation-e2e must not treat npm run cy:run as a colon-suffix prefix");
    }
  }
  const environments = boundary.allowedEnvironments ?? [];
  if (production === "required") {
    if (!environments.includes("production")) {
      issues.push(`automationSource ${id} environments must include production`);
    }
  } else if (environments.includes("production")) {
    issues.push(`automationSource ${id} environments must not include production`);
  }
  for (const [index, source] of (boundary.deniedWritePatterns ?? []).entries()) {
    try {
      new RegExp(source, "i");
    } catch (error) {
      issues.push(`automationSource ${id} deniedWritePatterns[${index}] is invalid: ${error.message}`);
    }
  }
}

// ADR-0026 separated the engine tree from the payload tree, but only fixed the five files that
// were duplicated at the time. The class stayed open: an authored docs/ path can exist on both
// the engine branch and at the workspace root, and nothing reports it. On 2026-09-20 six had
// diverged again - documentation.owners resolves against the workspace, so the engine copies
// were forks nobody published, and the onboarding page among them was the one engineers read.
// check-loader-drift.mjs covers generated projections; this covers authored ones.
function checkPayloadIsNotDuplicated(issues) {
  if (path.resolve(FHF_ROOT) === path.resolve(HARNESS_ROOT)) return; // same tree: nothing to compare
  let tracked;
  try {
    tracked = execFileSync("git", ["-C", HARNESS_ROOT, "ls-files", "docs"], { encoding: "utf8" });
  } catch {
    return; // no git, or docs/ untracked: the drift check is not the place to fail on that
  }
  for (const file of tracked.split("\n").map((line) => line.trim()).filter(Boolean)) {
    if (!fs.existsSync(path.join(FHF_ROOT, file))) continue;
    issues.push(
      `${file} exists in this repository and at the workspace root. Authored documentation lives ` +
        `in exactly one tree (ADR-0026): keep the copy the owner resolves to and delete the other`,
    );
  }
}

const issues = [];
let config;
let documentation;
let engineering;
try {
  config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  documentation = config.documentation;
  engineering = config.engineering;
  checkSkillsAreUsable(issues, config);
  checkPayloadIsNotDuplicated(issues);
} catch (error) {
  issues.push(`Invalid harness config: ${error.message}`);
}

if (documentation) {
  const precedence = documentation.sourcePrecedence;
  if (!Array.isArray(precedence) || precedence.length === 0 || new Set(precedence).size !== precedence.length) {
    issues.push("documentation.sourcePrecedence must be a non-empty list without duplicates");
  } else {
    const requiredAuthorityOrder = [
      "applicable-law-and-regulator-primary-source",
      "approved-internal-policy",
      "official-public-commitment",
    ];
    if (requiredAuthorityOrder.some((source, index) => precedence[index] !== source)) {
      issues.push("documentation.sourcePrecedence must begin with law, approved policy, then public commitment");
    }
    if (precedence.at(-1) !== "obsidian-derived-index") {
      issues.push("obsidian-derived-index must remain the lowest-precedence source");
    }
  }

  const owners = Object.entries(documentation.owners ?? {});
  if (owners.length === 0) issues.push("documentation.owners must not be empty");
  for (const [concern, owner] of owners) {
    if (typeof owner !== "string" || !fs.existsSync(path.resolve(FHF_ROOT, repoPath(owner)))) {
      issues.push(`Documentation owner '${concern}' is missing: ${owner}`);
    }
  }

  // Published Confluence pages are projections of Markdown sources, so the page map must stay
  // complete, unambiguous, and free of credentials.
  const publishing = documentation.publishing?.confluence;
  if (publishing) {
    if (publishing.version !== 1) {
      issues.push("documentation.publishing.confluence.version must be 1");
    }
    if (publishing.credentialsInConfig !== false) {
      issues.push("documentation.publishing.confluence.credentialsInConfig must be false");
    }
    for (const field of ["emailEnv", "apiTokenEnv"]) {
      if (typeof publishing[field] !== "string" || !/^[A-Z0-9_]+$/.test(publishing[field])) {
        issues.push(`documentation.publishing.confluence.${field} must name an environment variable`);
      }
    }
    if (!/^https:\/\/[^/]+$/.test(publishing.baseUrl ?? "")) {
      issues.push("documentation.publishing.confluence.baseUrl must be an https origin without a path");
    }
    if (typeof publishing.spaceKey !== "string" || !publishing.spaceKey) {
      issues.push("documentation.publishing.confluence.spaceKey must be configured");
    }
    if (!String(publishing.generatedBanner ?? "").includes("{source}")) {
      issues.push("documentation.publishing.confluence.generatedBanner must name its {source}");
    }
    if (!fs.existsSync(path.join(HARNESS_ROOT, repoPath(publishing.publisher ?? "")))) {
      issues.push(`Documentation publisher is missing: ${publishing.publisher}`);
    }
    const publishedPages = publishing.pages;
    if (!Array.isArray(publishedPages) || publishedPages.length === 0) {
      issues.push("documentation.publishing.confluence.pages must not be empty");
    } else {
      const seenSources = new Set();
      const seenIds = new Set();
      let pendingCreation = 0;
      for (const page of publishedPages) {
        const source = typeof page.source === "string" ? repoPath(page.source) : null;
        if (!source || path.isAbsolute(page.source)) {
          issues.push("Published page source must be a relative repository path");
        } else if (!fs.existsSync(path.resolve(FHF_ROOT, source))) {
          issues.push(`Published page source is missing: ${page.source}`);
        }
        if (source && seenSources.has(source)) issues.push(`Duplicate published page source: ${page.source}`);
        seenSources.add(source);
        // An explicit null marks a declared owner whose Confluence page does not exist yet; the
        // publisher creates it and writes the id back. A missing or malformed id is still a fault.
        const awaitingCreation = page.pageId === null;
        if (awaitingCreation) {
          pendingCreation += 1;
        } else if (!/^[0-9]+$/.test(String(page.pageId ?? ""))) {
          issues.push(`Published page needs a numeric Confluence pageId or an explicit null: ${page.source}`);
        } else if (seenIds.has(page.pageId)) {
          issues.push(`Duplicate published page id: ${page.pageId}`);
        } else {
          seenIds.add(page.pageId);
        }
        if (typeof page.title !== "string" || !page.title.trim()) {
          issues.push(`Published page needs a title: ${page.source}`);
        }
      }
    }
  }
}

const policyGovernance = config?.policyGovernance;
if (!policyGovernance || policyGovernance.version !== 1) {
  issues.push("policyGovernance.version must be 1");
} else {
  const requiredCategories = [
    "regulatory",
    "public-commitment",
    "internal-business-policy",
    "application-contract",
    "implementation-observation",
    "execution-evidence",
    "proposal",
  ];
  for (const category of requiredCategories) {
    const definition = policyGovernance.categories?.[category];
    for (const field of ["authority", "owner", "adoptionGate", "contentOwner"]) {
      if (typeof definition?.[field] !== "string" || !definition[field]) {
        issues.push(`policyGovernance.categories.${category}.${field} must be configured`);
      }
    }
  }

  const validateUniqueList = (value, label) => {
    if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length) {
      issues.push(`${label} must be a non-empty list without duplicates`);
      return false;
    }
    return true;
  };

  if (validateUniqueList(policyGovernance.adoptionStates, "policyGovernance.adoptionStates")) {
    for (const state of ["proposed", "approved", "retired"]) {
      if (!policyGovernance.adoptionStates.includes(state)) {
        issues.push(`policyGovernance.adoptionStates must include ${state}`);
      }
    }
  }
  if (validateUniqueList(policyGovernance.applicabilityStates, "policyGovernance.applicabilityStates")) {
    for (const state of ["confirmed", "conditional", "not-applicable", "unknown"]) {
      if (!policyGovernance.applicabilityStates.includes(state)) {
        issues.push(`policyGovernance.applicabilityStates must include ${state}`);
      }
    }
  }
  const ruleFields = policyGovernance.ruleRecord?.requiredFields;
  const requiredRuleFields = [
    "id",
    "category",
    "owner",
    "source",
    "source-version-or-effective-date",
    "jurisdiction",
    "adoption-state",
    "applicability-state",
    "conditions",
    "decision",
    "blocked-outcome",
    "evidence",
  ];
  if (validateUniqueList(ruleFields, "policyGovernance.ruleRecord.requiredFields")) {
    for (const field of requiredRuleFields) {
      if (!ruleFields.includes(field)) issues.push(`policyGovernance.ruleRecord.requiredFields must include ${field}`);
    }
  }

  const enforceOnlyWhen = policyGovernance.decisionPolicy?.enforceOnlyWhen;
  if (enforceOnlyWhen?.adoptionState !== "approved") {
    issues.push("policyGovernance may enforce only approved rules");
  }
  if (!enforceOnlyWhen?.applicabilityStates?.includes("confirmed") ||
      !enforceOnlyWhen?.applicabilityStates?.includes("conditional")) {
    issues.push("policyGovernance enforceable applicability must include confirmed and conditional");
  }
  if (!enforceOnlyWhen?.conditionalRequires?.includes("jurisdiction") ||
      !enforceOnlyWhen?.conditionalRequires?.includes("conditions")) {
    issues.push("conditional policy requires jurisdiction and conditions");
  }
  const requiredFailureSignals = [
    "missing-required-field",
    "unknown-applicability",
    "source-conflict",
    "missing-owner-approval",
  ];
  const failureSignals = policyGovernance.decisionPolicy?.failClosedWhen;
  if (validateUniqueList(failureSignals, "policyGovernance.decisionPolicy.failClosedWhen")) {
    for (const signal of requiredFailureSignals) {
      if (!failureSignals.includes(signal)) {
        issues.push(`policyGovernance.decisionPolicy.failClosedWhen must include ${signal}`);
      }
    }
  }
  if (policyGovernance.decisionPolicy?.onFailure !== "block-adoption-or-enforcement-and-escalate-to-owner") {
    issues.push("policyGovernance decision failures must block and escalate to the owner");
  }

  for (const key of [
    "harnessConfig",
    "applicationContract",
    "implementation",
    "runtimeOverlay",
    "runtimeEvidence",
    "localSetupOrEnvironment",
  ]) {
    validateUniqueList(policyGovernance.placement?.[key], `policyGovernance.placement.${key}`);
  }
  validateUniqueList(policyGovernance.boundaries?.do, "policyGovernance.boundaries.do");
  validateUniqueList(policyGovernance.boundaries?.doNot, "policyGovernance.boundaries.doNot");
}

const workspaceContract = config?.workspaceContract;
if (!workspaceContract || workspaceContract.version !== 1) {
  issues.push("workspaceContract.version must be 1");
} else {
  for (const lane of ["e2e", "smoke"]) {
    const laneConfig = config.paths?.lanes?.[lane];
    if (!laneConfig?.root && (typeof laneConfig?.rootEnv !== "string" || !laneConfig.rootEnv)) {
      issues.push(`paths.lanes.${lane} must use a configured rootEnv instead of a checkout folder name`);
    }
  }
  for (const key of ["setupFile", "setupExample", "setupCommand"]) {
    if (typeof workspaceContract[key] !== "string" || path.isAbsolute(workspaceContract[key])) {
      issues.push(`workspaceContract.${key} must be a relative string`);
    }
  }
  const smoke = workspaceContract.lanes?.smoke;
  if (!smoke?.required || smoke.branch !== "staging" || smoke.blockUntilReady !== true) {
    issues.push("workspaceContract.lanes.smoke must be required, staging-bound, and blocking");
  }
  const e2e = workspaceContract.lanes?.e2e;
  if (!e2e?.required || e2e.branch !== "dev" || e2e.blockUntilReady !== true) {
    issues.push("workspaceContract.lanes.e2e must be required, dev-bound, and blocking");
  }
  if (typeof smoke.moduleSpecsPathPrefix !== "string" || !smoke.moduleSpecsPathPrefix) {
    issues.push("workspaceContract.lanes.smoke.moduleSpecsPathPrefix must be configured");
  }
  if (typeof e2e?.moduleSpecsPathPrefix !== "string" || !e2e.moduleSpecsPathPrefix) {
    issues.push("workspaceContract.lanes.e2e.moduleSpecsPathPrefix must be configured");
  }
  if (!(e2e?.requiredInputs ?? []).some((input) => input.field === "e2eRoot")) {
    issues.push("workspaceContract.lanes.e2e.requiredInputs must include e2eRoot");
  }
  for (const input of smoke.requiredInputs ?? []) {
    if (!input.field || !input.label || !input.description) {
      issues.push("workspaceContract.lanes.smoke.requiredInputs need field, label, and description");
    }
  }
  for (const entry of [...(smoke.requiredLocalPaths ?? []), ...(smoke.requiredWorkspacePaths ?? [])]) {
    if (!entry.path || !["file", "directory"].includes(entry.type)) {
      issues.push("workspaceContract path entries need a path and file/directory type");
    }
  }
  for (const input of smoke.optionalInputs ?? []) {
    if (!input.field || !input.label || !["boolean", "directory"].includes(input.type)) {
      issues.push("workspaceContract optionalInputs need field, label, and boolean/directory type");
    }
  }
}

const jiraContract = config?.atlassian?.retrievalContract;
if (!jiraContract || jiraContract.version !== 1) {
  issues.push("atlassian.retrievalContract.version must be 1");
} else {
  for (const field of [
    "issueKey",
    "summary",
    "details",
    "status",
    "priority",
    "labels",
    "components",
    "assignee",
    "parent",
    "attachments",
    "linkedWorkItems",
    "module",
    "sprint",
    "acceptanceCriteria",
  ]) {
    if (typeof jiraContract.requiredSemanticFields?.[field] !== "string") {
      issues.push(`atlassian.retrievalContract.requiredSemanticFields.${field} must be configured`);
    }
  }
  if (jiraContract.fieldDiscovery?.unknownOutcome !== "record-unknown-do-not-guess") {
    issues.push("Jira field discovery must record unknown fields instead of guessing");
  }
  if (jiraContract.attachments?.load !== "metadata-first" ||
      !jiraContract.attachments?.trustBoundary?.includes("never-agent-instructions")) {
    issues.push("Jira attachments must be metadata-first untrusted evidence, never agent instructions");
  }
  if (jiraContract.people?.rule !== "do-not-equate-jira-assignee-with-all-people-working") {
    issues.push("Jira people routing must distinguish assignee from implementation contributors");
  }
}

const topology = config?.productTopology;
const topologyRepos = topology?.repositories ?? {};
const topologyBundles = topology?.sourceBundles ?? {};
if (!topology || topology.version !== 1 || topology.mutationAuthority !== "none-use-engineering-harness-boundaries-and-repository-local-instructions") {
  issues.push("productTopology must be routing-only and must not grant mutation authority");
} else {
  if (!Number.isInteger(topology.progressiveLoading?.maximumInitialRepositories) ||
      topology.progressiveLoading.maximumInitialRepositories < 1 ||
      topology.progressiveLoading.noSilentTruncation !== true) {
    issues.push("productTopology progressive loading must set a positive initial repository limit and noSilentTruncation=true");
  }
  if (Object.keys(topologyRepos).length < 17) {
    issues.push("productTopology must catalog all 17 FHF source, contract, and automation repositories");
  }
  for (const [id, repo] of Object.entries(topologyRepos)) {
    if (!repo.root || path.isAbsolute(repo.root)) {
      issues.push(`productTopology.repositories.${id}.root must be a relative path`);
      continue;
    }
    const root = path.resolve(FHF_ROOT, repoPath(repo.root));
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      issues.push(`productTopology repository is unavailable: ${id} -> ${repo.root}`);
    }
    for (const field of ["kind", "roles", "businessDomains", "entryPaths", "instructions", "evidence"]) {
      if (repo[field] === undefined || repo[field] === null) issues.push(`productTopology.repositories.${id}.${field} must be configured`);
    }
    if (!Array.isArray(repo.roles) || repo.roles.length === 0 ||
        !Array.isArray(repo.businessDomains) || repo.businessDomains.length === 0 ||
        !Array.isArray(repo.entryPaths) || repo.entryPaths.length === 0 ||
        !Array.isArray(repo.instructions)) {
      issues.push(`productTopology.repositories.${id} has invalid roles/domains/entryPaths/instructions`);
    }
  }
  const knownRepoIds = new Set(Object.keys(topologyRepos));
  const edgeIds = new Set();
  for (const edge of topology.edges ?? []) {
    if (!edge.id || edgeIds.has(edge.id)) issues.push("productTopology edges need unique IDs");
    edgeIds.add(edge.id);
    if (!knownRepoIds.has(edge.from) || !knownRepoIds.has(edge.to)) {
      issues.push(`productTopology edge ${edge.id} references an unknown repository`);
    }
    if (!edge.kind || !Array.isArray(edge.evidence) || edge.evidence.length === 0) {
      issues.push(`productTopology edge ${edge.id} needs kind and evidence`);
    }
  }
  for (const [id, bundle] of Object.entries(topologyBundles)) {
    if (!Array.isArray(bundle.seedRepositories) || bundle.seedRepositories.length === 0 ||
        bundle.seedRepositories.length > topology.progressiveLoading.maximumInitialRepositories) {
      issues.push(`productTopology.sourceBundles.${id} must select 1-${topology.progressiveLoading.maximumInitialRepositories} seed repositories`);
    }
    for (const repoId of bundle.seedRepositories ?? []) {
      if (!knownRepoIds.has(repoId)) issues.push(`productTopology.sourceBundles.${id} references unknown repository ${repoId}`);
    }
    if (!Array.isArray(bundle.expandBy) || bundle.expandBy.length === 0 || !bundle.purpose) {
      issues.push(`productTopology.sourceBundles.${id} needs expansion rules and purpose`);
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
      for (const bundleId of route.sourceBundles ?? []) {
        if (!Object.hasOwn(topologyBundles, bundleId)) {
          issues.push(`engineering.context.routes[${index}] references unknown source bundle ${bundleId}`);
        }
      }
      if (route.lanes) {
        const known = new Set(["root", "e2e", "smoke"]);
        if (!Array.isArray(route.lanes) || route.lanes.length === 0 || route.lanes.some((name) => !known.has(name))) {
          issues.push(`engineering.context.routes[${index}] lanes must be a non-empty subset of root|e2e|smoke`);
        }
      }
      const invoke = route.invoke;
      if (!invoke || typeof invoke !== "object" || !["agent", "skill", "parent"].includes(invoke.kind)) {
        issues.push(`engineering.context.routes[${index}] needs invoke.kind agent|skill|parent`);
      } else if (invoke.kind === "agent" && !engineering.harness?.agents?.includes(invoke.name)) {
        issues.push(`engineering.context.routes[${index}] invoke agent ${invoke.name} is not on the roster`);
      } else if (invoke.kind === "skill" && !engineering.harness?.skills?.includes(invoke.name)) {
        issues.push(`engineering.context.routes[${index}] invoke skill ${invoke.name} is not allow-listed`);
      }
      if (invoke?.prefer?.kind === "skill" && !engineering.harness?.skills?.includes(invoke.prefer.name)) {
        issues.push(`engineering.context.routes[${index}] invoke.prefer skill is not allow-listed`);
      }
    });
  }

  const spawnBudget = engineering.harness?.spawnBudget;
  if (spawnBudget?.maxSpecialists !== 1 || spawnBudget?.maxDepth !== 1 || spawnBudget?.concurrent !== 1) {
    issues.push("engineering.harness.spawnBudget must be one specialist, depth one, concurrent one");
  }
  const modelTiers = engineering.harness?.modelTiers;
  if (modelTiers?.default !== "standard" || modelTiers?.unnamedSpecialist !== "standard") {
    issues.push("engineering.harness.modelTiers must default to standard");
  }
  const frontierRoutes = modelTiers?.frontier?.allowedRouteIds ?? [];
  for (const id of ["cloud-failure", "test-failure", "test-flake"]) {
    if (!frontierRoutes.includes(id)) {
      issues.push(`engineering.harness.modelTiers.frontier.allowedRouteIds must include ${id}`);
    }
  }
  if (engineering.harness?.skillInvocation?.mode !== "route-or-explicit") {
    issues.push("engineering.harness.skillInvocation.mode must be route-or-explicit");
  }
  for (const [skill, lanes] of Object.entries(engineering.harness?.skillLanes ?? {})) {
    if (!engineering.harness?.skills?.includes(skill)) {
      issues.push(`engineering.harness.skillLanes.${skill} is not on the skill allow-list`);
    }
    if (!Array.isArray(lanes) || lanes.some((name) => !["root", "e2e", "smoke", "backend"].includes(name))) {
      issues.push(`engineering.harness.skillLanes.${skill} lanes must be root|e2e|smoke|backend`);
    }
  }

  const taskProtocol = engineering.taskProtocol;
  if (!taskProtocol || taskProtocol.version !== 1 || taskProtocol.schema !== "fhf-harness/task/v1") {
    issues.push("engineering.taskProtocol must configure fhf-harness/task/v1");
  } else {
    if (taskProtocol.activeManifestEnv !== "FHF_ACTIVE_TASK") {
      issues.push("engineering.taskProtocol.activeManifestEnv must be FHF_ACTIVE_TASK");
    }
    for (const stage of ["intake", "grounded", "planned", "approved", "implementing", "verified", "complete", "blocked"]) {
      if (!taskProtocol.stages?.includes(stage)) issues.push(`engineering.taskProtocol.stages must include ${stage}`);
    }
    const executionBudget = taskProtocol.executionBudget;
    const budgetFields = ["maxWallClockMinutes", "maxRecordedToolResults", "maxRetryableFailures"];
    if (!executionBudget || executionBudget.version !== 1 || executionBudget.manifestPath !== "plan.executionBudget") {
      issues.push("task protocol execution budget must configure plan.executionBudget");
    } else {
      for (const field of budgetFields) {
        if (!executionBudget.requiredFields?.includes(field) || !Number.isInteger(executionBudget.hardCeilings?.[field]) || executionBudget.hardCeilings[field] < 1) {
          issues.push(`task protocol execution budget must require a positive hard ceiling for ${field}`);
        }
      }
      if (executionBudget.onExceeded !== "block-and-record-budget-exceeded") {
        issues.push("task protocol execution budget must fail closed");
      }
    }
    if (taskProtocol.approval?.humanOnly !== true || taskProtocol.approval?.agentMayApprove !== false ||
        taskProtocol.approval?.onMismatch !== "block-and-request-fresh-human-approval") {
      issues.push("task protocol approval must be human-only and fail closed when its digest changes");
    }
    if (!taskProtocol.approval?.boundFields?.includes("grounding.intentVsBuilt")) {
      issues.push("task protocol approval must bind grounding.intentVsBuilt");
    }
    const gateIds = (taskProtocol.approval?.gates ?? []).map((gate) => gate.id);
    if (JSON.stringify(gateIds) !== JSON.stringify([
      "manifest",
      "scenarios",
      "plan",
      "test-cases",
      "evidence",
      "release",
    ])) {
      issues.push("task protocol approval gates must be manifest, scenarios, plan, test-cases, evidence, release");
    }
    if (taskProtocol.approval?.legacySingleDigestSatisfies !== "plan") {
      issues.push("task protocol legacySingleDigestSatisfies must remain plan");
    }
    const reviewGates = taskProtocol.preHumanReview?.requiredBeforeGateConfirm ?? [];
    if (reviewGates[0] !== "manifest" || reviewGates.includes("spec")) {
      issues.push("preHumanReview.requiredBeforeGateConfirm must start from manifest, not spec");
    }
    if (taskProtocol.preHumanReview?.appliesTo !== "every-task"
        || !taskProtocol.preHumanReview?.artefacts?.includes("grounding.intentVsBuilt")
        || taskProtocol.preHumanReview?.proactiveDefects?.action == null) {
      issues.push("task protocol preHumanReview must apply to every task and require spec/scenario/test/source comparison plus proactive Dev notice");
    }
    if (!taskProtocol.snapshot?.freeze?.includes("intent-vs-built-classification")) {
      issues.push("task protocol snapshot must freeze intent-vs-built-classification");
    }
    for (const action of ["classify-intent-vs-built", "resolve-intent-vs-built-defect"]) {
      if (!taskProtocol.nextStep?.actions?.includes(action)) {
        issues.push(`task protocol nextStep.actions must include ${action}`);
      }
    }
    for (const mode of [
      "red-green-replay",
      "existing-regression-base-pass",
      "external-execution-evidence",
      "tests-not-applicable",
    ]) {
      if (!taskProtocol.proofModes?.[mode]) issues.push(`engineering.taskProtocol.proofModes.${mode} must be configured`);
    }
    for (const boundary of ["autoCommit", "autoMerge", "autoDeploy", "autoExternalWrite", "autoApproval"]) {
      if (taskProtocol.automationBoundaries?.[boundary] !== false) {
        issues.push(`engineering.taskProtocol.automationBoundaries.${boundary} must remain false`);
      }
    }
  }

  const runners = engineering.executionRunners?.runners;
  const capabilityControl = engineering.capabilityControl;
  const requiredCapabilities = [
    "source-grounding",
    "jira-ticket-read",
    "figma-design-read",
    "cypress-cli",
    "cypress-cloud-diagnostics",
    "execution-environment",
    "backend-api-oracle",
    "testrail-read-report",
  ];
  if (!capabilityControl || capabilityControl.version !== 1 || capabilityControl.manifestPath !== "plan.capabilities" ||
      typeof capabilityControl.stateDirectory !== "string" || !capabilityControl.stateDirectory.startsWith("cypress/handoff/") ||
      !Number.isInteger(capabilityControl.maxRetryableUnavailable) || capabilityControl.maxRetryableUnavailable < 1) {
    issues.push("engineering.capabilityControl must configure a bounded plan.capabilities loop in ignored runtime state");
  } else {
    for (const id of requiredCapabilities) {
      const capability = capabilityControl.capabilities?.[id];
      if (!capability?.label || !capability?.accessRequest || !capability?.liveProbe || !capability?.escalation || !capability?.outcomes?.ready) {
        issues.push(`engineering.capabilityControl.capabilities.${id} is incomplete`);
      }
    }
  }
  if (!runners || typeof runners !== "object" || Object.keys(runners).length === 0) {
    issues.push("engineering.executionRunners.runners must not be empty");
  } else {
    const knownRepoIds = new Set(Object.keys(topologyRepos));
    for (const [id, runner] of Object.entries(runners)) {
      const repositories = runner.repositories ?? [runner.repository];
      if (repositories.some((repoId) => !knownRepoIds.has(repoId))) {
        issues.push(`engineering.executionRunners.runners.${id} references an unknown repository`);
      }
      if ((!runner.command && !runner.commandsByPlatform) ||
          !Array.isArray(runner.testKinds) || runner.testKinds.length === 0 ||
          !Array.isArray(runner.proofModes) || runner.proofModes.length === 0 ||
          !Array.isArray(runner.environments) || runner.environments.length === 0 ||
          !Array.isArray(runner.nativeEvidence) || runner.nativeEvidence.length === 0) {
        issues.push(`engineering.executionRunners.runners.${id} is incomplete`);
      }
      if (!Array.isArray(runner.requiredCapabilities) || runner.requiredCapabilities.length === 0 ||
          runner.requiredCapabilities.some((capability) => !capabilityControl?.capabilities?.[capability])) {
        issues.push(`engineering.executionRunners.runners.${id} must select known requiredCapabilities`);
      }
      for (const mode of runner.proofModes ?? []) {
        if (!taskProtocol?.proofModes?.[mode]) issues.push(`runner ${id} references unknown proof mode ${mode}`);
      }
    }
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
  if ((appBoundary?.pathPatterns ?? []).some((source) => /fhf-backend-automation/i.test(source))) {
    issues.push("applicationSource.pathPatterns must not classify backend automation as application source");
  }
  const expectedApplicationSourcePaths = {
    root: "./fhf-dashboards/src",
    e2e: "../fhf-dashboards/src",
    smoke: "../fhf-dashboards/src",
  };
  for (const lane of ["root", "e2e", "smoke"]) {
    if (!Array.isArray(appBoundary?.denyWriteByLane?.[lane]) || appBoundary.denyWriteByLane[lane].length === 0) {
      issues.push(`applicationSource.denyWriteByLane.${lane} must not be empty`);
    } else if (!appBoundary.denyWriteByLane[lane].includes(expectedApplicationSourcePaths[lane])) {
      issues.push(`applicationSource.denyWriteByLane.${lane} must protect ${expectedApplicationSourcePaths[lane]}`);
    }
  }

  const automationBoundary = engineering.harness?.boundaries?.automationSource;
  if (automationBoundary?.mode !== "task-scoped-write-and-run") {
    issues.push("engineering.harness.boundaries.automationSource must be task-scoped-write-and-run");
  }
  if (automationBoundary?.activeManifestEnv !== taskProtocol?.activeManifestEnv) {
    issues.push("automationSource.activeManifestEnv must match engineering.taskProtocol.activeManifestEnv");
  }
  if (automationBoundary?.requireCurrentApproval !== true) {
    issues.push("automationSource must require current digest-bound approval");
  }
  if (automationBoundary?.shellWrites !== "blocked-use-scoped-file-tools" ||
      automationBoundary?.dependencyChanges !== "blocked" ||
      automationBoundary?.gitPublication !== "blocked") {
    issues.push("automationSource must block shell writes, dependency changes, and Git publication");
  }
  assertAutomationRepository(
    issues,
    automationBoundary?.repositories,
    "fhf-backend-automation",
    { requiredRunner: "backend-api-oracle", production: "forbidden" },
  );
  assertAutomationRepository(
    issues,
    automationBoundary?.repositories,
    "front-end-automation-e2e",
    { requiredRunner: "frontend-e2e", production: "forbidden" },
  );
  assertAutomationRepository(
    issues,
    automationBoundary?.repositories,
    "front-end-automation-smoke",
    { requiredRunner: "production-smoke", production: "required" },
  );

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

// Every hook encodes an assumption about what the model cannot do reliably on its own. An
// assumption nobody wrote down cannot be stress-tested, so the hook can never be retired and
// quietly becomes dead weight. This is a ratchet against the baseline, not a retro-fit demand:
// hooks recorded in rationale-baseline.json predate the requirement, and a hook absent from it
// must carry a dated rationale. Writing one is expected to shrink the baseline over time.
{
  const hooksDir = path.join(HARNESS_ROOT, ".claude", "hooks");
  let baseline = null;
  try {
    baseline = JSON.parse(fs.readFileSync(path.join(hooksDir, "rationale-baseline.json"), "utf8"));
  } catch {
    issues.push("Hook rationale baseline is missing or unreadable: .claude/hooks/rationale-baseline.json");
  }
  if (baseline) {
    const exempt = new Set(baseline.undocumented ?? []);
    const present = fs.existsSync(hooksDir)
      ? fs.readdirSync(hooksDir).filter((name) => name.endsWith(".mjs"))
      : [];
    const documents = (name) => {
      const head = fs.readFileSync(path.join(hooksDir, name), "utf8").slice(0, 3000).toLowerCase();
      return head.includes("why this exists") || head.includes("compensat");
    };
    for (const name of present) {
      const documented = documents(name);
      if (!documented && !exempt.has(name)) {
        issues.push(`Hook has no recorded rationale: .claude/hooks/${name} - add a dated "Why this exists" header naming the model limitation it compensates for`);
      }
      if (documented && exempt.has(name)) {
        issues.push(`Hook documents its rationale but is still baselined: remove ${name} from .claude/hooks/rationale-baseline.json`);
      }
    }
    for (const name of exempt) {
      if (!present.includes(name)) {
        issues.push(`Hook rationale baseline names a hook that no longer exists: ${name}`);
      }
    }
  }
}

const moduleSpecPaths = config?.moduleSpecPaths;
const moduleAliases = config?.moduleAliases;
const moduleSpecBase = config?.moduleSpecPathsBase;
if (moduleSpecBase !== "paths.consumerRoot") {
  issues.push("moduleSpecPathsBase must resolve from paths.consumerRoot");
}

const quality = config?.qualityAssurance;
if (!quality || typeof quality !== "object") {
  issues.push("qualityAssurance must be configured");
} else {
  for (const field of ["requiredEvidenceChain", "scenarioRequiredFields", "acceptedProductSpecStatuses", "fullChainRequires"]) {
    if (!Array.isArray(quality[field]) || quality[field].length === 0) {
      issues.push(`qualityAssurance.${field} must be a non-empty array`);
    }
  }
  for (const lane of ["smoke", "e2e", "backend"]) {
    if (!quality.lanes?.[lane] || typeof quality.lanes[lane] !== "object") {
      issues.push(`qualityAssurance.lanes.${lane} must be configured`);
    }
  }
  if (quality.lanes?.smoke?.environment !== "production") {
    issues.push("qualityAssurance.lanes.smoke.environment must be production");
  }
  if (JSON.stringify(quality.lanes?.smoke?.allowedMethods ?? []) !== JSON.stringify(["GET"])) {
    issues.push("qualityAssurance.lanes.smoke.allowedMethods must be GET-only");
  }
  for (const [name, value] of Object.entries(quality.falseGreen ?? {})) {
    if (value !== false) issues.push(`qualityAssurance.falseGreen.${name} must remain false`);
  }
}
if (!moduleSpecPaths || typeof moduleSpecPaths !== "object" || Array.isArray(moduleSpecPaths)) {
  issues.push("moduleSpecPaths must be a non-empty object");
} else {
  for (const module of Object.keys(moduleAliases ?? {})) {
    const targets = moduleSpecPaths[module];
    if (!Array.isArray(targets)) {
      issues.push(`moduleSpecPaths.${module} must contain at least one product contract path`);
      continue;
    }
    // An explicitly empty list declares a backend-only module with no UI product contract
    // (Letters). A missing or malformed entry is still a fault, so an undeclared module cannot
    // pass. ponytail: presence-is-the-declaration; add a named exemption list if a module ever
    // needs an empty list for a different reason.
    if (targets.length === 0) continue;
    for (const target of targets) {
      if (typeof target !== "string" || !target || path.isAbsolute(target)) {
        issues.push(`moduleSpecPaths.${module} contains a non-relative path: ${target}`);
        continue;
      }
      const resolved = path.resolve(FHF_ROOT, repoPath(target));
      if (!fs.existsSync(resolved)) issues.push(`moduleSpecPaths.${module} target is unavailable in the configured consumer workspace: ${target}`);
    }
  }
  for (const module of Object.keys(moduleSpecPaths)) {
    if (!Object.hasOwn(moduleAliases ?? {}, module)) {
      issues.push(`moduleSpecPaths.${module} has no matching moduleAliases entry`);
    }
  }
}

const runtimePolicy = engineering?.context?.runtime;
if (!runtimePolicy || typeof runtimePolicy !== "object") {
  issues.push("engineering.context.runtime must be configured");
} else {
  for (const key of ["stateFile", "traceFile", "stateSchema", "traceSchema"]) {
    if (typeof runtimePolicy[key] !== "string" || path.isAbsolute(runtimePolicy[key])) {
      issues.push(`engineering.context.runtime.${key} must be a relative string`);
    }
  }
  for (const source of runtimePolicy.redactPatterns ?? []) {
    try { new RegExp(source, "gi"); } catch (error) {
      issues.push(`engineering.context.runtime.redactPatterns contains invalid regex: ${error.message}`);
    }
  }
}

const evaluationPolicy = engineering?.context?.evaluation;
if (!evaluationPolicy || typeof evaluationPolicy !== "object") {
  issues.push("engineering.context.evaluation must be configured");
} else {
  for (const key of ["goldenRoutes", "calibrationCases"]) {
    const target = evaluationPolicy[key];
    if (typeof target !== "string" || path.isAbsolute(target) || !fs.existsSync(path.join(HARNESS_ROOT, repoPath(target)))) {
      issues.push(`engineering.context.evaluation.${key} must point to an existing relative file`);
    }
  }
  // Rates are 0..1; a `minimum*Samples` threshold is a sample count, so it is
  // validated as a positive integer instead of being forced into the rate range.
  for (const [name, value] of Object.entries(evaluationPolicy.thresholds ?? {})) {
    const isSampleCount = /Samples$/.test(name);
    const valid = isSampleCount
      ? Number.isInteger(value) && value >= 1
      : Number.isFinite(value) && value >= 0 && value <= 1;
    if (!valid) issues.push(`Invalid evaluation threshold: ${name}`);
  }
}

try {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: HARNESS_ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const homePath = /(?:[A-Za-z]:[\\/](?:Users|home)[\\/]|\/(?:Users|home)\/)/;
  for (const relative of tracked) {
    const file = path.join(HARNESS_ROOT, relative);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    if (homePath.test(fs.readFileSync(file, "utf8"))) {
      issues.push(`Developer-absolute path found in tracked file: ${relative}`);
    }
  }
} catch (error) {
  issues.push(`Unable to inspect tracked files for developer paths: ${error.message}`);
}

const twgCli = config?.connectors?.teamworkGraphCli;
if (!twgCli) {
  issues.push("connectors.teamworkGraphCli must be configured");
} else {
  if (twgCli.required !== false || twgCli.ticketOracle !== false || twgCli.configureThenUse !== true) {
    issues.push("connectors.teamworkGraphCli must be optional, configure-then-use, and not a ticket oracle");
  }
  if (twgCli.agentsMd !== "https://teamwork-graph.atlassian.com/cli/AGENTS.md") {
    issues.push("connectors.teamworkGraphCli.agentsMd must be the official Atlassian AGENTS.md");
  }
  if (twgCli.command !== "twg" || twgCli.capability !== "teamwork-graph-cli") {
    issues.push("connectors.teamworkGraphCli must use command twg and capability teamwork-graph-cli");
  }
  if (!Array.isArray(twgCli.queryOrder) || twgCli.queryOrder.at(-1) !== "twg-cli" || twgCli.fallback !== "jira-ticket-read") {
    issues.push("connectors.teamworkGraphCli must try Jira first and fall back to jira-ticket-read");
  }
  for (const name of twgCli.harnessSkills ?? []) {
    if (!(config.engineering?.harness?.skills ?? []).includes(name)) {
      issues.push(`connectors.teamworkGraphCli skill ${name} must be on engineering.harness.skills`);
    }
  }
  if (!config.engineering?.capabilityControl?.capabilities?.["teamwork-graph-cli"]) {
    issues.push("engineering.capabilityControl.capabilities must include teamwork-graph-cli");
  }
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
  const expectedAccess = { e2e: "full-read", smoke: "metadata-only", root: "metadata-only" };
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
      const configuredRoot = lanePath?.root ?? (lanePath?.rootEnv ? process.env[lanePath.rootEnv] : null);
      if (!configuredRoot) continue;
      // The Cypress config is being migrated from .js to .cjs (Cypress 15.17+ resolves the
      // module kind by extension before loading). The two lanes are branches of one repository,
      // so they cross over separately and one configured filename cannot describe both. Accept
      // whichever extension is present; when the migration is finished on every lane this can
      // go back to the single configured name.
      const laneBase = path.resolve(FHF_ROOT, repoPath(configuredRoot), repoPath(lanePath.package));
      const configured = repoPath(cloudCli.projectIdSource);
      const candidates = [configured, configured.replace(/\.cjs$/, ".js"), configured.replace(/\.js$/, ".cjs")];
      const projectConfig = candidates
        .map((name) => path.resolve(laneBase, name))
        .find((candidate) => fs.existsSync(candidate))
        ?? path.resolve(laneBase, configured);
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
