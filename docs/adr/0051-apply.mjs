#!/usr/bin/env node
// ADR-0051 — operator commands and read intent are the same in every shell.
// This file is the protected half: the classifier, two shell guards, the read guard and the
// control-plane vocabulary. Operator docs (ONBOARDING, doctor, this ADR) land without the opt-in.
//
// The control plane and the three guards this changes are all protected paths (ADR-0027), so an
// agent cannot write them. It writes this script instead, and the owner runs it:
//
//   FHF_ALLOW_HARNESS_EDIT=1 node docs/adr/0051-apply.mjs
//   node scripts/harness/test-hooks.mjs
//   node scripts/harness/verify-canonical.mjs
//
// To see the result before touching this repository, apply it to a copy instead. A copy holds no
// gates, so it needs no opt-in:
//
//   cp -r . /tmp/adr51 && node docs/adr/0051-apply.mjs --target /tmp/adr51
//   node /tmp/adr51/scripts/harness/test-hooks.mjs
//
// Idempotent: every step reports "already applied" and changes nothing on a second run.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const targetFlag = process.argv.indexOf("--target");
const ROOT = targetFlag === -1
  ? SELF_ROOT
  : path.resolve(process.argv[targetFlag + 1] ?? "");
const CONFIG = path.join(ROOT, "config", "qa-control-plane.json");
const HOOKS = path.join(ROOT, ".claude", "hooks");
const LIB = path.join(HOOKS, "lib");
const READ_INTENT = path.join(LIB, "shell-read-intent.mjs");
const GOVERNANCE = path.join(HOOKS, "protect-harness-governance.mjs");
const PROD_DATA = path.join(HOOKS, "protect-prod-data.mjs");
const READ_GUARD = path.join(HOOKS, "context-read-guard.mjs");

const SHELL_INSPECTION = {
  note:
    "ADR-0051. One read-intent vocabulary for every shell tool. A command is split on its chain "
    + "operators and every step is classified, so a POSIX, PowerShell or cmd inspection of a "
    + "protected path is allowed and a single writing step still denies the whole command.",
  chainOperators: ["&&", "||", ";", "|", "&"],
  unsafeTokenPattern: "[\\r\\n<>`]|\\$\\(",
  discardRedirectPattern: "\\d?>>?\\s*(?:/dev/null|nul|&\\d)",
  navigationCommands: [
    "cd",
    "chdir",
    "pop-location",
    "popd",
    "push-location",
    "pushd",
    "set-location",
    "sl",
  ],
  readOnlyCommands: [
    "cat",
    "diff",
    "dir",
    "fc",
    "gc",
    "gci",
    "get-childitem",
    "get-content",
    "get-item",
    "grep",
    "head",
    "jq",
    "ls",
    "more",
    "rg",
    "select-string",
    "sls",
    "stat",
    "tail",
    "test-path",
    "type",
    "wc",
  ],
  gitReadSubcommands: [
    "blame",
    "cat-file",
    "describe",
    "diff",
    "log",
    "ls-files",
    "rev-parse",
    "show",
    "status",
  ],
  metadataOnlyCommands: [
    "dir",
    "du",
    "gci",
    "get-childitem",
    "get-item",
    "gi",
    "ls",
    "stat",
    "test-path",
  ],
};

