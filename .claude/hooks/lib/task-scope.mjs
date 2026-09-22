import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { humanApprovalBlock } from "./task-protocol.mjs";

function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().flatMap((key) =>
        value[key] === undefined ? [] : [[key, normalized(value[key])]]),
    );
  }
  return value;
}

function valueAt(object, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => current?.[key], object);
}

function approvalDigest(manifest, fields) {
  const payload = Object.fromEntries(fields.map((field) => [field, valueAt(manifest, field)]));
  return crypto.createHash("sha256").update(JSON.stringify(normalized(payload))).digest("hex");
}

function normalizePath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+/g, "/");
}

function safeRelative(value) {
  const normalizedPath = normalizePath(value);
  return normalizedPath.length > 0
    && !/^(?:[A-Za-z]:\/|\/)/.test(normalizedPath)
    && !normalizedPath.split("/").includes("..");
}

function validSha(value, length) {
  return new RegExp(`^[a-f0-9]{${length}}$`).test(value ?? "");
}

function manifestShapeIssues(config, manifest) {
  const issues = [];
  if (!validSha(manifest.grounding?.jira?.issueDigest, 64)) issues.push("Jira issue digest is invalid");
  if (!validSha(manifest.grounding?.acceptanceCriteriaDigest, 64)) issues.push("acceptance-criteria digest is invalid");
  if (manifest.grounding?.catalogVersion !== config.productTopology?.catalogVersion) {
    issues.push("product topology catalog version is stale");
  }
  const repositories = manifest.grounding?.repositories;
  if (!Array.isArray(repositories) || repositories.length === 0) {
    issues.push("no grounded repositories are selected");
  } else {
    for (const repository of repositories) {
      if (!repository?.id || !validSha(repository.baseSha, 40) || !validSha(repository.headSha, 40)) {
        issues.push("selected repository identity or SHA is invalid");
      }
      if (!Array.isArray(repository?.selectedPaths) || repository.selectedPaths.length === 0 ||
          repository.selectedPaths.some((selectedPath) => !safeRelative(selectedPath))) {
        issues.push(`selected repository paths are invalid for ${repository?.id ?? "UNKNOWN"}`);
      }
    }
  }
  if (!manifest.selection?.routeId ||
      !Array.isArray(manifest.selection?.sourceBundles) || manifest.selection.sourceBundles.length === 0 ||
      !Array.isArray(manifest.selection?.graphNodes) || manifest.selection.graphNodes.length === 0 ||
      !Array.isArray(manifest.selection?.expansionReasons)) {
    issues.push("task selection is incomplete");
  }
  const changeUnits = manifest.plan?.changeUnits;
  if (!Array.isArray(changeUnits) || changeUnits.length === 0 ||
      changeUnits.some((unit) =>
        !unit?.id || !unit.repoId || !Array.isArray(unit.paths) || unit.paths.length === 0 ||
        unit.paths.some((selectedPath) => !safeRelative(selectedPath)))) {
    issues.push("planned change units are invalid");
  }
  const tests = manifest.plan?.tests;
  if (!Array.isArray(tests) || tests.length === 0) issues.push("planned tests are missing");
  if (!["functional", "regression", "smoke"].every((kind) => Array.isArray(manifest.plan?.impact?.[kind]))) {
    issues.push("functional, regression, and smoke impact are not all classified");
  }
  const intentRows = manifest.grounding?.intentVsBuilt?.rows;
  if (!Array.isArray(intentRows) || intentRows.length === 0) {
    issues.push("intent-vs-built classification is missing");
  } else if (intentRows.some((row) => row?.classification === "ask-product" || !row?.classification)) {
    issues.push("unclassified or ask-product intent-vs-built rows block automation writes");
  }
  return issues;
}

function containsPath(candidate, selected) {
  const normalizedCandidate = normalizePath(candidate).toLowerCase();
  const normalizedSelected = normalizePath(selected).replace(/\/+$/, "").toLowerCase();
  return normalizedCandidate === normalizedSelected || normalizedCandidate.startsWith(`${normalizedSelected}/`);
}

function backendRelativePath(filePath, cwd, repositoryId) {
  const normalizedFile = normalizePath(filePath);
  const marker = `/${repositoryId.toLowerCase()}/`;
  const absolute = normalizePath(
    path.isAbsolute(String(filePath ?? ""))
      ? filePath
      : path.resolve(String(cwd ?? process.cwd()), String(filePath ?? "")),
  );
  const index = absolute.toLowerCase().indexOf(marker);
  if (index >= 0) return absolute.slice(index + marker.length);
  if (normalizePath(cwd).toLowerCase().includes(`/${repositoryId.toLowerCase()}`) && safeRelative(normalizedFile)) {
    return normalizedFile;
  }
  return null;
}

