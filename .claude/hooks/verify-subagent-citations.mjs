#!/usr/bin/env node
// SubagentStop — reject a subagent summary whose file:line citations do not resolve.
// exit 2 = BLOCK, returning the unresolved citations as feedback.
//
// Why this exists (2026-09-05): the harness already separates generation from evaluation,
// which is the right structure — the published guidance on this is blunt that agents asked to
// judge their own output "tend to respond by confidently praising the work". But the
// separation only helps if the evaluator's inputs are real. A subagent reports back in prose,
// and the parent has no deterministic reason to believe the prose.
//
// SubagentStart already runs block-generic-agents.mjs, so the ENTRY to a subagent is gated.
// The EXIT was not gated at all. This closes that side.
//
// Scope is deliberately narrow: this verifies that a cited location EXISTS, not that the claim
// about it is true. A citation that resolves can still be wrong. What it removes is the
// cheapest and most common failure — a confident summary citing a file or line that was never
// there — which has happened here before and is why the session rules already say to validate
// subagent summaries against the cited source before acting. That rule was advisory; this
// makes the mechanical half of it deterministic.
//
// NOT in scope, on purpose: spawn-budget and turn-count enforcement. ADR-0025 item 5 defers
// that, and its reasoning is correct — the budgets are self-reported today, and building
// enforcement before the phase traces show whether agents actually miscount would be
// "designing an enforcement mechanism against one datapoint". Citation resolution needs no
// such evidence: an unresolvable path is wrong on its face, with no threshold to calibrate.
//
// A citation is only counted when the path segment carries a recognised source extension, so
// a timestamp (10:30), a ticket suffix (SERV-12053:1) or a host:port is not mistaken for one.
// Unrecognised payload shapes and unreadable roots fall through to allow: a verifier that
// blocks on its own confusion would be worse than the advisory rule it replaces.
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { loadHarnessConfig } from "./lib/harness-config.mjs";
import { emitAllow } from "./lib/hook-runtime.mjs";

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  emitAllow(payload);
  process.exit(0);
}
process.on("exit", (code) => code === 0 && emitAllow(payload));

const config = loadHarnessConfig();
const policy = config.engineering?.harness?.citationVerification ?? {};
if (policy.enabled === false) process.exit(0);

const MAX_CHECKED = Number.isInteger(policy.maxCitationsChecked)
  ? policy.maxCitationsChecked
  : 40;
const EXTENSIONS = new Set(policy.sourceExtensions ?? [
  "cjs", "cy.js", "js", "json", "jsx", "md", "mjs", "mts", "py", "sql", "ts", "tsx", "yaml", "yml",
]);

// The completion text is wherever this runtime puts it. Try the documented shapes in order
// rather than assuming one; if none is present there is nothing to verify.
function summaryText(source) {
  const candidates = [
    source?.tool_response,
    source?.response,
    source?.agent_response,
    source?.subagent_response,
    source?.result,
    source?.output,
    source?.message,
    source?.tool_input?.result,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (candidate && typeof candidate === "object") {
      const nested = candidate.text ?? candidate.content ?? candidate.summary;
      if (typeof nested === "string" && nested.trim()) return nested;
    }
  }
  return "";
}

const text = summaryText(payload);
if (!text) process.exit(0);

const roots = [
  payload?.cwd,
  process.env.CLAUDE_PROJECT_DIR,
  process.env.CURSOR_PROJECT_DIR,
  process.cwd(),
].filter((value) => typeof value === "string" && value.trim());
if (roots.length === 0) process.exit(0);

// path/to/file.ext:123  (optionally :123-456). Backticks and surrounding markdown are stripped
// by the character class, so a citation inside `code span` still matches.
const CITATION = /([A-Za-z0-9._\-/\\]+\.[A-Za-z]+[A-Za-z0-9.]*):(\d+)(?:-(\d+))?/g;

function hasSourceExtension(candidate) {
  const base = candidate.split("/").pop() ?? "";
  const parts = base.split(".");
  if (parts.length < 2) return false;
  // Check the last one and two segments so cy.js resolves as well as js.
  return EXTENSIONS.has(parts.slice(-1)[0].toLowerCase())
    || EXTENSIONS.has(parts.slice(-2).join(".").toLowerCase());
}

function resolveCitation(rel) {
  for (const root of roots) {
    const candidate = path.resolve(root, rel);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const unresolved = [];
const seen = new Set();
let checked = 0;

for (const match of text.matchAll(CITATION)) {
  if (checked >= MAX_CHECKED) break;
  const [, rawPath, rawLine] = match;
  const rel = rawPath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!hasSourceExtension(rel)) continue;
  if (/^https?:/i.test(rel)) continue;
  const key = `${rel}:${rawLine}`;
  if (seen.has(key)) continue;
  seen.add(key);
  checked += 1;

  const resolved = resolveCitation(rel);
  if (!resolved) {
    unresolved.push(`${key} — no such file under the session roots`);
    continue;
  }
  const line = Number(rawLine);
  if (line < 1) {
    unresolved.push(`${key} — line number is not valid`);
    continue;
  }
  let lineCount = 0;
  try {
    lineCount = readFileSync(resolved, "utf8").split(/\r?\n/).length;
  } catch {
    continue; // Unreadable is not the subagent's fault; do not block on it.
  }
  if (line > lineCount) {
    unresolved.push(`${key} — file has ${lineCount} lines`);
  }
}

if (unresolved.length === 0) process.exit(0);

console.error("BLOCKED: the subagent summary cites locations that do not resolve.");
console.error("");
for (const entry of unresolved) console.error(`  ${entry}`);
console.error("");
console.error(`Checked ${checked} citation(s); ${unresolved.length} unresolved.`);
console.error("A citation that does not resolve cannot be verified, so the summary must not be");
console.error("acted on as written. Re-read the source and cite real locations, or state plainly");
console.error("that the location could not be found instead of naming one.");
console.error("");
console.error("This checks only that cited locations exist. A resolving citation can still be");
console.error("wrong — verify the claim against the source before acting on it.");
process.exit(2);
