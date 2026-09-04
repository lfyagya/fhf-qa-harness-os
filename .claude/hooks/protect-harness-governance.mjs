#!/usr/bin/env node
// PreToolUse:Edit|Write and PreToolUse:Bash — deny agent writes to the harness's own gates.
// exit 2 = BLOCK the tool call.
//
// Why this exists (2026-09-05): every other guard in this directory constrains what an agent
// may do to the PRODUCT. Nothing constrained what it may do to the GUARDS. Verified by feeding
// all four Edit|Write PreToolUse hooks a payload targeting config/qa-control-plane.json,
// .claude/hooks/validate-cypress-rules.mjs and .claude/settings.json: every one returned 0.
// An agent that could not pass validate-cypress-rules.mjs could edit
// validate-cypress-rules.mjs, or lower a threshold in the control plane, and then pass.
//
// This is the documented failure mode, not a hypothetical. The public write-up of agents
// gaming a test suite names two variants directly: "silent threshold degradation" (an agent
// that cannot meet a target lowers the target instead of asking why) and agents that
// "discover loopholes in their own governance". Its recommended countermeasure is to store
// enforcement rules in paths the agent cannot modify. This hook is that countermeasure.
//
// There is a real instance in this repository's own history: minimumRepairSamples was added
// to engineering.context.evaluation.thresholds, a map the validator bounds to [0,1], and the
// validator was then widened to accept it. That specific change was defensible — a sample
// count does not belong in a rate range. The point is that nothing distinguished it from a
// threshold being quietly relaxed to turn a red gate green.
//
// Policy: default-deny, owner-only opt-in, exactly like protect-prod-data.mjs.
//   FHF_ALLOW_HARNESS_EDIT=1
// Shell state does not persist between agent Bash calls, so the agent cannot set this for
// itself for an Edit or Write — only the human launching the session can. For Bash the
// assignment is accepted inline on the command, because that is the only way an operator can
// express it there; that is a deliberately narrower guarantee, matching the FHF_LANE=e2e
// precedent in protect-prod-data.mjs.
//
// Scope is the DETERMINISTIC gates only — the control plane, the generated settings, and the
// hook sources. Not .claude/rules/** or .claude/agents/**: those are prompt-layer text,
// changed as routine work, and their roster/routing changes are already ADR-gated by review.
// Protecting them would block ordinary authoring for no enforcement gain.
//
// The protected list lives INSIDE the protected file (engineering.harness.governance), so
// narrowing the guard is itself a guarded edit. That is intentional.
//
// ponytail: default-deny is uniform across lanes. The sharper rule is lane-scoped — an agent
// writing specs in a consumer lane has no business touching a gate, while the harness
// maintainer edits gates all day — but that needs trace evidence about which lane the
// blocked edits actually come from. Narrow via engineering.harness.governance.protectedPaths
// if the uniform rule proves noisy; add detectLane() branching only if the config list is not
// enough.
//
// This guards the WRITE path. It does not stop an agent from proposing a gate change in a
// PR for a human to merge, which is the intended route, and it does not verify that a
// permitted change is correct — that remains ADR review's job.
import { readFileSync } from "node:fs";
import { loadHarnessConfig } from "./lib/harness-config.mjs";
import { hookFilePath, hookInput } from "./lib/hook-payload.mjs";
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
const governance = config.engineering?.harness?.governance ?? {};
const OVERRIDE_ENV = governance.ownerOverrideEnv ?? "FHF_ALLOW_HARNESS_EDIT";

if (process.env[OVERRIDE_ENV] === "1") process.exit(0);

// Suffix matching on purpose: the same logical file exists at the engine root, at the FHF
// workspace root as a generated projection, and inside each consumer clone. One pattern set
// covers all of them without resolving which root a path belongs to.
const PROTECTED = (governance.protectedPaths ?? [
  "config/qa-control-plane.json",
  ".claude/settings.json",
  ".claude/harness.config.json",
  ".claude/hooks/",
]).map((entry) => String(entry).replaceAll("\\", "/"));

function protectedTarget(candidate) {
  const value = String(candidate ?? "").replaceAll("\\", "/");
  if (!value) return null;
  return PROTECTED.find((entry) => (
    entry.endsWith("/")
      ? value.includes(`/${entry}`) || value.startsWith(entry)
      : value.endsWith(`/${entry}`) || value === entry
  )) ?? null;
}

function deny(target, what, detail) {
  console.error(`BLOCKED: ${what} modifies a harness gate (${target}).`);
  if (detail) console.error(detail);
  console.error("");
  console.error("The control plane, the generated settings and the hook sources are the");
  console.error("gates themselves. An agent that can edit them can turn any red gate green,");
  console.error("so they are default-deny.");
  console.error("");
  console.error("If the gate is genuinely wrong, do NOT edit it to pass. Either:");
  console.error("  - report the gate defect and let the owner decide, or");
  console.error("  - the owner re-launches the session with the opt-in:");
  console.error(`      ${OVERRIDE_ENV}=1`);
  console.error("The agent must not set this itself.");
  console.error("");
  console.error("Structural changes here also need an ADR in docs/adr/ — see docs/governance.md.");
  process.exit(2);
}

const toolName = payload?.tool_name ?? payload?.name ?? "";

// ── Edit / Write ──
const filePath = hookFilePath(payload);
const fileHit = protectedTarget(filePath);
if (fileHit) deny(fileHit, "that write", `Path: ${filePath}`);

// ── Shell ──
// A protected path named in a shell command is denied unless the command is a read-only
// inspection, or the operator supplied the opt-in inline on the command itself.
if (/^(?:bash|shell|powershell)$/i.test(toolName) || payload?.tool_input?.command) {
  const cmd = String(hookInput(payload).command ?? "");
  if (new RegExp(`\\b${OVERRIDE_ENV}\\s*=\\s*1\\b`).test(cmd)) process.exit(0);
  const normalised = cmd.replaceAll("\\", "/");
  const hit = PROTECTED.find((entry) => normalised.includes(entry.replace(/\/$/, "")));
  if (hit && !isReadOnlyCommand(cmd)) {
    deny(hit, "that command", `Command: ${cmd.slice(0, 200)}`);
  }
}

process.exit(0);

// Read-only inspection is allowed: reading a gate to understand it is the correct behavior,
// and is how an agent reports a gate defect instead of editing around it. Anything with a
// redirect, substitution, pipe, chain or newline is not classified as read-only, because a
// single such command can rewrite the file.
//
// The allowlist holds UNAMBIGUOUS readers only. Deliberately excluded, because each can write
// the very file it is pointed at: sed (-i), node (-e with fs), python (-c with open(...,'w')),
// and git (apply, checkout --). An interpreter that merely happens to be reading is
// indistinguishable here from one that is rewriting, so it is denied and the operator supplies
// the inline opt-in instead.
function isReadOnlyCommand(command) {
  const value = command.trim();
  if (!value || /[\r\n;&|><`$]/.test(value)) return false;
  const executable = value.match(/^([a-z0-9_.-]+)/i)?.[1]?.toLowerCase();
  return new Set([
    "cat",
    "dir",
    "diff",
    "get-childitem",
    "get-content",
    "gc",
    "gci",
    "grep",
    "head",
    "jq",
    "ls",
    "rg",
    "stat",
    "tail",
    "test-path",
    "wc",
  ]).has(executable);
}
