#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(process.env.CLAUDE_PROJECT_DIR ?? process.env.CURSOR_PROJECT_DIR ?? process.cwd());
const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const profileArg = valueAfter("--profile");
const mode = valueAfter("--mode") ?? "local";

function fail(message) {
  console.error(`Execution setup blocked: ${message}`);
  process.exit(2);
}

if (!profileArg || !["local", "cloud"].includes(mode)) {
  fail("usage: node .harness/prepare-execution.mjs --profile <external-profile.json> --mode <local|cloud>");
}

const laneFile = path.join(root, ".harness", "lane.json");
let lane;
try {
  lane = JSON.parse(fs.readFileSync(laneFile, "utf8")).lane;
} catch {
  fail(".harness/lane.json is missing or invalid");
}
if (!["e2e", "smoke"].includes(lane)) fail("only E2E and Smoke lanes can be prepared for execution");

const profilePath = path.resolve(root, profileArg);
if (profilePath === root || profilePath.startsWith(`${root}${path.sep}`)) {
  fail("the execution profile must be outside the worktree so it cannot be accidentally committed");
}
let profile;
try {
  profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
} catch (error) {
  fail(`cannot read the named execution profile: ${error.message}`);
}
if (profile?.schema !== "fhf-harness/execution-profile/v1") fail("profile schema must be fhf-harness/execution-profile/v1");
if (profile.lane !== lane) fail(`profile lane ${JSON.stringify(profile.lane)} does not match this ${lane} worktree`);
if (!profile.workspace || typeof profile.workspace.consumerRoot !== "string" || typeof profile.workspace.moduleSpecsRoot !== "string") {
  fail("profile.workspace.consumerRoot and profile.workspace.moduleSpecsRoot are required local paths");
}
if (typeof profile.baseUrl !== "string" || !profile.baseUrl) fail("profile.baseUrl is required");
if (typeof profile.dependencySource !== "string" || !profile.dependencySource) fail("profile.dependencySource is required");
if (!profile.credentials || typeof profile.credentials.cypressEnv !== "string" || !profile.credentials.cypressEnv) {
  fail("profile.credentials.cypressEnv is required");
}
if (mode === "cloud" && (typeof profile.credentials.npmrc !== "string" || !profile.credentials.npmrc)) {
  fail("profile.credentials.npmrc is required for Cloud recording");
}

const configPath = path.join(root, ".claude", "harness.config.json");
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch (error) {
  fail(`cannot read generated harness config: ${error.message}`);
}
const laneConfig = config?.paths?.lanes?.[lane];
if (!laneConfig?.package || !laneConfig?.branch) fail(`generated config lacks package/branch metadata for ${lane}`);
const packageRelative = profile.packageRoot ?? laneConfig.package;
if (packageRelative !== laneConfig.package) fail(`profile packageRoot must match the configured ${lane} package`);
const packageRoot = path.resolve(root, packageRelative);
if (!fs.existsSync(packageRoot)) fail(`configured package directory is missing: ${packageRelative}`);

const branch = spawnSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" });
if (branch.status !== 0) fail("could not determine the current Git branch");
if (branch.stdout.trim() !== laneConfig.branch) {
  fail(`${lane} execution requires branch ${laneConfig.branch}; current branch is ${branch.stdout.trim() || "detached"}`);
}

function requirePath(value, label, kind) {
  const resolved = path.resolve(root, value);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    fail(`${label} is unavailable`);
  }
  if ((kind === "file" && !stat.isFile()) || (kind === "directory" && !stat.isDirectory())) fail(`${label} has the wrong type`);
  return resolved;
}

const consumerRoot = requirePath(profile.workspace.consumerRoot, "profile workspace consumerRoot", "directory");
const moduleSpecsRoot = requirePath(profile.workspace.moduleSpecsRoot, "profile workspace moduleSpecsRoot", "directory");
const dependencySource = requirePath(profile.dependencySource, "profile dependencySource", "directory");
const cypressEnvSource = requirePath(profile.credentials.cypressEnv, "profile credentials.cypressEnv", "file");
const npmrcSource = mode === "cloud" ? requirePath(profile.credentials.npmrc, "profile credentials.npmrc", "file") : null;
let targetUrl;
try {
  targetUrl = new URL(profile.baseUrl);
} catch {
  fail("profile.baseUrl must be an absolute URL");
}
if (!["http:", "https:"].includes(targetUrl.protocol) || targetUrl.username || targetUrl.password) {
  fail("profile.baseUrl must be an HTTP(S) URL without embedded credentials");
}
try {
  await fetch(targetUrl, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10000) });
} catch (error) {
  fail(`configured baseUrl is unreachable: ${error.cause?.code ?? error.message}`);
}

const workspaceTarget = path.join(root, ".harness", "workspace.local.json");
const workspace = {
  schema: "fhf-harness/workspace-setup/v1",
  lane,
  consumerRoot,
  moduleSpecsRoot,
  optional: profile.optional ?? {},
  [lane === "e2e" ? "e2eRoot" : "smokeRoot"]: root,
};
fs.mkdirSync(path.dirname(workspaceTarget), { recursive: true });
fs.writeFileSync(workspaceTarget, `${JSON.stringify(workspace, null, 2)}\n`, "utf8");

const nodeModules = path.join(packageRoot, "node_modules");
if (!fs.existsSync(nodeModules)) {
  try {
    fs.symlinkSync(dependencySource, nodeModules, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    fail(`could not create the dependency link: ${error.message}`);
  }
}

function ensureIgnored(relativeTarget) {
  const check = spawnSync("git", ["check-ignore", "-q", "--", relativeTarget], { cwd: root });
  if (check.status !== 0) fail(`${relativeTarget.replaceAll("\\", "/")} is not ignored; refusing to place credential material there`);
}

function copyCredential(source, target, label) {
  const relative = path.relative(root, target);
  ensureIgnored(relative);
  if (path.resolve(source) !== path.resolve(target)) fs.copyFileSync(source, target);
  console.log(`Prepared ${label} from the named profile source.`);
}

copyCredential(cypressEnvSource, path.join(packageRoot, "cypress.env.json"), "Cypress authentication configuration");
if (npmrcSource) copyCredential(npmrcSource, path.join(packageRoot, ".npmrc"), "Cloud recording configuration");

const cypressBin = path.join(packageRoot, "node_modules", "cypress", "bin", "cypress");
if (!fs.existsSync(cypressBin)) fail("Cypress is not available through the configured dependency runtime");
const verify = spawnSync(process.execPath, [path.join(root, ".harness", "verify.mjs")], { cwd: root, encoding: "utf8" });
if (verify.status !== 0) {
  process.stderr.write(verify.stdout);
  process.stderr.write(verify.stderr);
  fail("consumer harness verification failed");
}

console.log(`Execution-ready: ${lane} / ${mode}. No test was started.`);