const READ_INTENT_SOURCE = `// Shared read-intent classification for shell commands — ADR-0051.
//
// Why this exists (2026-09-24): protect-harness-governance.mjs and protect-prod-data.mjs each
// carried a private "is this a read" test. Both judged the whole command by its first token and
// disqualified anything holding a chain operator. Every Cursor Shell call arrives as
// "cd <root> && <command>", PowerShell inspection as "Set-Location x; Get-Content y" and cmd as
// "cd /d x & type y", so listing a gate directory, counting its lines or reading its git history
// was refused as a write to a gate — and the refusal named the owner WRITE opt-in as the only
// recovery, which is the wrong door for an inspection.
//
// Intent is classified per step: every step must be a navigation command, a read-only executable
// or a git read subcommand. One writing step denies the whole command. Redirects, command
// substitution, backticks and newlines disqualify a command before any step is read, because one
// of those can rewrite the file it is pointed at; a redirect to the null device is discarded
// first, since it can write nothing.
//
// The vocabulary is policy and lives at engineering.harness.shellInspection. FALLBACK exists only
// so an older consumer projection still refuses writes — it is not a second source of truth.
import { loadHarnessConfig } from "./harness-config.mjs";

const FALLBACK = ${JSON.stringify(SHELL_INSPECTION, null, 2)};

const VALUE_FLAGS = new Set(["-c", "-C", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);

export function shellInspectionPolicy(config) {
  const loaded = config ?? loadHarnessConfig();
  return { ...FALLBACK, ...(loaded?.engineering?.harness?.shellInspection ?? {}) };
}

/** The chain-operator-separated steps of one command, in order. */
export function shellSteps(command, config) {
  const policy = shellInspectionPolicy(config);
  const operators = [...policy.chainOperators]
    .sort((a, b) => b.length - a.length)
    .map((operator) => String(operator).replace(/[.*+?^()|[\\]\\\\{}$]/g, "\\\\$&"));
  return String(command ?? "")
    .split(new RegExp(operators.join("|")))
    .map((step) => step.trim())
    .filter(Boolean);
}

function stepExecutable(step) {
  const tokens = step.split(/\\s+/).filter(Boolean);
  let index = 0;
  // A POSIX env prefix (FHF_LANE=e2e cy-cloud …) names the command after it, not itself.
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index += 1;
  const raw = (tokens[index] ?? "").replace(/^['"]+|['"]+$/g, "");
  const base = raw.split(/[\\\\/]/).pop() ?? "";
  return {
    name: base.toLowerCase().replace(/\\.(exe|cmd|bat|ps1)$/, ""),
    tokens: tokens.slice(index),
  };
}

function gitSubcommand(tokens) {
  for (let index = 1; index < tokens.length; index += 1) {
    if (VALUE_FLAGS.has(tokens[index])) { index += 1; continue; }
    if (tokens[index].startsWith("-")) continue;
    return tokens[index].toLowerCase();
  }
  return "";
}

function classify(command, allowed, config, allowGitReads) {
  const policy = shellInspectionPolicy(config);
  const value = String(command ?? "").trim();
  if (!value) return false;
  const scanned = value.replace(new RegExp(policy.discardRedirectPattern, "gi"), " ");
  if (new RegExp(policy.unsafeTokenPattern).test(scanned)) return false;
  const lower = (entries) => new Set((entries ?? []).map((entry) => String(entry).toLowerCase()));
  const readers = lower(allowed(policy));
  const navigation = lower(policy.navigationCommands);
  const gitReads = allowGitReads ? lower(policy.gitReadSubcommands) : new Set();
  const steps = shellSteps(scanned, config);
  if (!steps.length) return false;
  return steps.every((step) => {
    const { name, tokens } = stepExecutable(step);
    if (!name) return false;
    if (navigation.has(name) || readers.has(name)) return true;
    return name === "git" && gitReads.has(gitSubcommand(tokens));
  });
}

/** Inspection of a harness gate: readers, navigation and git read subcommands. */
export function isReadOnlyShellCommand(command, config) {
  return classify(command, (policy) => policy.readOnlyCommands, config, true);
}

/**
 * Inspection of a production artifact: listing and sizing only, never content. git is excluded —
 * "git show HEAD:cypress/screenshots/x.png" would print the very bytes this guard withholds.
 */
export function isMetadataOnlyShellCommand(command, config) {
  return classify(command, (policy) => policy.metadataOnlyCommands, config, false);
}
`;