function repositoryRoot(filePath, cwd, repositoryId) {
  const input = filePath
    ? (path.isAbsolute(String(filePath)) ? filePath : path.resolve(String(cwd ?? process.cwd()), String(filePath)))
    : path.resolve(String(cwd ?? process.cwd()));
  const absolute = normalizePath(input);
  const lower = absolute.toLowerCase();
  const id = repositoryId.toLowerCase();
  const marker = `/${id}/`;
  const index = lower.indexOf(marker);
  if (index >= 0) return absolute.slice(0, index + marker.length - 1);
  if (lower.endsWith(`/${id}`)) return absolute;
  return null;
}

function verifyRepositoryRevision({ filePath, cwd, repositoryId, expectedSha }) {
  const root = repositoryRoot(filePath, cwd, repositoryId);
  if (!root) return { ok: false, reason: "backend repository root cannot be resolved" };
  const result = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
    timeout: 10000,
  });
  if (result.status !== 0) {
    return { ok: false, reason: "backend repository HEAD cannot be verified" };
  }
  const actualSha = result.stdout.trim().toLowerCase();
  if (actualSha !== String(expectedSha ?? "").toLowerCase()) {
    return { ok: false, reason: `backend repository HEAD changed: manifest=${expectedSha ?? "UNKNOWN"} actual=${actualSha}` };
  }
  return { ok: true, root, actualSha };
}

function activeTask(config, env, stages) {
  const protocol = config.engineering?.taskProtocol;
  const boundary = config.engineering?.harness?.boundaries?.automationSource;
  const envName = boundary?.activeManifestEnv ?? protocol?.activeManifestEnv;
  if (!envName || protocol?.activeManifestEnv !== envName) {
    return { ok: false, reason: "active task manifest environment is not configured consistently" };
  }
  const source = String(env[envName] ?? "").trim();
  if (!source) return { ok: false, reason: `${envName} must point to the selected task manifest` };
  if (!path.isAbsolute(source)) return { ok: false, reason: `${envName} must be an absolute path` };

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(source, "utf8"));
  } catch (error) {
    return { ok: false, reason: `active task manifest is unavailable or invalid: ${error.message}` };
  }
  if (manifest.schema !== protocol?.schema) {
    return { ok: false, reason: `active task manifest schema must be ${protocol?.schema}` };
  }
  if (!stages.includes(manifest.stage)) {
    return { ok: false, reason: `task stage ${manifest.stage ?? "UNKNOWN"} is not authorized for this action` };
  }
  if (!/^SERV-\d+$/.test(manifest.ticketFamily?.primary ?? "")) {
    return { ok: false, reason: "active task manifest must identify the primary SERV ticket" };
  }
  const shapeIssues = manifestShapeIssues(config, manifest);
  if (shapeIssues.length > 0) {
    return { ok: false, reason: `active task manifest is not valid: ${shapeIssues.join("; ")}` };
  }

  if (boundary?.requireCurrentApproval && manifest.approval?.required !== true) {
    return { ok: false, reason: "backend automation requires current digest-bound human approval" };
  }
  if (manifest.approval?.required) {
    const fields = protocol?.approval?.boundFields ?? [];
    const current = approvalDigest(manifest, fields);
    if (!manifest.approval.approvedDigest || manifest.approval.approvedDigest !== current) {
      return { ok: false, reason: "active task approval is missing or stale" };
    }
    const gateBlock = humanApprovalBlock(manifest, config);
    if (gateBlock) return { ok: false, reason: gateBlock.reason };
  } else if (!["planned", "approved", "implementing", "verified"].includes(manifest.stage)) {
    return { ok: false, reason: "an unapproved task may act only from planned, approved, implementing, or verified stage" };
  }
  return { ok: true, manifest, source };
}

function repositorySelection(manifest, repositoryId) {
  return (manifest.grounding?.repositories ?? []).find((repo) => repo.id === repositoryId);
}

function repositoryChangePaths(manifest, repositoryId) {
  return (manifest.plan?.changeUnits ?? [])
    .filter((unit) => unit.repoId === repositoryId)
    .flatMap((unit) => unit.paths ?? []);
}

export function automationRepositoryFor({ filePath = "", cwd = "", command = "", config }) {
  const repositories = config.engineering?.harness?.boundaries?.automationSource?.repositories ?? {};
  const candidates = [filePath, cwd, command].map(normalizePath);
  for (const [id, policy] of Object.entries(repositories)) {
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const repositorySegment = new RegExp(`(?:^|/)${escapedId}(?:/|$)`, "i");
    const configuredPattern = new RegExp(policy.pathPattern, "i");
    if (candidates.some((candidate) =>
      repositorySegment.test(candidate) || configuredPattern.test(candidate))) {
      return { id, policy };
    }
  }
  return null;
}

