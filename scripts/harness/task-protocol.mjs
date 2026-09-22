#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  TASK_SCHEMA,
  approvalDigest,
  approvalState,
  gateState,
  nextStep,
  stampGate,
  validateTaskManifest,
} from "./task-protocol-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const command = args[0];

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function loadConfig() {
  const candidates = [
    process.env.FHF_HARNESS_CONFIG,
    path.resolve(HERE, "..", ".claude", "harness.config.json"),
    path.resolve(HERE, "..", "..", "config", "qa-control-plane.json"),
  ].filter(Boolean);
  const selected = candidates.find((candidate) => fs.existsSync(candidate));
  if (!selected) throw new Error(`Harness config not found. Checked: ${candidates.join(", ")}`);
  return JSON.parse(fs.readFileSync(selected, "utf8"));
}

function loadManifest() {
  const source = option("--manifest");
  if (!source) throw new Error("--manifest <task.json> is required");
  return JSON.parse(fs.readFileSync(path.resolve(source), "utf8"));
}

// ponytail: purpose-built reader for the three spec shapes this file needs, not a YAML parser.
// The spec repo is the application contract and is approval-gated for writes, so the harness
// reads it and never reshapes it to suit a parser. Upgrade path: a real YAML dependency if a
// fourth shape appears, or if any of these stop being flat and predictably indented.
function readSpecText(file) {
  return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

// test_scenario_groups: -> `- prefix: "..."` then `covers: [A, B]`, which may wrap across lines.
function specScenarioGroups(text) {
  // No /m: $ must mean end-of-input here, not end-of-line, or the section captures empty.
  const section = `\n${text}`.match(/\ntest_scenario_groups:\n([\s\S]*?)(?=\n[a-z_]+:|$)/);
  if (!section) return new Map();
  const groups = new Map();
  let current = null;
  const lines = section[1].split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const prefix = lines[i].match(/^\s*-\s*prefix:\s*(.+?)\s*$/);
    if (prefix) {
      current = prefix[1].replace(/^["']/, "").replace(/["']$/, "").trim();
      groups.set(current, new Set());
      continue;
    }
    const covers = lines[i].match(/^\s*covers:\s*\[(.*)$/);
    if (covers && current) {
      let body = covers[1];
      while (!body.includes("]") && i + 1 < lines.length) { i += 1; body += lines[i]; }
      for (const raw of body.replace(/\].*$/, "").split(",")) {
        const id = raw.trim().replace(/^["']/, "").replace(/["']$/, "");
        if (id) groups.get(current).add(id);
      }
    }
  }
  return groups;
}

// depends_on_components: -> block list of component keys.
function specComponents(text) {
  const section = text.match(/^depends_on_components:\n((?:\s*-\s*[^\n]+\n?)+)/m);
  if (!section) return [];
  return section[1].split("\n")
    .map((line) => line.match(/^\s*-\s*([^\s#]+)/)?.[1])
    .filter(Boolean);
}

// required_headers: -> block list of maps, each a name plus boolean properties.
function specRequiredHeaders(text) {
  const section = `\n${text}`.match(/\n\s*required_headers:\n([\s\S]*?)(?=\n\s{0,4}[a-z_]+:|$)/);
  if (!section) return null;
  const headers = [];
  for (const chunk of section[1].split(/^\s*-\s+(?=name:)/m)) {
    const name = chunk.match(/name:\s*(.+?)\s*$/m);
    if (!name) continue;
    const declared = new Set();
    for (const property of chunk.matchAll(/^\s*([a-z_]+):\s*(?:true|false)\s*$/gm)) declared.add(property[1]);
    headers.push({ name: name[1].replace(/^["']/, "").replace(/["']$/, ""), declared });
  }
  return headers;
}

function specRoot(config) {
  const relative = config.paths?.applicationIntelligence;
  if (!relative) return null;
  const repo = relative.split("/")[0];
  return [
    path.resolve(HERE, "..", repo),
    path.resolve(HERE, "..", "..", config.paths?.consumerRoot ?? "..", repo),
  ].find((candidate) => fs.existsSync(candidate)) ?? null;
}

// A sprint regression checklist is a flat list of `- id: <row>` scenarios. Distinct from the
// spec repo's grouped test_scenario_groups, and deliberately so: these are execution rows.
function checklistRowIds(text) {
  return new Set(
    [...text.matchAll(/^\s*-\s*id:\s*(.+?)\s*$/gm)]
      .map((match) => match[1].replace(/^["']/, "").replace(/["']$/, "").trim())
      .filter(Boolean),
  );
}

// Where a registry file can live: the spec repo, or any repository the manifest froze.
function registryRoots(manifest, config) {
  const roots = [];
  const spec = specRoot(config);
  if (spec) roots.push(spec);
  const repositories = config.productTopology?.repositories ?? {};
  for (const repository of manifest.grounding?.repositories ?? []) {
    const relative = repositories[repository.id]?.root;
    if (!relative) continue;
    const candidate = [
      path.resolve(HERE, "..", relative),
      path.resolve(HERE, "..", "..", config.paths?.consumerRoot ?? "..", relative),
    ].find((option) => fs.existsSync(option));
    if (candidate) roots.push(candidate);
  }
  return roots;
}

// Resolve every scenarioRef against the registry that owns it. Same skip rule as fixtures: a
// repository that is not checked out here cannot be judged.
function scenarioRefIssues(manifest, config) {
  const roots = registryRoots(manifest, config);
  if (roots.length === 0) return [];
  const issues = [];
  for (const test of manifest.plan?.tests ?? []) {
    const ref = test.scenarioRef;
    if (!ref?.source || !ref.group || !ref.registry) continue;
    const label = test.id ?? "test";
    const file = roots.map((root) => path.join(root, ref.source)).find((option) => fs.existsSync(option));
    if (!file) {
      issues.push(`${label}.scenarioRef registry file not found in any selected repository: ${ref.source}`);
      continue;
    }
    const text = readSpecText(file);
    if (ref.registry === "regression-checklist") {
      const rows = checklistRowIds(text);
      if (rows.size === 0) {
        issues.push(`${label}.scenarioRef cites ${ref.source}, which declares no checklist rows`);
      } else if (!rows.has(ref.group)) {
        issues.push(`${label}.scenarioRef.group "${ref.group}" is not a row in ${ref.source}`);
      }
      continue;
    }
    const groups = specScenarioGroups(text);
    if (groups.size === 0) {
      issues.push(`${label}.scenarioRef cites ${ref.source}, which declares no test_scenario_groups`);
      continue;
    }
    const covered = groups.get(ref.group);
    if (!covered) {
      issues.push(`${label}.scenarioRef.group "${ref.group}" is not a test_scenario_groups prefix in ${ref.source}`);
      continue;
    }
    for (const id of ref.covers ?? []) {
      if (!covered.has(id)) {
        issues.push(`${label}.scenarioRef.covers lists ${id}, which "${ref.group}" does not cover in ${ref.source}`);
      }
    }
  }
  return issues;
}
// data_population_rules: -> source_systems: -> `- name: <view>`
function specSourceSystems(text) {
  const rules = `\n${text}`.match(/\ndata_population_rules:\n([\s\S]*?)(?=\n[a-z_]+:|$)/);
  if (!rules) return [];
  const systems = rules[1].match(/^\s*source_systems:\n([\s\S]*?)(?=\n\s{0,2}[a-z_]+:|$)/m);
  if (!systems) return [];
  return [...systems[1].matchAll(/^\s*-\s*name:\s*(.+?)\s*$/gm)].map((match) => match[1]);
}

// Pinning a record means depending on that record existing. The spec has to say where such
// records come from: data_population_rules names the source systems and the eligibility rules
// that decide whether a row appears at all. A fixture key alone does not capture that.
function dataPopulationIssues(manifest, config) {
  const policy = config.engineering?.taskProtocol?.testCaseBinding?.testData;
  const root = specRoot(config);
  if (!policy?.requireSourceSystemsForPinnedFixtures || !root) return [];
  const issues = [];
  for (const test of manifest.plan?.tests ?? []) {
    if (!test.testData?.fixture) continue;
    const ref = test.scenarioRef;
    if (ref?.registry !== "spec-test-scenario-groups" || !ref.source) continue;
    const file = path.join(root, ref.source);
    if (!fs.existsSync(file)) continue;
    if (specSourceSystems(readSpecText(file)).length === 0) {
      issues.push(`${test.id ?? "test"} pins fixture key "${test.testData.key}" but ${ref.source} documents no data_population_rules.source_systems`);
    }
  }
  return issues;
}
// A module inheriting a component must document what that component requires, or the inherited
// test cases generate with the wrong assertion - the component contracts say so themselves.
// The property list lives in harness config, not the spec repo, because that repo is
// approval-gated: the harness may read the contract but must not add machine-readable fields to it.
function componentContractIssues(manifest, config) {
  const policy = config.engineering?.taskProtocol?.testCaseBinding?.componentContracts;
  const root = specRoot(config);
  if (!policy || !root) return [];
  const issues = [];
  const seen = new Set();
  for (const test of manifest.plan?.tests ?? []) {
    const ref = test.scenarioRef;
    if (ref?.registry !== "spec-test-scenario-groups") continue;
    const spec = ref.source;
    if (!spec || seen.has(spec)) continue;
    seen.add(spec);
    const file = path.join(root, spec);
    if (!fs.existsSync(file)) continue;
    const text = readSpecText(file);
    for (const component of specComponents(text)) {
      const rules = policy[component];
      if (!rules) continue;
      for (const section of rules.expectedModuleSections ?? []) {
        const leaf = section.split(".").pop();
        if (!new RegExp(`^\\s*${leaf}:`, "m").test(text)) {
          issues.push(`${spec} inherits ${component} but does not document ${section}`);
        }
      }
      const properties = rules.requiredHeaderProperties ?? [];
      if (properties.length === 0) continue;
      const headers = specRequiredHeaders(text);
      if (!headers) continue;
      for (const header of headers) {
        for (const property of properties) {
          if (!header.declared.has(property)) {
            issues.push(`${spec} required_headers "${header.name}" does not declare ${property} (${component} contract)`);
          }
        }
      }
    }
  }
  return issues;
}
// Structural testData checks live in the lib; existence needs the filesystem, so it lives here.
function fixtureIssues(manifest, config) {
  const repositories = config.productTopology?.repositories ?? {};
  const issues = [];
  for (const test of manifest.plan?.tests ?? []) {
    const data = test.testData;
    if (!data?.fixture || typeof data.none === "string") continue;
    const label = test.id ?? "test";
    const root = repositories[test.repoId]?.root;
    if (!root) {
      issues.push(`${label}.testData cannot resolve: repository ${test.repoId} has no configured root`);
      continue;
    }
    // Two run locations, same as loadConfig(): projected at <consumer>/.harness, and canonical
    // at <harness>/scripts/harness with the consumer tree alongside. Try both.
    const repoRoot = [
      path.resolve(HERE, "..", root),
      path.resolve(HERE, "..", "..", config.paths?.consumerRoot ?? "..", root),
    ].find((candidate) => fs.existsSync(candidate));
    // A repository that is not checked out here cannot be judged. Skip rather than block:
    // partial checkouts are normal (one lane cloned, not the meta-root), and a gate that
    // fires on absent siblings gets switched off. An absent file inside a PRESENT repo is
    // still a hard failure - that is the case this check exists for.
    if (!repoRoot) continue;
    const file = path.join(repoRoot, data.fixture);
    if (!fs.existsSync(file)) {
      issues.push(`${label}.testData fixture not found: ${root}/${data.fixture}`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      issues.push(`${label}.testData fixture is not readable JSON: ${error.message}`);
      continue;
    }
    // ponytail: key resolves at the top level or one level in (fixtures nest under "accounts" etc).
    const resolves = Object.hasOwn(parsed, data.key)
      || Object.values(parsed).some((group) =>
        group && typeof group === "object" && !Array.isArray(group) && Object.hasOwn(group, data.key));
    if (!resolves) issues.push(`${label}.testData key "${data.key}" is absent from ${root}/${data.fixture}`);
  }
  return issues;
}

function protocolOptions(config) {
  const runners = config.engineering?.executionRunners?.runners ?? {};
  return {
    repoIds: Object.keys(config.productTopology?.repositories ?? {}),
    bundleIds: Object.keys(config.productTopology?.sourceBundles ?? {}),
    bundles: config.productTopology?.sourceBundles ?? {},
    edges: config.productTopology?.edges ?? [],
    runnerIds: Object.keys(runners),
    runners,
    approvalFields: config.engineering?.taskProtocol?.approval?.boundFields,
    gates: config.engineering?.taskProtocol?.approval?.gates ?? [],
    legacySingleDigestSatisfies: config.engineering?.taskProtocol?.approval?.legacySingleDigestSatisfies ?? "plan",
    executionBudget: config.engineering?.taskProtocol?.executionBudget,
    crossRepositorySeam: config.engineering?.taskProtocol?.crossRepositorySeam,
    frontendTestData: config.qualityAssurance?.frontendTestData,
    capabilityControl: config.engineering?.capabilityControl,
    projectKeys: config.atlassian?.projectKeys ?? [config.atlassian?.projectKey].filter(Boolean),
  };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function isAgentProcess() {
  return Boolean(process.env.CLAUDECODE || process.env.CLAUDE_CODE || process.env.CURSOR_AGENT);
}

function gitUserName() {
  const result = spawnSync("git", ["config", "user.name"], { encoding: "utf8" });
  const name = result.stdout?.trim();
  if (!name) throw new Error("git config user.name is empty; set it before approving");
  return name;
}

function gateReport(manifest, options) {
  return (options.gates ?? []).map((gate) => ({
    id: gate.id,
    label: gate.label ?? gate.id,
    ...gateState(manifest, gate, {
      approvalFields: options.approvalFields,
      legacyGateId: options.legacySingleDigestSatisfies,
    }),
  }));
}

async function readPipedLine() {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk;
      if (buffer.includes("\n")) {
        cleanup();
        resolve(buffer.split("\n")[0]);
      }
    };
    const onEnd = () => {
      cleanup();
      if (buffer.length) resolve(buffer);
      else reject(new Error("no confirmation given"));
    };
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
  });
}

async function confirmYes(question) {
  if (isAgentProcess()) {
    throw new Error("approval needs a human at a terminal. Agents cannot approve.");
  }
  if (process.stdin.isTTY === true) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question(question);
      return /^\s*y(es)?\s*$/i.test(answer);
    } finally {
      rl.close();
    }
  }
  const answer = await readPipedLine();
  return /^\s*y(es)?\s*$/i.test(answer);
}

async function approveCommand(options) {
  const gateId = option("--gate");
  const gates = options.gates ?? [];
  const gate = gates.find((item) => item.id === gateId);
  if (!gate) {
    throw new Error(`unknown gate: ${gateId ?? "(missing)"}. Use one of: ${gates.map((item) => item.id).join(", ")}`);
  }
  if (isAgentProcess()) {
    throw new Error("approval needs a human at a terminal. Agents cannot approve.");
  }
  const source = option("--manifest");
  if (!source) throw new Error("--manifest <task.json> is required");
  const manifestPath = path.resolve(source);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const state = gateState(manifest, gate, {
    approvalFields: options.approvalFields,
    legacyGateId: options.legacySingleDigestSatisfies,
  });
  if (state.state === "current") {
    print({ approved: true, unchanged: true, gate: gate.id, stamp: state.stamp, digest: state.currentDigest });
    return;
  }
  const approvedBy = gitUserName();
  const approvedAt = new Date().toISOString();
  process.stderr.write(
    `Approve ${gate.id} (${gate.label ?? gate.id}) as ${approvedBy}?\n`
    + `digest: ${state.currentDigest}\n`
    + "Type yes to stamp this gate.\n",
  );
  const confirmed = await confirmYes("Approve this gate? [yes/no] ");
  if (!confirmed) throw new Error("no confirmation given");
  const approval = stampGate(manifest, gate, { approvedBy, approvedAt }, {
    approvalFields: options.approvalFields,
    legacyGateId: options.legacySingleDigestSatisfies,
  });
  const next = { ...manifest, approval };
  fs.writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  print({
    approved: true,
    gate: gate.id,
    stamp: approval.stamps[gate.id],
    next: nextStep(next, options),
  });
}

function contract(config) {
  print({
    schema: TASK_SCHEMA,
    stages: config.engineering.taskProtocol.stages,
    manifestPath: config.engineering.taskProtocol.manifestPath,
    requiredSections: config.engineering.taskProtocol.requiredSections,
    approvalBoundFields: config.engineering.taskProtocol.approval.boundFields,
    approvalGates: (config.engineering.taskProtocol.approval.gates ?? []).map((gate) => gate.id),
    approveCommand: config.engineering.taskProtocol.approval.approveCommand,
    executionBudget: config.engineering.taskProtocol.executionBudget,
    crossRepositorySeam: config.engineering.taskProtocol.crossRepositorySeam,
    frontendTestData: config.qualityAssurance.frontendTestData,
    capabilityControl: config.engineering.capabilityControl,
    proofModes: Object.keys(config.engineering.taskProtocol.proofModes),
    runnerIds: Object.keys(config.engineering.executionRunners.runners),
    repositoryIds: Object.keys(config.productTopology.repositories),
    intentVsBuilt: {
      path: "grounding.intentVsBuilt",
      classifications: ["same", "accepted", "defect", "parked", "ask-product"],
      honesty: ["live", "stubbed", "seeded"],
      rules: [
        "classify-before-plan",
        "ask-product-blocks-planning",
        "defect-blocks-verified-and-complete",
        "stubbed-external-proof-cannot-complete-same-or-accepted-rows",
      ],
    },
    testEvidence: {
      schema: "fhf-harness/test-evidence/v1",
      required: [
        "testId",
        "runnerId",
        "proofMode",
        "result",
        "testPath",
        "revision",
        "environment",
        "artifact",
        "artifactDigest",
        "counts",
        "completedAt",
      ],
      acceptance: ["exact-plan-match", "tests-greater-than-zero", "zero-failures", "zero-errors"],
    },
    commands: {
      validate: "node .harness/task-protocol.mjs validate --manifest <task.json>",
      digest: "node .harness/task-protocol.mjs digest --manifest <task.json>",
      next: "node .harness/task-protocol.mjs next --manifest <task.json>",
      approve: "node .harness/task-protocol.mjs approve --manifest <task.json> --gate <id>",
      backendPreflight: "node .harness/backend-task-runner.mjs preflight --manifest <absolute-task.json> --test-id <id>",
    },
  });
}

try {
  const config = loadConfig();
  const options = protocolOptions(config);
  if (command === "contract") {
    contract(config);
  } else if (command === "validate") {
    const manifest = loadManifest();
    const issues = [
      ...validateTaskManifest(manifest, options),
      ...fixtureIssues(manifest, config),
      ...scenarioRefIssues(manifest, config),
      ...componentContractIssues(manifest, config),
      ...dataPopulationIssues(manifest, config),
    ];
    print({ valid: issues.length === 0, issues });
    if (issues.length > 0) process.exitCode = 1;
  } else if (command === "digest") {
    const manifest = loadManifest();
    print({
      digest: approvalDigest(manifest, options.approvalFields),
      approval: approvalState(manifest, options.approvalFields),
      gates: gateReport(manifest, options),
    });
  } else if (command === "next") {
    print(nextStep(loadManifest(), options));
  } else if (command === "approve") {
    await approveCommand(options);
  } else {
    throw new Error("Usage: task-protocol.mjs <contract|validate|digest|next|approve> [--manifest <task.json>] [--gate <id>]");
  }
} catch (error) {
  console.error(`Task protocol error: ${error.message}`);
  process.exitCode = 2;
}
