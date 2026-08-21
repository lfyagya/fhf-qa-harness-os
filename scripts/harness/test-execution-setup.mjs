import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import http from "node:http";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "execution-setup.mjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fhf-execution-setup-"));
const root = path.join(temp, "e2e");
const packageRoot = path.join(root, "CypressFHF", "fhf-dashboards");
const consumerRoot = path.join(temp, "FHF");
const specsRoot = path.join(temp, "specs");
const dependencySource = path.join(temp, "runtime", "node_modules");
const cypressEnvSource = path.join(temp, "secrets", "cypress.env.json");
const npmrcSource = path.join(temp, "secrets", ".npmrc");

function write(file, content = "ok\n") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

// execution-setup.mjs resolves its worktree from CLAUDE_PROJECT_DIR / CURSOR_PROJECT_DIR before
// falling back to cwd. Those are always set inside a real Claude Code or Cursor session, so an
// inherited value pointed the child at the developer's workspace instead of this fixture and the
// lane read as "root" — the test only passed outside an agent session. Strip them, like the
// GIT_* isolation in test-hooks.mjs.
const isolatedEnv = { ...process.env };
for (const key of ["CLAUDE_PROJECT_DIR", "CURSOR_PROJECT_DIR"]) delete isolatedEnv[key];

function command(commandName, args, cwd = root) {
  return new Promise((resolve) => {
    const child = spawn(commandName, args, { cwd, env: isolatedEnv });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const server = http.createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("ready\n");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();

try {
  write(path.join(root, ".harness", "lane.json"), JSON.stringify({ lane: "e2e" }));
  write(path.join(root, ".harness", "verify.mjs"), "process.exit(0);\n");
  write(path.join(root, ".claude", "harness.config.json"), JSON.stringify({
    paths: { lanes: { e2e: { branch: "dev", package: "CypressFHF/fhf-dashboards" } } },
  }));
  write(path.join(root, ".gitignore"), "CypressFHF/fhf-dashboards/cypress.env.json\nCypressFHF/fhf-dashboards/.npmrc\n");
  fs.mkdirSync(packageRoot, { recursive: true });
  write(path.join(dependencySource, "cypress", "bin", "cypress"));
  write(cypressEnvSource, "opaque\n");
  write(npmrcSource, "opaque\n");
  fs.mkdirSync(consumerRoot, { recursive: true });
  fs.mkdirSync(specsRoot, { recursive: true });

  assert.equal((await command("git", ["init", "-b", "dev"])).status, 0);
  assert.equal((await command("git", ["add", "."])).status, 0);
  assert.equal((await command("git", ["-c", "user.name=Harness", "-c", "user.email=harness@example.invalid", "commit", "-m", "fixture"])).status, 0);

  const profile = path.join(temp, "execution.local.json");
  write(profile, JSON.stringify({
    schema: "fhf-harness/execution-profile/v1",
    lane: "e2e",
    baseUrl: `http://127.0.0.1:${address.port}`,
    workspace: { consumerRoot, moduleSpecsRoot: specsRoot },
    dependencySource,
    credentials: { cypressEnv: cypressEnvSource, npmrc: npmrcSource },
    optional: { cypressCloud: true },
  }));
  const prepared = await command(process.execPath, [script, "--profile", profile, "--mode", "cloud"]);
  assert.equal(prepared.status, 0, `${prepared.stdout}\n${prepared.stderr}`);
  assert.match(prepared.stdout, /Execution-ready: e2e \/ cloud/);
  assert.equal(fs.readFileSync(path.join(packageRoot, "cypress.env.json"), "utf8"), "opaque\n");
  assert.equal(fs.readFileSync(path.join(packageRoot, ".npmrc"), "utf8"), "opaque\n");
  assert.equal(fs.existsSync(path.join(packageRoot, "node_modules", "cypress", "bin", "cypress")), true);

  const mismatch = { ...JSON.parse(fs.readFileSync(profile, "utf8")), lane: "smoke" };
  write(profile, JSON.stringify(mismatch));
  const rejected = await command(process.execPath, [script, "--profile", profile, "--mode", "local"]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /does not match/);
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log("execution setup tests passed");