export function authorizeAutomationWrite({ filePath, cwd, config, env = process.env }) {
  const repository = automationRepositoryFor({ filePath, cwd, config });
  if (!repository) return { applies: false, allowed: true };

  const relative = backendRelativePath(filePath, cwd, repository.id);
  if (!relative || !safeRelative(relative)) {
    return { applies: true, allowed: false, reason: "backend automation write path cannot be resolved safely" };
  }
  if (!(repository.policy.allowedWriteRoots ?? []).some((root) => containsPath(relative, root))) {
    return { applies: true, allowed: false, reason: `backend automation path is outside allowed roots: ${relative}` };
  }
  if ((repository.policy.deniedWritePatterns ?? []).some((source) => new RegExp(source, "i").test(relative))) {
    return { applies: true, allowed: false, reason: `backend automation path is protected: ${relative}` };
  }

  const task = activeTask(config, env, repository.policy.writeStages ?? []);
  if (!task.ok) return { applies: true, allowed: false, reason: task.reason };
  const selected = repositorySelection(task.manifest, repository.id);
  if (!selected || !(selected.selectedPaths ?? []).some((item) => containsPath(relative, item))) {
    return { applies: true, allowed: false, reason: `path is outside grounding.repositories.selectedPaths: ${relative}` };
  }
  const plannedPaths = repositoryChangePaths(task.manifest, repository.id);
  if (!plannedPaths.some((item) => containsPath(relative, item))) {
    return { applies: true, allowed: false, reason: `path is outside plan.changeUnits paths: ${relative}` };
  }
  const revision = verifyRepositoryRevision({
    filePath,
    cwd,
    repositoryId: repository.id,
    expectedSha: selected.headSha,
  });
  if (!revision.ok) return { applies: true, allowed: false, reason: revision.reason };
  return {
    applies: true,
    allowed: true,
    relative,
    repositoryRoot: revision.root,
    manifest: task.manifest,
    manifestPath: task.source,
  };
}

export function authorizeAutomationRun({ command, cwd, config, env = process.env }) {
  const repository = automationRepositoryFor({ command, cwd, config });
  if (!repository) return { applies: false, allowed: true };
  const trimmed = String(command ?? "").trim();
  if (/[;&|><`]|\$\(/.test(trimmed)) {
    return { applies: true, allowed: false, reason: "backend pytest command must be one unchained command without redirection" };
  }
  if (/\b(?:install|add|remove|update|commit|push|merge|rebase|upload|publish|testrail|production|prod)\b/i.test(trimmed)) {
    return { applies: true, allowed: false, reason: "dependency, publication, upload, and production operations are not authorized" };
  }
  const lower = trimmed.toLowerCase();
  const colonSuffixPrefixes = new Set(
    (repository.policy.allowedColonSuffixPrefixes ?? [])
      .map((candidate) => String(candidate ?? "").toLowerCase())
      .filter(Boolean),
  );
  const prefix = (repository.policy.allowedRunPrefixes ?? []).find((candidate) => {
    const allowed = String(candidate ?? "").toLowerCase();
    if (!allowed) return false;
    return lower === allowed
      || lower.startsWith(`${allowed} `)
      || (colonSuffixPrefixes.has(allowed) && lower.startsWith(`${allowed}:`));
  });
  if (!prefix) {
    return { applies: true, allowed: false, reason: "only configured backend pytest commands are executable" };
  }

  const task = activeTask(config, env, repository.policy.runStages ?? []);
  if (!task.ok) return { applies: true, allowed: false, reason: task.reason };
  const selected = repositorySelection(task.manifest, repository.id);
  if (!selected) return { applies: true, allowed: false, reason: "backend automation repository is not selected by the active task" };

  const tests = (task.manifest.plan?.tests ?? []).filter((test) =>
    test.repoId === repository.id
    && test.runnerId === repository.policy.requiredRunner
    && safeRelative(test.path)
    && (repository.policy.allowedEnvironments ?? []).includes(test.environment));
  const normalizedCommand = normalizePath(trimmed).toLowerCase();
  const selectedTest = tests.find((test) => normalizedCommand.includes(normalizePath(test.path).toLowerCase()));
  if (!selectedTest) {
    return {
      applies: true,
      allowed: false,
      reason: "pytest command must include an exact active-manifest test path and allowed non-production environment",
    };
  }
  if (!(selected.selectedPaths ?? []).some((item) => containsPath(selectedTest.path, item))) {
    return { applies: true, allowed: false, reason: "selected pytest path is outside grounded backend paths" };
  }
  const revision = verifyRepositoryRevision({
    cwd,
    repositoryId: repository.id,
    expectedSha: selected.headSha,
  });
  if (!revision.ok) return { applies: true, allowed: false, reason: revision.reason };
  return {
    applies: true,
    allowed: true,
    test: selectedTest,
    repositoryRoot: revision.root,
    manifest: task.manifest,
    manifestPath: task.source,
  };
}
