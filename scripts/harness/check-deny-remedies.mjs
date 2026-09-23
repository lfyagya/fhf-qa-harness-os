#!/usr/bin/env node
// DESTINATION: scripts/harness/check-deny-remedies.mjs
//
// ADR-0038. Asserts, in the reverse direction of every check that already exists: a hook that
// refuses a tool call must name how to recover from it.
//
// Two rules:
//   1. A blocking hook routes its refusal through emitDeny(), not a bare process.exit(2).
//   2. Every emitDeny() call site supplies a structured remedy.
//
// Rule 1 cannot land everywhere at once — 21 hooks and 36 bare exits exist today — so it runs as
// a ratchet in the ADR-0033 sense. PENDING lists the not-yet-migrated hooks and their current
// count. A count may fall, never rise; reaching zero means the entry must be deleted. A new hook
// is absent from PENDING and so is held to the rule immediately.
//
//   node scripts/harness/check-deny-remedies.mjs             # the check
//   node scripts/harness/check-deny-remedies.mjs --baseline   # regenerate PENDING
//   node scripts/harness/check-deny-remedies.mjs --selftest    # prove the check fails when it should
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// FHF_HARNESS_ROOT lets the check run against a tree other than its own, which is how it was
// verified before being installed into one.
const ROOT = process.env.FHF_HARNESS_ROOT
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOOKS = path.join(ROOT, ".claude", "hooks");

// Baseline captured 2026-09-21. Counts are bare process.exit(2) calls per hook.
const PENDING = {
  "artifact-duplication-guard.mjs": 1,
  "block-forbidden-skills.mjs": 2,
  "block-generic-agents.mjs": 2,
  "context-read-guard.mjs": 1,
  "coverage-strategy-guard.mjs": 1,
  "enforce-task-gates.mjs": 2,
  "manual-task-guard.mjs": 3,
  "pre-validate-cypress-rules.mjs": 1,
  "prompt-router.mjs": 3,
  "protect-app-source.mjs": 1,
  "protect-automation-scope.mjs": 1,
  "protect-harness-governance.mjs": 1,
  "protect-prod-data.mjs": 1,
  "protect-second-brain-boundary.mjs": 1,
  "scenario-content-guard.mjs": 2,
  "scenario-file-guard.mjs": 2,
  "spec-sweep-stop-hook.mjs": 1,
  "validate-backend-automation.mjs": 3,
  "validate-cypress-rules.mjs": 4,
  "validate-spec-linkage.mjs": 2,
  "verify-subagent-citations.mjs": 1,
};

const REMEDY_KINDS = ["command", "optIn", "capability"];

// Full-line // comments are stripped before counting, so prose about exit codes — the hooks are
// full of it — is not mistaken for a call.
//
// Block comments are deliberately NOT stripped. Doing it by regex reads a `/*` inside a regex
// literal as a comment opener and swallows real code up to the next `*/`: it under-counted
// protect-prod-data.mjs as 0 (actual 1) and validate-cypress-rules.mjs as 1 (actual 4).
// Measured 2026-09-21 — stripping line comments alone reproduces the true counts exactly.
//
// ponytail: a `process.exit(2)` written inside a /* */ block would be counted. No hook does that
// today, and the failure is self-announcing (the check prints the hook and the count). Parse with
// a real tokenizer only if that actually happens.
function stripComments(source) {
  return source.replace(/^\s*\/\/.*$/gm, "");
}

function countBareExits(code) {
  return (code.match(/process\.exit\(2\)/g) ?? []).length;
}

