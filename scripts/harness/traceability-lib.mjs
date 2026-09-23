import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const TEST_REPOS = new Set([
  "front-end-automation-e2e",
  "front-end-automation-smoke",
  "fhf-backend-automation",
]);
const NON_SOURCE_REPOS = new Set([
  ...TEST_REPOS,
  "Test-Case-Automation-Using-Claude-Agents",
  "oracle-instantclient-dependencies",
]);
const SOURCE_EXTENSIONS = /\.(?:js|jsx|ts|tsx|java|py|sql|yml|yaml|json)$/i;
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "cy", "does", "for",
  "from", "has", "have", "in", "is", "it", "its", "not", "of", "on", "or", "should",
  "test", "that", "the", "then", "this", "to", "user", "when", "with",
]);
const GIT_FILE_CACHE = new Map();

const MODULE_ALIASES = [
  ["loss-mitigation", ["lossmitigation", "loss-mitigation", "impound", "repossession", "repo", "recon", "remarketing", "transport"]],
  ["doc-repository", ["docrepository", "documentrepository", "documents"]],
  ["post-funding", ["postfunding", "post-funding"]],
  ["call-reports", ["callreports", "call-reports"]],
  ["call-center", ["callcenter", "call-center", "collections", "servicing", "unifi"]],
  ["ancillary", ["ancillary", "acd", "apd"]],
  ["checks", ["checks", "check"]],
  ["complaints", ["complaint"]],
  ["contracts", ["contract"]],
  ["custodian", ["custodian"]],
  ["funding", ["funding"]],
  ["insurance", ["insurance"]],
  ["letters", ["letter"]],
  ["titles", ["title", "reregistration", "re-registration"]],
];

