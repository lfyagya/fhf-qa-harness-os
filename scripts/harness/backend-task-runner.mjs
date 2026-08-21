#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  approvalState,
  validateTaskManifest,
} from "./task-protocol-lib.mjs";

const RUNNER_ID = "backend-api-oracle";
const REPOSITORY_ID = "fhf-backend-automation";
const ENVIRONMENT_ENV = "FHF_BACKEND_ENVIRONMENT";

function fail(message) {
  throw new Error(message);
}

function normalizedPath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+/g, "/");
}

function containsPath(candidate, selected) {
  const current = normalizedPath(candidate).toLowerCase();
  const parent = normalizedPath(selected).replace(/\/+$/, "").toLowerCase();
  return current === parent || current.startsWith(`${parent}/`);
}

function parseArgs(argv) {
  const [action, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith("--")) fail(`unexpected argument: ${key}`);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) fail(`missing value for ${key}`);
    options[key.slice(2)] = value;
    index += 1;
  }
  if (!['preflight', 'run'].includes(action)) {
    fail("usage: backend-task-runner.mjs <preflight|run> --manifest <absolute-path> --test-id <id> [--python <absolute-path>]");
  }
  return { action, options };
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${label} is unavailable or invalid: ${error.message}`);
  }
}

function runGit(repositoryRoot, args) {
  const result = spawnSync(
    "git",
    ["-c", `safe.directory=${normalizedPath(repositoryRoot)}`, "-C", repositoryRoot, ...args],
    { encoding: "utf8", timeout: 10000 },
  );
  if (result.status !== 0) fail(`git ${args.join(" ")} failed for ${REPOSITORY_ID}`);
  return result.stdout;
}

function changedPaths(repositoryRoot) {
  const output = runGit(repositoryRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const records = output.split("\0").filter(Boolean);
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const status = record.slice(0, 2);
    paths.push(normalizedPath(record.slice(3)));
    if (/[RC]/.test(status) && records[index + 1]) {
      paths.push(normalizedPath(records[index + 1]));
      index += 1;
    }
  }
  return [...new Set(paths)];
}

function resolvePython(repositoryRoot, explicitPython) {
  if (explicitPython) {
    if (!path.isAbsolute(explicitPython) || !fs.existsSync(explicitPython)) {
      fail("--python must be an existing absolute interpreter path");
    }
    return explicitPython;
  }
  const candidates = process.platform === "win32"
    ? [".venv/Scripts/python.exe", "venv/Scripts/python.exe"]
    : [".venv/bin/python", "venv/bin/python"];
  const existing = candidates.map((candidate) => path.join(repositoryRoot, candidate)).find(fs.existsSync);
  return existing ?? "python";
}

function junitCounts(xml) {
  const suite = xml.match(/<testsuite\b([^>]*)>/i);
  if (!suite) fail("JUnit artifact does not contain a testsuite");
  const attributes = Object.fromEntries(
    [...suite[1].matchAll(/([A-Za-z_][\w.-]*)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
  );
  const integer = (name) => Number.parseInt(attributes[name] ?? "0", 10);
  return {
    tests: integer("tests"),
    failures: integer("failures"),
    errors: integer("errors"),
    skipped: integer("skipped"),
  };
}

function fileDigest(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function buildBackendRunPlan({
  root = process.cwd(),
  manifestPath,
  testId,
  explicitPython,
  env = process.env,
} = {}) {
  if (!manifestPath || !path.isAbsolute(manifestPath)) fail("--manifest must be an absolute path");
  if (!testId) fail("--test-id is required");

  const configPath = path.join(root, ".claude", "harness.config.json");
  const config = readJson(configPath, "harness configuration");
  const manifest = readJson(manifestPath, "task manifest");
  const activeEnv = config.engineering?.taskProtocol?.activeManifestEnv;
  if (!activeEnv || path.resolve(env[activeEnv] ?? "") !== path.resolve(manifestPath)) {
    fail(`${activeEnv ?? "FHF_ACTIVE_TASK"} must match --manifest`);
  }

  const runners = config.engineering?.executionRunners?.runners ?? {};
  const issues = validateTaskManifest(manifest, {
    repoIds: Object.keys(config.productTopology?.repositories ?? {}),
    runnerIds: Object.keys(runners),
    runners,
    executionBudget: config.engineering?.taskProtocol?.executionBudget,
    capabilityControl: config.engineering?.capabilityControl,
  });
  if (issues.length > 0) fail(`task manifest is invalid: ${issues.join("; ")}`);
  if (manifest.grounding.catalogVersion !== config.productTopology.catalogVersion) {
    fail("task manifest product-topology catalog version is stale");
  }
  if (!["implementing", "verified"].includes(manifest.stage)) {
    fail(`task stage ${manifest.stage} does not allow backend execution`);
  }
  if (manifest.approval?.required !== true || approvalState(manifest).state !== "current") {
    fail("backend execution requires current digest-bound human approval");
  }

  const test = (manifest.plan.tests ?? []).find((candidate) => candidate.id === testId);
  if (!test) fail(`test is not selected by the manifest: ${testId}`);
  if (test.runnerId !== RUNNER_ID || test.repoId !== REPOSITORY_ID) {
    fail(`${testId} must use ${RUNNER_ID} in ${REPOSITORY_ID}`);
  }
  if (!runners[RUNNER_ID]?.environments?.includes(test.environment)) {
    fail(`backend environment is not allowed: ${test.environment}`);
  }
  if (env[ENVIRONMENT_ENV] !== test.environment) {
    fail(`${ENVIRONMENT_ENV} must equal the manifest environment ${test.environment}`);
  }

  const repositoryConfig = config.productTopology.repositories[REPOSITORY_ID];
  const repositoryRoot = path.resolve(root, repositoryConfig.root);
  const selectedRepository = (manifest.grounding.repositories ?? [])
    .find((repository) => repository.id === REPOSITORY_ID);
  if (!selectedRepository) fail(`${REPOSITORY_ID} is not grounded by the manifest`);
  if (!(selectedRepository.selectedPaths ?? []).some((selected) => containsPath(test.path, selected))) {
    fail("selected test path is outside grounded backend paths");
  }
  const plannedPaths = (manifest.plan.changeUnits ?? [])
    .filter((unit) => unit.repoId === REPOSITORY_ID)
    .flatMap((unit) => unit.paths ?? []);
  if (!plannedPaths.some((selected) => containsPath(test.path, selected))) {
    fail("selected test path is outside planned backend change units");
  }

  const testFile = path.join(repositoryRoot, test.path.split("::", 1)[0]);
  if (!fs.existsSync(testFile)) fail(`selected backend test path does not exist: ${test.path}`);
  const actualRevision = runGit(repositoryRoot, ["rev-parse", "HEAD"]).trim().toLowerCase();
  if (actualRevision !== selectedRepository.headSha.toLowerCase()) {
    fail(`backend revision changed: manifest=${selectedRepository.headSha} actual=${actualRevision}`);
  }

  const dirtyPaths = changedPaths(repositoryRoot);
  const outsidePlan = dirtyPaths.filter((candidate) =>
    !plannedPaths.some((selected) => containsPath(candidate, selected)));
  if (outsidePlan.length > 0) {
    fail(`backend worktree has changes outside the task plan: ${outsidePlan.join(", ")}`);
  }

  const requiredLocalFiles = ["tests/.env", "config/config.ini"];
  const missingLocalFiles = requiredLocalFiles.filter((candidate) =>
    !fs.existsSync(path.join(repositoryRoot, candidate)));
  if (missingLocalFiles.length > 0) {
    fail(`backend execution prerequisites are missing: ${missingLocalFiles.join(", ")}`);
  }

  const reportRelative = config.paths?.automationLanes?.backend?.execution?.junit
    ?? "reports/junit-report.xml";
  return {
    schema: "fhf-harness/backend-run-plan/v1",
    manifest,
    manifestPath,
    test,
    repositoryRoot,
    revision: actualRevision,
    environment: test.environment,
    python: resolvePython(repositoryRoot, explicitPython),
    pytestArgs: ["-m", "pytest", test.path, "--dist=no", `--junitxml=${reportRelative}`],
    artifact: reportRelative,
    artifactPath: path.join(repositoryRoot, reportRelative),
    dirtyPathCount: dirtyPaths.length,
  };
}

function publicPlan(plan) {
  return {
    schema: plan.schema,
    manifest: plan.manifestPath,
    testId: plan.test.id,
    testPath: plan.test.path,
    runnerId: plan.test.runnerId,
    repository: plan.test.repoId,
    revision: plan.revision,
    environment: plan.environment,
    python: plan.python,
    pytestArgs: plan.pytestArgs,
    artifact: plan.artifact,
    dirtyPathCount: plan.dirtyPathCount,
    externalUpload: false,
    parallelism: "sequential",
  };
}

function execute(plan) {
  const before = fs.existsSync(plan.artifactPath) ? fs.statSync(plan.artifactPath).mtimeMs : null;
  const startedAt = Date.now();
  const result = spawnSync(plan.python, plan.pytestArgs, {
    cwd: plan.repositoryRoot,
    env: { ...process.env, [ENVIRONMENT_ENV]: plan.environment },
    stdio: "inherit",
  });
  if (result.error) fail(`pytest could not start: ${result.error.message}`);
  if (!fs.existsSync(plan.artifactPath)) fail("pytest did not produce the configured JUnit artifact");
  const after = fs.statSync(plan.artifactPath).mtimeMs;
  if (before !== null && after === before && after < startedAt - 1000) {
    fail("JUnit artifact was not refreshed by this execution");
  }

  const counts = junitCounts(fs.readFileSync(plan.artifactPath, "utf8"));
  const passed = result.status === 0 && counts.tests > 0 && counts.failures === 0 && counts.errors === 0;
  const evidence = {
    schema: "fhf-harness/test-evidence/v1",
    testId: plan.test.id,
    runnerId: plan.test.runnerId,
    proofMode: plan.test.proofMode,
    result: passed ? "passed" : "failed",
    testPath: plan.test.path,
    revision: plan.revision,
    environment: plan.environment,
    artifact: plan.artifact,
    artifactDigest: fileDigest(plan.artifactPath),
    counts,
    completedAt: new Date().toISOString(),
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  return passed ? 0 : (result.status || 1);
}

function main() {
  try {
    const { action, options } = parseArgs(process.argv.slice(2));
    const plan = buildBackendRunPlan({
      manifestPath: options.manifest,
      testId: options["test-id"],
      explicitPython: options.python,
    });
    if (action === "preflight") {
      process.stdout.write(`${JSON.stringify(publicPlan(plan), null, 2)}\n`);
      return 0;
    }
    return execute(plan);
  } catch (error) {
    process.stderr.write(`Backend task runner blocked: ${error.message}\n`);
    return 2;
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