const READ_GUARD_SOURCE = `#!/usr/bin/env node
// PreToolUse:Read — keep a single file read from refilling the conversation.
//
// ADR-0051: a client with no read-bounds field in its payload is not making an unbounded read, it
// is speaking a protocol that cannot express one. Cursor's read payload carries the path and the
// content and nothing else, so requiring tool_input.limit refused every read of a file over
// unboundedReadMaxBytes — including the read Cursor performs ahead of its own edit tools — and
// printed advice ("use limit") the client had no way to follow. Those clients are named in
// engineering.context.readOutput.boundsUnsupportedClients: the advice is still printed, on
// stderr, and the read proceeds. A client that CAN bound a read is gated exactly as before.
import { existsSync, readFileSync, statSync } from "node:fs";
import { engineeringConfig } from "./lib/harness-config.mjs";
import { hookFilePath, hookInput } from "./lib/hook-payload.mjs";
import { emitAllow } from "./lib/hook-runtime.mjs";

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  emitAllow();
  process.exit(0);
}
process.on("exit", (code) => code === 0 && emitAllow(payload));

const input = hookInput(payload);
const filePath = hookFilePath(payload);
const policy = engineeringConfig().context.readOutput;
const bound = readBound(input);
const isBounded = bound !== null && bound > 0 && bound <= policy.maxLines;
const isSmall =
  filePath &&
  existsSync(filePath) &&
  statSync(filePath).size <= policy.unboundedReadMaxBytes;

if (isBounded || isSmall) process.exit(0);
// A payload carrying replacement text is an edit, not a read. Cursor runs its read hook ahead of
// its edit tools, and the write guards — not this one — govern those.
if (isWritePayload(input)) process.exit(0);

if (boundsUnsupported()) {
  console.error(
    \`Unbounded read allowed: this client's read payload carries no line bound. \` +
      \`Keep reads to \${policy.maxLines} lines or fewer, or search with Grep rather than reading the whole file.\`,
  );
  process.exit(0);
}

console.error(
  \`BLOCKED: bound this Read to \${policy.maxLines} lines or fewer to prevent context thrashing. \` +
    \`Use limit: \${policy.maxLines}, then inspect the next chunk only if needed.\`,
);
process.exit(2);

// Every read-bound vocabulary the supported clients use: a count, or a pair that spans one.
function readBound(value) {
  if (!value || typeof value !== "object") return null;
  const counts = [value.limit, value.line_limit, value.lines, value.num_lines]
    .map(Number)
    .filter((count) => Number.isFinite(count) && count > 0);
  if (counts.length) return counts[0];
  const start = Number(value.offset ?? value.start_line ?? value.startLine ?? value.start_line_one_indexed);
  const end = Number(value.end_line ?? value.endLine ?? value.end_line_one_indexed_inclusive);
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return end - start + 1;
  return null;
}

function isWritePayload(value) {
  if (!value || typeof value !== "object") return false;
  return [value.content, value.new_string, value.patch, value.diff, value.edits]
    .some((field) => field !== undefined);
}

function boundsUnsupported() {
  const clients = (policy.boundsUnsupportedClients ?? [])
    .map((client) => String(client).toLowerCase());
  return clients.includes(payload?.cursor_version ? "cursor" : "claude");
}
`;

function readNormalized(file) {
  const raw = fs.readFileSync(file, "utf8");
  return { text: raw.replace(/\r\n/g, "\n"), eol: raw.includes("\r\n") ? "\r\n" : "\n" };
}

function writeNormalized(file, text, eol) {
  fs.writeFileSync(file, eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text);
}

function patchFile(file, steps) {
  const { text, eol } = readNormalized(file);
  const label = path.relative(ROOT, file);
  let next = text;
  let changed = false;
  for (const step of steps) {
    if (step.already(next)) continue;
    if (!next.includes(step.needle)) {
      throw new Error(`${label}: patch site not found — ${step.what}`);
    }
    next = next.replace(step.needle, step.replacement);
    changed = true;
  }
  if (!changed) {
    console.log(`${label}: already applied`);
    return;
  }
  writeNormalized(file, next, eol);
  console.log(`${label}: patched`);
}

