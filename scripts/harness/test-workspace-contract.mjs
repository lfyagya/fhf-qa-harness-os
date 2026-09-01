import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectLane } from "../../.claude/hooks/lib/harness-config.mjs";
import { formatWorkspacePreflight, workspacePreflight } from "../../.claude/hooks/lib/workspace-contract.mjs";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fhf-workspace-contract-"));
const smoke = path.join(temp, "smoke");
const workspace = path.join(temp, "FHF");
const specs = path.join(temp, "Test-Case-Automation-Using-Claude-Agents");

function write(file, content = "ok\n") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

try {
  for (const file of [
    path.join(smoke, ".harness", "lane.json"),
    path.join(smoke, ".claude", "settings.json"),
    path.join(smoke, ".cursor", "hooks.json"),
    path.join(smoke, ".gitignore"),
    path.join(smoke, "CLAUDE.md"),
    path.join(smoke, "AGENTS.md"),
    path.join(smoke, "CypressFHF", "fhf-dashboards", "CLAUDE.md"),
    path.join(smoke, "docs", "framework", "testing-standards", "TESTS.md"),
    path.join(smoke, "docs", "framework", "execution-strategy.md"),
    path.join(smoke, "docs", "framework", "triage-runbook.md"),
    path.join(workspace, "CLAUDE.md"),
    path.join(workspace, "AGENTS.md"),
    path.join(specs, "specs", "modules", "insurance", "total-loss.yaml"),
  ]) write(file);
  write(path.join(smoke, ".harness", "lane.json"), JSON.stringify({ lane: "smoke" }));
  fs.mkdirSync(path.join(smoke, "CypressFHF", "fhf-dashboards", "cypress", "tests", "fhf-dashboard", "smoke"), { recursive: true });
  write(
    path.join(smoke, ".harness", "workspace.local.json"),
    JSON.stringify({ consumerRoot: workspace, moduleSpecsRoot: specs, smokeRoot: smoke, optional: {} }),
  );

  const config = {
    paths: { lanes: { smoke: { branch: "" } } },
    moduleSpecPaths: {
      insurance: ["Test-Case-Automation-Using-Claude-Agents/specs/modules/insurance/total-loss.yaml"],
    },
    workspaceContract: {
      setupFile: ".harness/workspace.local.json",
      setupExample: ".harness/workspace.example.json",
      setupCommand: "node .harness/setup.mjs",
      lanes: {
        smoke: {
          required: true,
          requireBranch: false,
          moduleSpecsPathPrefix: "Test-Case-Automation-Using-Claude-Agents",
          requiredInputs: [
            { field: "consumerRoot", label: "FHF workspace root" },
            { field: "moduleSpecsRoot", label: "Application specs repository root" },
            { field: "smokeRoot", label: "Smoke repository root" },
          ],
          requiredLocalPaths: [
            { path: ".claude/settings.json", type: "file" },
            { path: ".cursor/hooks.json", type: "file" },
            { path: ".gitignore", type: "file" },
            { path: "CLAUDE.md", type: "file" },
            { path: "AGENTS.md", type: "file" },
            { path: "CypressFHF/fhf-dashboards/CLAUDE.md", type: "file" },
            { path: "CypressFHF/fhf-dashboards", type: "directory" },
            { path: "CypressFHF/fhf-dashboards/cypress/tests/fhf-dashboard/smoke", type: "directory" },
            { path: "docs/framework/testing-standards/TESTS.md", type: "file" },
            { path: "docs/framework/execution-strategy.md", type: "file" },
            { path: "docs/framework/triage-runbook.md", type: "file" },
          ],
          requiredWorkspacePaths: [
            { field: "consumerRoot", path: "CLAUDE.md", type: "file", label: "FHF workspace instructions" },
            { field: "consumerRoot", path: "AGENTS.md", type: "file", label: "FHF workspace agent roster" },
            { field: "moduleSpecsRoot", path: "specs", type: "directory", label: "Application specification directory" },
          ],
        },
      },
    },
  };

  const ready = workspacePreflight({ root: smoke, config });
  assert.equal(ready.ready, true, ready.issues.join("\n"));

  const root = path.join(temp, "root");
  write(path.join(root, ".harness", "lane.json"), JSON.stringify({ lane: "root" }));
  write(path.join(root, ".claude", "harness.config.json"), "{}\n");
  assert.equal(
    detectLane(root, { paths: { lanes: { e2e: {}, smoke: {} } } }),
    "root",
  );

  write(path.join(smoke, ".claude", "harness.config.json"), "{}\n");
  fs.rmSync(path.join(smoke, ".harness", "lane.json"));
  const missingLane = workspacePreflight({ root: smoke, config });
  assert.equal(missingLane.ready, false);
  assert.match(missingLane.issues.join("\n"), /lane\.json must declare/);
  write(path.join(smoke, ".harness", "lane.json"), JSON.stringify({ lane: "smoke" }));

  const setupFile = path.join(smoke, ".harness", "workspace.local.json");
  fs.rmSync(setupFile);
  const environment = {
    FHF_CONSUMER_ROOT: process.env.FHF_CONSUMER_ROOT,
    FHF_MODULE_SPECS_ROOT: process.env.FHF_MODULE_SPECS_ROOT,
    FHF_SMOKE_ROOT: process.env.FHF_SMOKE_ROOT,
  };
  process.env.FHF_CONSUMER_ROOT = workspace;
  process.env.FHF_MODULE_SPECS_ROOT = specs;
  process.env.FHF_SMOKE_ROOT = smoke;
  const envOnly = workspacePreflight({ root: smoke, config });
  assert.equal(envOnly.ready, true, envOnly.issues.join("\n"));
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  write(
    setupFile,
    JSON.stringify({ consumerRoot: workspace, moduleSpecsRoot: specs, smokeRoot: smoke, optional: {} }),
  );

  const incompleteConfig = workspacePreflight({
    root: smoke,
    config: { paths: { lanes: { smoke: {} } } },
  });
  assert.equal(incompleteConfig.ready, false);
  assert.match(incompleteConfig.issues.join("\n"), /workspaceContract\.lanes\.smoke is missing/);
  assert.match(formatWorkspacePreflight(incompleteConfig, { }), /node \.harness[\\/]setup\.mjs/);

  fs.rmSync(path.join(specs, "specs", "modules", "insurance", "total-loss.yaml"));
  const missingSpec = workspacePreflight({ root: smoke, config });
  assert.equal(missingSpec.ready, false);
  assert.match(missingSpec.issues.join("\n"), /Missing application spec for insurance/);

  fs.rmSync(path.join(smoke, ".harness", "workspace.local.json"));
  const missingSetup = workspacePreflight({ root: smoke, config });
  assert.equal(missingSetup.ready, false);
  assert.match(missingSetup.issues.join("\n"), /Workspace setup is required/);

  const e2e = path.join(temp, "e2e");
  for (const file of [
    path.join(e2e, ".claude", "settings.json"),
    path.join(e2e, ".cursor", "hooks.json"),
    path.join(e2e, ".gitignore"),
    path.join(e2e, "CLAUDE.md"),
    path.join(e2e, "AGENTS.md"),
    path.join(e2e, "CypressFHF", "fhf-dashboards", "CLAUDE.md"),
    path.join(e2e, "docs", "framework", "testing-strategy.md"),
    path.join(e2e, "docs", "framework", "framework-standards.md"),
    path.join(e2e, "docs", "README.md"),
  ]) write(file);
  write(path.join(e2e, ".harness", "lane.json"), JSON.stringify({ lane: "e2e" }));
  fs.mkdirSync(path.join(e2e, "CypressFHF", "fhf-dashboards", "cypress", "tests", "fhf-dashboard", "e2e"), { recursive: true });
  write(path.join(specs, "specs", "modules", "insurance", "total-loss.yaml"));
  write(
    path.join(e2e, ".harness", "workspace.local.json"),
    JSON.stringify({ consumerRoot: workspace, moduleSpecsRoot: specs, e2eRoot: e2e, optional: {} }),
  );
  const e2eConfig = {
    ...config,
    workspaceContract: {
      ...config.workspaceContract,
      lanes: {
        ...config.workspaceContract.lanes,
        e2e: {
          required: true,
          requireBranch: false,
          moduleSpecsPathPrefix: "Test-Case-Automation-Using-Claude-Agents",
          requiredInputs: [
            { field: "consumerRoot", label: "FHF workspace root" },
            { field: "moduleSpecsRoot", label: "Application specs repository root" },
            { field: "e2eRoot", label: "E2E repository root" },
          ],
          requiredLocalPaths: [
            { path: ".claude/settings.json", type: "file" },
            { path: ".cursor/hooks.json", type: "file" },
            { path: ".gitignore", type: "file" },
            { path: "CLAUDE.md", type: "file" },
            { path: "AGENTS.md", type: "file" },
            { path: "CypressFHF/fhf-dashboards/CLAUDE.md", type: "file" },
            { path: "CypressFHF/fhf-dashboards", type: "directory" },
            { path: "CypressFHF/fhf-dashboards/cypress/tests/fhf-dashboard/e2e", type: "directory" },
            { path: "docs/framework/testing-strategy.md", type: "file" },
            { path: "docs/framework/framework-standards.md", type: "file" },
            { path: "docs/README.md", type: "file" },
          ],
          requiredWorkspacePaths: config.workspaceContract.lanes.smoke.requiredWorkspacePaths,
        },
      },
    },
  };
  const e2eReady = workspacePreflight({ root: e2e, config: e2eConfig });
  assert.equal(e2eReady.ready, true, e2eReady.issues.join("\n"));

  const incompleteE2e = workspacePreflight({
    root: e2e,
    config: { paths: { lanes: { e2e: {} } } },
  });
  assert.equal(incompleteE2e.ready, false);
  assert.match(incompleteE2e.issues.join("\n"), /workspaceContract\.lanes\.e2e is missing/);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

// Letters (fhf-letters: generation and delivery, RISC) and Letter Tracking are different
// modules. They were conflated in config once - one alias list and one spec path - which routed
// Letters work at a Letter Tracking spec. Assert the split so it cannot quietly come back.
const controlPlane = JSON.parse(fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "..", "config", "qa-control-plane.json"), "utf8"));
const aliases = controlPlane.moduleAliases;
const specPaths = controlPlane.moduleSpecPaths;

assert.ok(!aliases.letters.includes("letter tracking"),
  "Letters must not alias Letter Tracking: they are separate modules");
assert.deepEqual(aliases["letter-tracking"], ["letter tracking"],
  "Letter Tracking needs its own alias entry");
assert.ok(aliases.letters.includes("risc letter"),
  "RISC letters belong to Letters - the generator lives in fhf-letters");

for (const [module, targets] of Object.entries(specPaths)) {
  const foreign = (targets ?? []).filter((target) => target.includes("/letter-tracking/") && module !== "letter-tracking");
  assert.equal(foreign.length, 0,
    `${module} must not claim a Letter Tracking spec: ${foreign.join(", ")}`);
}

console.log("workspace contract tests passed");