// Balanced-paren scan: a remedy object spans lines, so a single regex would mis-slice it.
function denyCallArguments(code) {
  const calls = [];
  const needle = "emitDeny(";
  let at = code.indexOf(needle);
  while (at !== -1) {
    let depth = 0;
    let i = at + needle.length - 1;
    for (; i < code.length; i += 1) {
      if (code[i] === "(") depth += 1;
      else if (code[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push({ index: at, text: code.slice(at + needle.length, i) });
    at = code.indexOf(needle, i === code.length ? at + needle.length : i);
  }
  return calls;
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function auditFile(name, source) {
  const code = stripComments(source);
  const issues = [];

  const bare = countBareExits(code);
  const allowed = PENDING[name];
  if (allowed === undefined) {
    if (bare > 0) {
      issues.push(`${name}: ${bare} bare process.exit(2) — route refusals through emitDeny() (ADR-0038)`);
    }
  } else if (bare > allowed) {
    issues.push(`${name}: bare process.exit(2) rose ${allowed} → ${bare}; the ratchet only falls`);
  } else if (bare === 0) {
    issues.push(`${name}: fully migrated — delete its PENDING entry so the list cannot rot`);
  }

  for (const call of denyCallArguments(code)) {
    const hasRemedy = REMEDY_KINDS.some((kind) => new RegExp(`\\b${kind}\\s*:`).test(call.text));
    if (!hasRemedy) {
      issues.push(
        `${name}:${lineOf(code, call.index)}: emitDeny() named no remedy — supply one of ${REMEDY_KINDS.join(" / ")}`,
      );
    }
  }

  return issues;
}

function hookSources() {
  return fs
    .readdirSync(HOOKS)
    .filter((entry) => entry.endsWith(".mjs"))
    .map((name) => ({ name, source: fs.readFileSync(path.join(HOOKS, name), "utf8") }));
}

function run() {
  const issues = hookSources().flatMap(({ name, source }) => auditFile(name, source));
  if (issues.length) {
    console.error("Deny-remedy check failed (ADR-0038):");
    for (const issue of issues) console.error(`- ${issue}`);
    console.error("");
    console.error("A refusal that names no recovery path leaves the next person stuck.");
    process.exit(1);
  }
  const remaining = Object.values(PENDING).reduce((sum, n) => sum + n, 0);
  console.log(
    remaining
      ? `Deny-remedy check passed. ${Object.keys(PENDING).length} hooks still pending, ${remaining} bare exits remaining.`
      : "Deny-remedy check passed. Every blocking hook routes through emitDeny.",
  );
}

function baseline() {
  const rows = hookSources()
    .map(({ name, source }) => [name, countBareExits(stripComments(source))])
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  console.log("const PENDING = {");
  for (const [name, n] of rows) console.log(`  "${name}": ${n},`);
  console.log("};");
}

// A gate that has not been observed failing has not been shown to work (ADR-0034).
function selftest() {
  const cases = [
    {
      what: "unlisted hook with a bare exit is rejected",
      name: "brand-new-guard.mjs",
      source: "if (bad) process.exit(2);\n",
      expect: /bare process\.exit\(2\)/,
    },
    {
      what: "emitDeny without a remedy is rejected",
      name: "prompt-router.mjs",
      source: 'emitDeny({ reason: "no" });\nprocess.exit(2);process.exit(2);process.exit(2);\n',
      expect: /named no remedy/,
    },
    {
      what: "a risen ratchet count is rejected",
      name: "context-read-guard.mjs",
      source: "process.exit(2);process.exit(2);\n",
      expect: /ratchet only falls/,
    },
    {
      what: "a fully migrated hook must leave PENDING",
      name: "context-read-guard.mjs",
      source: 'emitDeny({ reason: "x", command: "node .harness/setup.mjs" });\n',
      expect: /delete its PENDING entry/,
    },
    {
      what: "prose in a line comment is not counted",
      name: "brand-new-guard.mjs",
      source: "// exit 2 blocks the call, e.g. process.exit(2)\n",
      expect: null,
    },
    {
      what: "a regex literal containing /* is not mistaken for a comment",
      name: "brand-new-guard.mjs",
      source: 'const re = /\\/\\*/;\nif (re.test(x)) process.exit(2);\n',
      expect: /bare process\.exit\(2\)/,
    },
    {
      what: "a valid optIn remedy passes",
      name: "brand-new-guard.mjs",
      source: 'emitDeny({ reason: "x", remedy: { optIn: "FHF_ALLOW_HARNESS_EDIT" } });\n',
      expect: null,
    },
    {
      what: "a multi-line remedy object is parsed",
      name: "brand-new-guard.mjs",
      source: 'emitDeny({\n  reason: "x",\n  remedy: {\n    capability: "jira-ticket-read",\n  },\n});\n',
      expect: null,
    },
  ];

  let failed = 0;
  for (const testCase of cases) {
    const issues = auditFile(testCase.name, testCase.source);
    const matched = testCase.expect
      ? issues.some((issue) => testCase.expect.test(issue))
      : issues.length === 0;
    console.log(`${matched ? "ok  " : "FAIL"} ${testCase.what}`);
    if (!matched) {
      failed += 1;
      console.log(`     issues: ${JSON.stringify(issues)}`);
    }
  }

  if (failed) {
    console.error(`\n${failed} selftest case(s) failed.`);
    process.exit(1);
  }
  console.log(`\n${cases.length} selftest cases passed.`);
}

const mode = process.argv[2];
if (mode === "--selftest") selftest();
else if (mode === "--baseline") baseline();
else run();