/** Drop everything from a marker to end of file and put the replacement in its place. */
function replaceTail(file, marker, replacement) {
  const { text, eol } = readNormalized(file);
  const label = path.relative(ROOT, file);
  const index = text.indexOf(marker);
  if (index === -1) {
    if (text.includes(replacement.trim())) {
      console.log(`${label} tail: already applied`);
      return;
    }
    throw new Error(`${label}: tail marker not found — ${marker}`);
  }
  writeNormalized(file, `${text.slice(0, index)}${replacement}`, eol);
  console.log(`${label} tail: patched`);
}

function indented(value, indent) {
  return JSON.stringify(value, null, 2)
    .split("\n")
    .map((line, position) => (position === 0 ? line : `${indent}${line}`))
    .join("\n");
}

function applyControlPlane(text) {
  let next = text;
  if (next.includes('"shellInspection"')) {
    console.log("control plane shellInspection: already applied");
  } else {
    const needle = '          ".claude/hooks/"\n        ]\n      },\n';
    if (!next.includes(needle)) throw new Error("control plane: governance block not found");
    next = next.replace(
      needle,
      `${needle}      "shellInspection": ${indented(SHELL_INSPECTION, "      ")},\n`,
    );
    console.log("control plane shellInspection: patched");
  }

  if (next.includes('"boundsUnsupportedClients"')) {
    console.log("control plane boundsUnsupportedClients: already applied");
    return next;
  }
  const readOutput = next.match(/ {6}"readOutput": \{\n((?: {8}.*\n)+) {6}\},\n/);
  if (!readOutput) throw new Error("control plane: context.readOutput block not found");
  const body = readOutput[1].replace(/\n$/, "");
  next = next.replace(
    readOutput[0],
    `      "readOutput": {\n${body},\n        "boundsUnsupportedClients": [\n          "cursor"\n        ]\n      },\n`,
  );
  console.log("control plane boundsUnsupportedClients: patched");
  return next;
}

// The opt-in guards THIS repository's gates. A --target copy holds no gates: applying there is how
// the patch is proved before an owner runs it, and it writes nothing the harness protects.
if (ROOT === SELF_ROOT && process.env.FHF_ALLOW_HARNESS_EDIT !== "1") {
  throw new Error(
    "Set FHF_ALLOW_HARNESS_EDIT=1 to apply ADR-0051 (writes the control plane and three hook "
    + "sources). Only the owner sets it; an agent must not set it for itself. To preview, apply "
    + "to a copy: node docs/adr/0051-apply.mjs --target <copy>",
  );
}
if (!fs.existsSync(CONFIG)) throw new Error(`No control plane at ${CONFIG}`);

const { text: configText, eol: configEol } = readNormalized(CONFIG);
const patchedConfig = applyControlPlane(configText);
const config = JSON.parse(patchedConfig);
if (!config.engineering.harness.shellInspection?.readOnlyCommands?.length) {
  throw new Error("control plane: shellInspection did not land");
}
if (!config.engineering.context.readOutput.boundsUnsupportedClients?.length) {
  throw new Error("control plane: boundsUnsupportedClients did not land");
}
if (patchedConfig !== configText) writeNormalized(CONFIG, patchedConfig, configEol);

if (fs.existsSync(READ_INTENT) && fs.readFileSync(READ_INTENT, "utf8").includes("ADR-0051")) {
  console.log(`${path.relative(ROOT, READ_INTENT)}: already applied`);
} else {
  fs.writeFileSync(READ_INTENT, READ_INTENT_SOURCE);
  console.log(`${path.relative(ROOT, READ_INTENT)}: written`);
}

patchFile(GOVERNANCE, [
  {
    what: "import the shared classifier",
    already: (text) => text.includes("shell-read-intent.mjs"),
    needle: 'import { loadHarnessConfig } from "./lib/harness-config.mjs";\n',
    replacement:
      'import { loadHarnessConfig } from "./lib/harness-config.mjs";\n'
      + 'import { isReadOnlyShellCommand } from "./lib/shell-read-intent.mjs";\n',
  },
  {
    what: "classify the shell command with the shared vocabulary",
    already: (text) => text.includes("isReadOnlyShellCommand(cmd, config)"),
    needle: "  if (hit && !isReadOnlyCommand(cmd)) {",
    replacement: "  if (hit && !isReadOnlyShellCommand(cmd, config)) {",
  },
]);