function runGit(repoRoot, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`git -C ${repoRoot} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.status === 0 ? result.stdout : null;
}

function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function compact(value) {
  return normalize(value).replace(/\s+/g, "");
}

function tokens(value) {
  return [...new Set(normalize(value).split(/\s+/).filter((token) => token.length > 2 && !STOP_WORDS.has(token)))];
}

function stableId(parts) {
  return crypto.createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 20);
}

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

export function inferModule(value) {
  const text = compact(value);
  for (const [module, aliases] of MODULE_ALIASES) {
    if (aliases.some((alias) => text.includes(compact(alias)))) return module;
  }
  return "shared";
}

export function resolveBaselines(consumerRoot, repositories, refOverrides = {}) {
  const baselines = [];
  for (const [repoId, config] of Object.entries(repositories)) {
    const repoRoot = path.resolve(consumerRoot, config.root);
    if (!fs.existsSync(repoRoot)) {
      baselines.push({ repoId, root: config.root, availability: "unavailable" });
      continue;
    }
    const override = refOverrides[repoId];
    const overrideSha = override
      ? runGit(repoRoot, ["rev-parse", "--verify", override], { allowFailure: true })
      : null;
    if (override && !overrideSha) {
      baselines.push({ repoId, root: config.root, availability: "unavailable", reason: `configured ref not found: ${override}` });
      continue;
    }
    const master = runGit(repoRoot, ["rev-parse", "--verify", "origin/master"], { allowFailure: true });
    const defaultRef = runGit(repoRoot, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { allowFailure: true })?.trim();
    const ref = overrideSha ? override : master ? "origin/master" : defaultRef;
    if (!ref) {
      baselines.push({ repoId, root: config.root, availability: "unavailable", reason: "no origin/master or remote default" });
      continue;
    }
    const sha = runGit(repoRoot, ["rev-parse", ref]).trim();
    baselines.push({
      repoId,
      root: config.root,
      kind: config.kind,
      ref,
      sha,
      availability: "available",
    });
  }
  return baselines;
}

export function listGitFiles(consumerRoot, baseline) {
  if (baseline.availability !== "available") return [];
  const root = path.resolve(consumerRoot, baseline.root);
  return runGit(root, ["ls-tree", "-r", "--name-only", baseline.sha])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, "/"));
}

export function readGitFile(consumerRoot, baseline, file) {
  const key = `${baseline.repoId}\0${baseline.sha}\0${file}`;
  if (GIT_FILE_CACHE.has(key)) return GIT_FILE_CACHE.get(key);
  const root = path.resolve(consumerRoot, baseline.root);
  const content = runGit(root, ["show", `${baseline.sha}:${file}`]);
  GIT_FILE_CACHE.set(key, content);
  return content;
}

function suiteAt(content, index) {
  const before = content.slice(0, index);
  const names = [];
  const regex = /\b(?:describe|context)\s*\(\s*(['"`])([^'"`\r\n]+)\1/g;
  let match;
  while ((match = regex.exec(before))) names.push(match[2]);
  return names.slice(-3);
}

export function parseCypressTests(content, context) {
  const records = [];
  const accountedOffsets = new Set();
  const literal = /\b(it|test)(\.(?:only|skip|todo))?\s*\(\s*(['"`])([^'"`\r\n]*?)\3/g;
  let match;
  while ((match = literal.exec(content))) {
    const offset = match.index;
    accountedOffsets.add(offset);
    const title = match[4];
    const dynamicTitle = match[3] === "`" && title.includes("${");
    records.push({
      id: stableId([context.repoId, context.sha, context.file, String(offset), title]),
      repoId: context.repoId,
      sha: context.sha,
      file: context.file,
      framework: "cypress",
      suite: suiteAt(content, offset),
      title,
      line: lineNumber(content, offset),
      state: match[2]?.slice(1) ?? "active",
      declaration: match[1],
      resolution: dynamicTitle ? "dynamic-unresolved" : "static",
      parameter: null,
    });
  }
  const anyCall = /\b(it|test)(?:\.(?:only|skip|todo))?\s*\(/g;
  while ((match = anyCall.exec(content))) {
    if (accountedOffsets.has(match.index)) continue;
    records.push({
      id: stableId([context.repoId, context.sha, context.file, String(match.index), "dynamic"]),
      repoId: context.repoId,
      sha: context.sha,
      file: context.file,
      framework: "cypress",
      suite: suiteAt(content, match.index),
      title: "<dynamic test title>",
      line: lineNumber(content, match.index),
      state: "unknown",
      declaration: match[1],
      resolution: "dynamic-unresolved",
      parameter: null,
    });
  }
  return records.sort((a, b) => a.line - b.line);
}

function staticParamValues(decorators) {
  const joined = decorators.join(" ");
  if (!/parametrize\s*\(/.test(joined)) return [null];
  const list = joined.match(/parametrize\s*\([^,]+,\s*\[([\s\S]*?)\]\s*(?:,|\))/);
  if (!list) return ["<dynamic-parameters>"];
  const values = [];
  let depth = 0;
  let quote = null;
  let current = "";
  for (const char of list[1]) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === "\"") quote = char;
    if ("([{".includes(char)) depth += 1;
    if (")]}".includes(char)) depth -= 1;
    if (char === "," && depth === 0) {
      if (current.trim()) values.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) values.push(current.trim());
  return values.length ? values : ["<dynamic-parameters>"];
}

export function parsePytestTests(content, context) {
  const lines = content.split(/\r?\n/);
  const records = [];
  const classes = [];
  let decorators = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const indent = line.match(/^\s*/)[0].length;
    const classMatch = line.match(/^\s*class\s+(Test\w+)/);
    if (classMatch) {
      while (classes.length && classes.at(-1).indent >= indent) classes.pop();
      classes.push({ name: classMatch[1], indent });
      decorators = [];
      continue;
    }
    if (/^\s*@/.test(line)) {
      decorators.push(line.trim());
      continue;
    }
    const functionMatch = line.match(/^\s*(?:async\s+)?def\s+(test_[A-Za-z0-9_]+)\s*\(/);
    if (!functionMatch) {
      if (decorators.length && line.trim() && decorators.join("").split("(").length > decorators.join("").split(")").length) {
        decorators[decorators.length - 1] += ` ${line.trim()}`;
      } else if (line.trim() && !/^\s*#/.test(line)) decorators = [];
      continue;
    }
    while (classes.length && classes.at(-1).indent >= indent) classes.pop();
    const parameters = staticParamValues(decorators);
    const state = decorators.some((item) => /\.skip(?:if)?\b/.test(item)) ? "skip" : "active";
    for (const parameter of parameters) {
      const dynamic = parameter === "<dynamic-parameters>";
      records.push({
        id: stableId([context.repoId, context.sha, context.file, functionMatch[1], String(index + 1), String(parameter)]),
        repoId: context.repoId,
        sha: context.sha,
        file: context.file,
        framework: "pytest",
        suite: classes.map((entry) => entry.name),
        title: functionMatch[1],
        line: index + 1,
        state,
        declaration: "def",
        resolution: dynamic ? "dynamic-unresolved" : "static",
        parameter,
      });
    }
    decorators = [];
  }
  return records;
}

export function collectTests(consumerRoot, baselines) {
  const records = [];
  const files = [];
  const scenarios = [];
  const diagnostics = [];
  for (const baseline of baselines.filter((item) => TEST_REPOS.has(item.repoId) && item.availability === "available")) {
    const tree = listGitFiles(consumerRoot, baseline);
    const eligible = baseline.repoId === "fhf-backend-automation"
      ? tree.filter((file) => /(^|\/)(?:test_[^/]+|[^/]+_test)\.py$/i.test(file))
      : tree.filter((file) => /\.(?:cy|spec)\.(?:js|jsx|ts|tsx)$/i.test(file));
    if (baseline.repoId !== "fhf-backend-automation") {
      const scenarioFiles = tree.filter((file) => /\/configs\/scenarios\/.*\.(?:js|ts)$/i.test(`/${file}`));
      for (const file of scenarioFiles) {
        try {
          const content = readGitFile(consumerRoot, baseline, file);
          const definitions = [...content.matchAll(/\bid\s*:\s*['"`]([^'"`]+)['"`]/g)].map((match) => ({
            id: match[1],
            line: lineNumber(content, match.index),
            jiraId: content.slice(match.index, match.index + 800).match(/\bjiraId\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? null,
          }));
          scenarios.push({ repoId: baseline.repoId, sha: baseline.sha, file, module: inferModule(file), definitions });
        } catch (error) {
          diagnostics.push({ type: "scenario-parse-error", repoId: baseline.repoId, file, message: error.message });
        }
      }
    }
    for (const file of eligible) {
      try {
        const content = readGitFile(consumerRoot, baseline, file);
        const parsed = baseline.repoId === "fhf-backend-automation"
          ? parsePytestTests(content, { ...baseline, file })
          : parseCypressTests(content, { ...baseline, file });
        const specIds = [...new Set(content.match(/\b[A-Z][A-Z0-9_-]*-\d+\b/g) ?? [])];
        const automationScenarioRefs = [...new Set(
          [...content.matchAll(/(?:from\s+|require\s*\(\s*)['"`]([^'"`]*configs\/scenarios\/[^'"`]+)['"`]/g)]
            .map((match) => match[1]),
        )];
        records.push(...parsed.map((test) => ({
          ...test,
          module: inferModule(`${file} ${test.title}`),
          subjectHints: subjectHints(content),
          referencedSpecIds: specIds,
          automationScenarioRefs,
        })));
        files.push({ repoId: baseline.repoId, sha: baseline.sha, file, declarations: parsed.length });
        if (!parsed.length) diagnostics.push({ type: "eligible-file-without-test-declaration", repoId: baseline.repoId, file });
      } catch (error) {
        diagnostics.push({ type: "test-parse-error", repoId: baseline.repoId, file, message: error.message });
      }
    }
  }
  return { records, files, scenarios, diagnostics };
}

function subjectHints(content) {
  const hints = new Set();
  for (const match of content.matchAll(/['"`](\/(?:api|ords|rest)\/[^'"`\s?]+)['"`]/gi)) hints.add(match[1]);
  for (const match of content.matchAll(/\b(?:import|require)\b[^\r\n]*?([A-Za-z][A-Za-z0-9]*(?:Client|Service|Page|Dashboard|Api))\b/g)) hints.add(match[1]);
  return [...hints].slice(0, 12);
}

function moduleFromSpecPath(file) {
  const normalized = file.replace(/\\/g, "/");
  const match = normalized.match(/specs\/modules\/(?:common\/)?([^/]+)/);
  return match ? inferModule(match[1]) : normalized.includes("/components/") ? "shared" : inferModule(normalized);
}

export function parseSpec(content, context) {
  const lines = content.split(/\r?\n/);
  const requirements = [];
  const groups = [];
  let currentRequirement = null;
  let currentGroup = null;
  let inGroups = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^test_scenario_groups\s*:/.test(line)) {
      inGroups = true;
      currentRequirement = null;
      continue;
    }
    if (inGroups && /^\S/.test(line) && !/^test_scenario_groups\s*:/.test(line)) {
      inGroups = false;
      currentGroup = null;
    }
    const idMatch = line.match(/^\s*-\s*id\s*:\s*['"]?([A-Z][A-Z0-9_-]*-\d+)['"]?\s*$/);
    if (idMatch && !inGroups) {
      currentRequirement = {
        id: idMatch[1],
        file: context.file,
        module: context.module,
        line: index + 1,
        text: "",
      };
      requirements.push(currentRequirement);
      continue;
    }
    if (currentRequirement && /^\s+(?:statement|description|name|title|expected|outcome)\s*:/.test(line)) {
      currentRequirement.text += ` ${line.replace(/^\s*[^:]+:\s*/, "").replace(/^['"]|['"]$/g, "")}`;
    }
    if (inGroups) {
      const prefix = line.match(/^\s*-\s*prefix\s*:\s*['"]?(.+?)['"]?\s*$/);
      if (prefix) {
        currentGroup = { prefix: prefix[1], file: context.file, module: context.module, line: index + 1, covers: [] };
        groups.push(currentGroup);
        continue;
      }
      const coversInline = line.match(/^\s*covers\s*:\s*\[([^\]]*)\]/);
      if (currentGroup && coversInline) {
        currentGroup.covers.push(...coversInline[1].split(",").map((item) => item.trim().replace(/['"]/g, "")).filter(Boolean));
      } else if (currentGroup) {
        const cover = line.match(/^\s*-\s*([A-Z][A-Z0-9_-]*-\d+)\s*$/);
        if (cover) currentGroup.covers.push(cover[1]);
      }
    }
  }
  return { ...context, requirements, groups };
}

export function collectSpecs(consumerRoot, baseline) {
  if (!baseline || baseline.availability !== "available") return { files: [], requirements: [], groups: [], diagnostics: [{ type: "spec-repository-unavailable" }] };
  const specFiles = listGitFiles(consumerRoot, baseline)
    .filter((file) => /^specs\/(?:modules|components)\/.*\.ya?ml$/i.test(file));
  const files = [];
  const diagnostics = [];
  for (const file of specFiles) {
    try {
      files.push(parseSpec(readGitFile(consumerRoot, baseline, file), {
        repoId: baseline.repoId,
        sha: baseline.sha,
        file,
        module: moduleFromSpecPath(file),
      }));
    } catch (error) {
      diagnostics.push({ type: "spec-parse-error", file, message: error.message });
    }
  }
  return {
    files,
    requirements: files.flatMap((file) => file.requirements),
    groups: files.flatMap((file) => file.groups),
    diagnostics,
  };
}

function scoreTerms(candidate, terms) {
  const normalized = normalize(candidate);
  return terms.reduce((score, term) => score + (normalized.includes(term) ? Math.max(1, term.length - 2) : 0), 0);
}

function testTerms(test) {
  return tokens(`${test.file} ${test.suite.join(" ")} ${test.title} ${test.subjectHints.join(" ")}`);
}

export function mapTestsToSpecs(tests, specs) {
  const requirementById = new Map(specs.requirements.map((requirement) => [requirement.id, requirement]));
  return tests.map((test) => {
    const contentTerms = testTerms(test);
    const directIds = test.referencedSpecIds.filter((id) => requirementById.has(id));
    const candidates = specs.groups
      .filter((group) => group.module === test.module || group.module === "shared")
      .map((group) => ({ group, score: scoreTerms(group.prefix, contentTerms) + (group.module === test.module ? 3 : 0) }))
      .sort((a, b) => b.score - a.score);
    const exactGroup = specs.groups.find((group) =>
      (group.module === test.module || group.module === "shared")
      && directIds.some((id) => group.covers.includes(id)));
    const candidate = candidates[0]?.score > 3 ? candidates[0].group : null;
    const requirementIds = [...new Set([...directIds, ...(exactGroup?.covers ?? [])])];
    return {
      ...test,
      scenarioRef: exactGroup ? { source: exactGroup.file, group: exactGroup.prefix, covers: requirementIds } : null,
      scenarioCandidate: !exactGroup && candidate
        ? { source: candidate.file, group: candidate.prefix, covers: candidate.covers }
        : null,
      requirementIds,
      mappingConfidence: exactGroup && directIds.length ? "high" : "none",
    };
  });
}

export function buildSourceCatalog(consumerRoot, baselines) {
  const catalog = [];
  for (const baseline of baselines.filter((item) => item.availability === "available" && !NON_SOURCE_REPOS.has(item.repoId))) {
    for (const file of listGitFiles(consumerRoot, baseline)) {
      if (!SOURCE_EXTENSIONS.test(file)) continue;
      if (/(^|\/)(?:test|tests|__tests__|target|dist|build|vendor|node_modules)(\/|$)/i.test(file)) continue;
      catalog.push({ baseline, file });
    }
  }
  return catalog;
}

function sourceLines(content, terms) {
  const lines = content.split(/\r?\n/);
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index].trim();
    if (!text || /^(?:import|from|package|#|\/\/|\*)\b/.test(text)) continue;
    const score = scoreTerms(text, terms);
    if (score > 0) matches.push({ line: index + 1, expression: text.slice(0, 500), score });
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 2);
}

export function attachSourceEvidence(consumerRoot, tests, catalog) {
  const candidateCache = new Map();
  return tests.map((test) => {
    const terms = testTerms(test);
    const moduleTerms = tokens(test.module);
    const allTerms = [...new Set([...terms, ...moduleTerms])];
    const selectionTerms = [...new Set([...tokens(test.file), ...test.subjectHints.flatMap(tokens), ...moduleTerms])];
    const cacheKey = `${test.module}\0${test.file}\0${test.subjectHints.join("\0")}`;
    if (!candidateCache.has(cacheKey)) {
      candidateCache.set(cacheKey, catalog
        .map((entry) => ({ entry, score: scoreTerms(entry.file, selectionTerms) + (inferModule(entry.file) === test.module ? 5 : 0) }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5));
    }
    const candidates = candidateCache.get(cacheKey);
    const evidence = [];
    for (const { entry } of candidates) {
      try {
        const lines = sourceLines(readGitFile(consumerRoot, entry.baseline, entry.file), allTerms);
        for (const line of lines) {
          evidence.push({
            repoId: entry.baseline.repoId,
            ref: entry.baseline.ref,
            sha: entry.baseline.sha,
            file: entry.file,
            line: line.line,
            symbol: line.expression.match(/\b(?:class|function|def|public|private|protected)\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1] ?? null,
            assertion: line.expression,
            authority: "frozen-product-source",
          });
        }
      } catch {
        // A Git-object read failure is represented by absent evidence and diagnosed in the aggregate.
      }
      if (evidence.length >= 3) break;
    }
    const sourceEvidence = evidence.slice(0, 3);
    const outcome = test.resolution === "dynamic-unresolved"
      ? "DYNAMIC_UNRESOLVED"
      : !sourceEvidence.length
        ? "SOURCE_UNRESOLVED"
        : test.scenarioRef && test.mappingConfidence === "high"
          ? "ALIGNED"
          : !test.scenarioRef
            ? "TEST_WITHOUT_SPEC"
            : "SOURCE_UNRESOLVED";
    return { ...test, sourceEvidence, outcome };
  });
}

export function coverageForRequirements(specs, tests) {
  const covered = new Map();
  for (const test of tests) {
    if (test.outcome !== "ALIGNED") continue;
    for (const id of test.requirementIds) {
      if (!covered.has(id)) covered.set(id, []);
      covered.get(id).push(test.id);
    }
  }
  return specs.requirements.map((requirement) => ({
    ...requirement,
    testIds: covered.get(requirement.id) ?? [],
    outcome: covered.has(requirement.id) ? "ALIGNED" : "SPEC_WITHOUT_TEST",
  }));
}

export function buildCompleteness(testInventory, mappedTests, specInventory) {
  const declarations = testInventory.files.reduce((sum, file) => sum + file.declarations, 0);
  const dynamic = mappedTests.filter((test) => test.resolution === "dynamic-unresolved").length;
  const parseErrors = [...testInventory.diagnostics, ...specInventory.diagnostics]
    .filter((item) => /parse-error/.test(item.type)).length;
  return {
    eligibleTestFiles: testInventory.files.length,
    declarationRecords: declarations,
    ledgerTestRecords: mappedTests.length,
    accountingDelta: declarations - mappedTests.length,
    dynamicUnresolved: dynamic,
    parseErrors,
    fileAccountingComplete: declarations === mappedTests.length && parseErrors === 0,
    literalNoOmissionsClaim: declarations === mappedTests.length && parseErrors === 0 && dynamic === 0,
  };
}

export function renderModuleReport(module, tests, requirements, baselineSummary) {
  const lines = [
    `# ${module} traceability`,
    "",
    `Generated from frozen refs: ${baselineSummary}.`,
    "",
    `Tests: ${tests.length}; spec requirements: ${requirements.length}; unresolved source: ${tests.filter((test) => test.outcome === "SOURCE_UNRESOLVED").length}; dynamic: ${tests.filter((test) => test.outcome === "DYNAMIC_UNRESOLVED").length}.`,
    "",
    "## Tests",
  ];
  for (const test of tests) {
    lines.push(
      "",
      `### ${test.title}`,
      `- Test: \`${test.repoId}:${test.file}:${test.line}\``,
      `- Outcome: \`${test.outcome}\``,
      `- Scenario: ${test.scenarioRef ? `\`${test.scenarioRef.source}#${test.scenarioRef.group}\`` : "unmapped"}`,
      `- Review candidate: ${test.scenarioCandidate ? `\`${test.scenarioCandidate.source}#${test.scenarioCandidate.group}\` (not treated as coverage)` : "none"}`,
      `- Requirements: ${test.requirementIds.length ? test.requirementIds.map((id) => `\`${id}\``).join(", ") : "none"}`,
      `- Source-derived assertion evidence: ${test.sourceEvidence.length ? "" : "unresolved"}`,
    );
    for (const evidence of test.sourceEvidence) {
      lines.push(`  - \`${evidence.repoId}:${evidence.file}:${evidence.line}@${evidence.sha.slice(0, 12)}\` — \`${evidence.assertion.replace(/`/g, "'")}\``);
    }
  }
  lines.push("", "## Spec requirements without mapped tests");
  const gaps = requirements.filter((requirement) => requirement.outcome === "SPEC_WITHOUT_TEST");
  if (!gaps.length) lines.push("", "None.");
  for (const requirement of gaps) lines.push(`- \`${requirement.id}\` — \`${requirement.file}:${requirement.line}\` ${requirement.text}`.trimEnd());
  return `${lines.join("\n")}\n`;
}

// The full ledger and the per-module reports are too large to open in an editor, so the index is
// the entry point: every number here is derived, and every row points at where to read the detail.
export function renderIndexReport(ledger, moduleReportRoot) {
  const { totals, completeness, policy } = ledger;
  const countFor = (module, predicate) => ledger.tests.filter((test) => test.module === module && predicate(test)).length;
  const modules = [...new Set([
    ...ledger.tests.map((test) => test.module),
    ...ledger.specRequirements.map((requirement) => requirement.module),
  ])].sort();

  const lines = [
    "# Traceability index",
    "",
    `Generated ${ledger.generatedAt}. Baseline policy: \`${policy.branch}\`.`,
    `Assertion authority: \`${policy.assertionAuthority}\`.`,
    "",
    "## Completeness",
    "",
    `- Eligible test files: ${completeness.eligibleTestFiles}`,
    `- Parser declarations: ${completeness.declarationRecords}`,
    `- Ledger records: ${completeness.ledgerTestRecords} (delta ${completeness.accountingDelta})`,
    `- Parse errors: ${completeness.parseErrors}`,
    `- Dynamic, statically unresolvable: ${completeness.dynamicUnresolved}`,
    `- Every eligible file and declaration accounted for: ${completeness.fileAccountingComplete ? "yes" : "no"}`,
    `- Literal no-omissions claim: ${completeness.literalNoOmissionsClaim ? "yes" : `no — ${completeness.dynamicUnresolved} dynamic cases need runtime or manual resolution`}`,
    "",
    "## Lanes",
    "",
    "| Lane | Ref | Files | Tests |",
    "| --- | --- | --- | --- |",
  ];
  for (const [repoId, lane] of Object.entries(totals.testsByLane)) {
    const baseline = ledger.baselines.find((item) => item.repoId === repoId);
    lines.push(`| ${repoId} | \`${baseline?.ref ?? "unknown"}@${baseline?.sha?.slice(0, 12) ?? "unknown"}\` | ${lane.files} | ${lane.tests} |`);
  }

  lines.push(
    "",
    "## Modules",
    "",
    "| Module | Tests | Aligned | No spec | Dynamic | Requirements | Uncovered | Report |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const module of modules) {
    const requirements = ledger.specRequirements.filter((requirement) => requirement.module === module);
    lines.push([
      `| ${module}`,
      countFor(module, () => true),
      countFor(module, (test) => test.outcome === "ALIGNED"),
      countFor(module, (test) => test.outcome === "TEST_WITHOUT_SPEC"),
      countFor(module, (test) => test.outcome === "DYNAMIC_UNRESOLVED"),
      requirements.length,
      requirements.filter((requirement) => requirement.outcome === "SPEC_WITHOUT_TEST").length,
      `[${module}.md](${moduleReportRoot}/${module}.md) |`,
    ].join(" | "));
  }

  lines.push(
    "",
    "## Outcome vocabulary",
    "",
    "- `ALIGNED` — the test cites a spec requirement that a real scenario group covers, and frozen source backs it.",
    "- `TEST_WITHOUT_SPEC` — the test runs, but no exact spec binding exists. A heuristic review candidate may be recorded; it is not counted as coverage.",
    "- `DYNAMIC_UNRESOLVED` — the case is generated at runtime and cannot be resolved from static source.",
    "- `SPEC_WITHOUT_TEST` — the spec requirement has no mapped automation.",
    "",
    "## Detail artifacts",
    "",
    `- Full ledger: \`${"traceability-ledger.json"}\` (query it rather than opening it)`,
    "- Gap proposals: `spec-gap-proposals.md`",
    `- Per-module detail: \`${moduleReportRoot}/\``,
    "",
    "Example query:",
    "",
    "```bash",
    "node -e \"const l=require('./docs/evidence/traceability/traceability-ledger.json');console.log(l.tests.filter(t=>t.module==='titles'&&t.outcome==='ALIGNED').length)\"",
    "```",
  );
  return `${lines.join("\n")}\n`;
}

export function renderSpecGapReport(tests, requirements) {
  const testGaps = tests.filter((test) => ["TEST_WITHOUT_SPEC", "SOURCE_UNRESOLVED", "DYNAMIC_UNRESOLVED"].includes(test.outcome));
  const specGaps = requirements.filter((requirement) => requirement.outcome === "SPEC_WITHOUT_TEST");
  const lines = [
    "# Spec gap proposals",
    "",
    "Generated proposal only. Product-spec files are not changed without exact, single-use approval.",
    "",
    "## Tests needing spec or source review",
  ];
  for (const test of testGaps) {
    lines.push(`- \`${test.outcome}\` \`${test.repoId}:${test.file}:${test.line}\` — ${test.title}; proposed target: \`specs/modules/${test.module}/\`.`);
  }
  lines.push("", "## Spec requirements without mapped automation");
  for (const requirement of specGaps) {
    lines.push(`- \`${requirement.id}\` in \`${requirement.file}:${requirement.line}\`${requirement.text ? ` — ${requirement.text}` : ""}`);
  }
  if (!testGaps.length && !specGaps.length) lines.push("", "No gaps detected.");
  return `${lines.join("\n")}\n`;
}