replaceTail(
  GOVERNANCE,
  "// Read-only inspection is allowed:",
  `// Read-only inspection is allowed: reading a gate to understand it is the correct behavior, and
// is how an agent reports a gate defect instead of editing around it. ADR-0051 moved the
// vocabulary — the readers, the navigation commands, the git read subcommands and the tokens that
// disqualify a command outright — to engineering.harness.shellInspection, and the step-by-step
// classification to the shared lib next to this file, so this guard and protect-prod-data.mjs
// agree on what a read is.
//
// That allowlist still holds UNAMBIGUOUS readers only. Deliberately excluded, because each can
// write the very file it is pointed at: sed (-i), node (-e with fs), python (-c with open) and
// the writing git subcommands (apply, checkout --). An interpreter that merely happens to be
// reading is indistinguishable here from one that is rewriting, so it is denied and the operator
// supplies the inline opt-in instead.
`,
);

patchFile(PROD_DATA, [
  {
    what: "import the shared classifier",
    already: (text) => text.includes("shell-read-intent.mjs"),
    needle: "import { detectLane, loadHarnessConfig } from './lib/harness-config.mjs';\n",
    replacement:
      "import { detectLane, loadHarnessConfig } from './lib/harness-config.mjs';\n"
      + "import { isMetadataOnlyShellCommand, shellSteps } from './lib/shell-read-intent.mjs';\n",
  },
  {
    what: "judge Cloud CLI safety per step",
    already: (text) => text.includes("sensitiveSteps"),
    needle:
      "  const lowerCmd = cmd.toLowerCase();\n"
      + "  const isNoNetworkInspection = !/[;&|]/.test(cmd) && CLOUD_SAFE_FLAGS\n"
      + "    .some((flag) => lowerCmd.includes(String(flag).toLowerCase()));\n",
    replacement:
      "  // ADR-0051: a chain is judged step by step. Every step that names a production-sensitive\n"
      + "  // Cloud CLI call carries its own no-network flag, so a safe flag on one step cannot\n"
      + "  // cover a Test Replay chained after it.\n"
      + "  const sensitiveSteps = shellSteps(cmd, harness)\n"
      + "    .filter((step) => CLOUD_SENSITIVE.some((pattern) => pattern.test(step)));\n"
      + "  const isNoNetworkInspection = sensitiveSteps.length > 0 && sensitiveSteps\n"
      + "    .every((step) => CLOUD_SAFE_FLAGS\n"
      + "      .some((flag) => step.toLowerCase().includes(String(flag).toLowerCase())));\n",
  },
  {
    what: "classify the artifact command with the shared vocabulary",
    already: (text) => text.includes("isMetadataOnlyShellCommand(cmd, harness)"),
    needle: "    !isMetadataOnlyCommand(cmd)",
    replacement: "    !isMetadataOnlyShellCommand(cmd, harness)",
  },
]);

replaceTail(
  PROD_DATA,
  "function isMetadataOnlyCommand(command) {",
  `// ADR-0051: listing and sizing a production artifact is allowed, reading it is not. The
// vocabulary lives at engineering.harness.shellInspection.metadataOnlyCommands and the
// step-by-step classification in the shared read-intent lib, alongside the gate guard's.
`,
);

fs.writeFileSync(READ_GUARD, READ_GUARD_SOURCE);
console.log(`${path.relative(ROOT, READ_GUARD)}: written`);

console.log("");
console.log("ADR-0051 applied. Next:");
console.log("  node scripts/harness/test-hooks.mjs");
console.log("  node scripts/harness/verify-canonical.mjs");
console.log("  node scripts/harness/sync-loader-shims.mjs   # project the new lib into consumers");
