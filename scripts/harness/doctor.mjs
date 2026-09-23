#!/usr/bin/env node
// One front door for "the harness blocked me and I do not know why".
//
// ADR-0038 established that repair splits in two: Class A is deterministic reconstruction from a
// committed authority and is safe to automate; Class B is verdicts and evidence and is never
// automated. This script diagnoses both, repairs only Class A under --fix, and for everything else
// prints the exact command or owner question that clears it.
//
// It exists because the guards are accurate and unhelpful in the same breath. "an unapproved task
// may act only from planned, approved, implementing, or verified stage" is true, and it does not
// tell you what to type. Every one of those messages has a known mechanical answer; until emitDeny
// lands (ADR-0038, needs the owner opt-in) the hooks cannot carry it, so it lives here.
//
//   node scripts/harness/doctor.mjs                  diagnose everything
//   node scripts/harness/doctor.mjs --fix            apply Class A repairs
//   node scripts/harness/doctor.mjs --explain <text> what a block means and how to clear it
//   node scripts/harness/doctor.mjs --selftest       prove the explainer and checks work
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveConsumerRoot } from "./workspace-paths.mjs";
import { resolveActiveTask } from "./task-protocol-lib.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FHF_ROOT = resolveConsumerRoot(HARNESS_ROOT);
const CONTROL_PLANE = JSON.parse(
  fs.readFileSync(path.join(HARNESS_ROOT, "config", "qa-control-plane.json"), "utf8"),
);

const SETUP_FILE = CONTROL_PLANE.workspaceContract?.setupFile ?? ".harness/workspace.local.json";
const LANES = CONTROL_PLANE.paths?.lanes ?? {};

// ── The remedy table ──────────────────────────────────────────────────────
//
// `match` is tested against a pasted block message; `hooks` lets someone who only knows the hook
// name find the same entry. Keep `means` to one line — if it needs a paragraph, the guard is
// enforcing something the docs should explain, not the doctor.
const REMEDIES = [
  {
    match: /no active task|must point to the selected task manifest|must be an absolute path/i,
    hooks: ["protect-automation-scope", "validate-backend-automation"],
    means: "Automation writes are task-scoped and no manifest is selected for this work (ADR-0043).",
    dos: [
      "Name the ticket (SERV-n) or the task title in the prompt; the router selects its manifest.",
      "node .harness/task-protocol.mjs list            # which manifests exist, which is active",
      "node .harness/task-protocol.mjs path --ticket SERV-n   # where a missing manifest belongs",
    ],
  },
  {
    match: /unapproved task may act only from|task stage .* is not/i,
    hooks: ["protect-automation-scope"],
    means: "The manifest exists but its stage does not permit this action yet.",
    dos: [
      "node .harness/task-protocol.mjs next --manifest <active task.json>",
      "Advance the stage only after its gate is stamped — the stage is a consequence, not a switch.",
    ],
  },
  {
    match: /digest-bound human approval|approval is missing or stale|human approval required for gate/i,
    hooks: ["enforce-task-gates", "protect-automation-scope"],
    means: "A human gate is unstamped, or the thing it approved changed and invalidated the stamp.",
    dos: [
      "node .harness/task-protocol.mjs digest --manifest <active task.json>   # names the pending gate",
      "node .harness/task-protocol.mjs approve --manifest <active task.json> --gate <id>",
      "Only a human may approve. An agent must not run the approve command on the owner's behalf.",
    ],
  },
  {
    match: /outside grounding\.repositories\.selectedPaths|outside plan\.changeUnits/i,
    hooks: ["protect-automation-scope"],
    means: "The file is real, but this task never selected it, so it is out of scope for this task.",
    dos: [
      "Either edit a path the manifest selected, or widen selection and re-approve:",
      "  add the path to grounding.repositories.selectedPaths / plan.changeUnits, then re-approve the plan gate",
      "Widening selection invalidates the existing approval by design.",
    ],
  },
  {
    match: /outside allowed roots|automation path is protected/i,
    hooks: ["protect-automation-scope", "validate-backend-automation"],
    means: "The path is outside the lane's writable roots, or is a secret/artifact that is never writable.",
    dos: [
      "Check boundaries.automationSource.repositories.<repo>.allowedWriteRoots in the control plane.",
      "Secrets (tests/.env, config/config.ini, *.pem) are permanently denied — never work around this.",
    ],
  },
  {
    match: /repository HEAD changed|HEAD cannot be verified/i,
    hooks: ["protect-automation-scope"],
    means: "The repo moved under the manifest, so the frozen source it approved is no longer what is there.",
    dos: [
      "Re-ground the task against the new HEAD, then re-approve. Do not edit the recorded SHA by hand.",
    ],
  },
  {
    match: /WORKSPACE BLOCKED|configuration is unavailable or invalid|configuration is incomplete for lane/i,
    hooks: ["prompt-router"],
    means: "This shell's directory has no valid workspace contract — usually a cd into a lane or worktree.",
    dos: [
      "From the PowerShell tool:  Set-Location <workspace-root>   (a plain `cd` is intercepted and cannot clear it)",
      "If the setup file is genuinely missing:  node .harness/setup.mjs",
      "node .harness/verify.mjs change",
    ],
  },
  {
    match: /modifies a harness gate/i,
    hooks: ["protect-harness-governance"],
    means: "The target is a gate itself — the control plane, generated settings, or a hook source.",
    dos: [
      "Do not edit a gate to make it pass. Report the defect, or the owner re-launches with FHF_ALLOW_HARNESS_EDIT=1.",
      "Structural gate changes also need an ADR in docs/adr/.",
    ],
  },
  {
    match: /read-only per .*applicationSource|application source is read-only/i,
    hooks: ["protect-app-source", "manual-task-guard"],
    means: "That is product source. It is evidence to read, never a place for automation changes.",
    dos: ["Make the change in the selected automation repository instead."],
  },
  {
    match: /holds live production customer data/i,
    hooks: ["protect-prod-data"],
    means: "The artifact came from a smoke run against production.",
    dos: [
      "Use reports/junit/*.xml or Cypress Cloud instead.",
      "If the artifact is genuinely needed, ask the owner; they re-launch with FHF_ALLOW_PROD_DATA=1.",
      "An agent must never set that itself.",
    ],
  },
  {
    match: /is not in the FHF allowlist|routed only for lanes/i,
    hooks: ["block-forbidden-skills"],
    means: "The skill is not allow-listed, or not allow-listed for this lane.",
    dos: [
      "Check engineering.harness.skills and engineering.harness.skillLanes.",
      "Adding a skill is an ADR-0022 decision, not a config tweak.",
    ],
  },
  {
    match: /subagent type is forbidden|agent .* is forbidden/i,
    hooks: ["block-generic-agents"],
    means: "That agent type is not on the configured roster, or is retired.",
    dos: [
      "Use a configured agent from engineering.harness.agents.",
      "Via the Workflow tool, set opts.agentType explicitly — agent() otherwise bypasses the roster matcher.",
    ],
  },
  {
    match: /bound this Read to \d+ lines/i,
    hooks: ["context-read-guard"],
    means: "A whole-file read was refused to stop context thrashing.",
    dos: ["Re-read with limit set to the configured maximum, then page with offset if needed."],
  },
  {
    match: /no observed probe result is recorded|not declared in this local workspace|live-probe-required/i,
    hooks: ["prompt-router"],
    means: "A capability needs a recorded probe for this subject before its evidence may be used.",
    dos: [
      "Use the connector to perform the read, then record only the observed outcome:",
      "  node .harness/capability-doctor.mjs --capability <id> --subject <subject> --outcome <outcome>",
      "Valid outcomes come from the capability's own `outcomes` map — run with a wrong one to have them listed.",
    ],
  },
  {
    match: /declared trace\(s\) name something that does not exist|declare no traces/i,
    hooks: ["validate-spec-linkage"],
    means: "A spec's declared traces do not resolve, or business rules carry none.",
    dos: ["Fix the trace target to a path:line that exists, or add traces for the untraced rules."],
  },
  {
    match: /pytest command must include|only configured backend pytest commands|one unchained command/i,
    hooks: ["validate-backend-automation"],
    means: "The run command is not one of the configured pytest forms, or names a path the task did not select.",
    dos: [
      "Use a configured prefix (pytest / python -m pytest / py -m pytest) with an exact manifest test path.",
      "No shell chaining, redirection, or production environment.",
    ],
  },
];

function explain(query) {
  const needle = String(query ?? "").trim();
  if (!needle) {
    console.error("Usage: node scripts/harness/doctor.mjs --explain \"<pasted block message or hook name>\"");
    process.exit(1);
  }
  const hits = REMEDIES.filter(
    (entry) => entry.match.test(needle) || entry.hooks.some((hook) => needle.includes(hook)),
  );
  if (!hits.length) {
    console.log(`No remedy is recorded for: ${needle}`);
    console.log("");
    console.log("Run the full diagnosis, which may name it:  node scripts/harness/doctor.mjs");
    console.log("If a guard refused you with no recorded remedy, that is itself the defect — report it.");
    return;
  }
  for (const hit of hits) {
    console.log(`\n${hit.means}`);
    console.log(`  guards: ${hit.hooks.join(", ")}`);
    for (const step of hit.dos) console.log(`  - ${step}`);
  }
}

// ── Diagnosis ─────────────────────────────────────────────────────────────
const findings = [];
const record = (state, label, detail, remedy) => findings.push({ state, label, detail, remedy });

function checkWorkspaceSetup() {
  const file = path.join(FHF_ROOT, SETUP_FILE);
  if (!fs.existsSync(file)) {
    return record("fail", "workspace contract", `${SETUP_FILE} is missing`, "node .harness/setup.mjs");
  }
  try {
    JSON.parse(fs.readFileSync(file, "utf8"));
    record("ok", "workspace contract", SETUP_FILE);
  } catch (error) {
    record("fail", "workspace contract", `${SETUP_FILE} does not parse: ${error.message}`,
      "Repair or remove that file, then: node .harness/setup.mjs");
  }
}

function checkLanes() {
  for (const [lane, config] of Object.entries(LANES)) {
    if (!config.root) continue;
    const root = path.join(FHF_ROOT, config.root);
    if (!fs.existsSync(root)) {
      record("warn", `lane ${lane}`, `${config.root} is not checked out here`, null);
      continue;
    }
    const marker = path.join(root, ".harness", "lane.json");
    if (!fs.existsSync(marker)) {
      record("fail", `lane ${lane}`, "no .harness/lane.json — the lane resolves as \"root\"",
        "node scripts/harness/sync-loader-shims.mjs");
    } else {
      let declared = null;
      try {
        declared = JSON.parse(fs.readFileSync(marker, "utf8")).lane;
      } catch { /* reported below as a mismatch */ }
      if (declared !== lane) {
        record("fail", `lane ${lane}`, `lane.json declares "${declared}"`,
          "node scripts/harness/sync-loader-shims.mjs");
      } else {
        record("ok", `lane ${lane}`, config.root);
      }
    }
  }
}

// Class A: .npmrc is gitignored, so a fresh clone has the example and not the file. Without it
// Cypress fails with "Cannot find module 'C:\\cypress\\bin\\cypress'".
function npmrcRepairs() {
  const jobs = [];
  for (const [lane, config] of Object.entries(LANES)) {
    if (!config.package || !config.root) continue;
    const dir = path.join(FHF_ROOT, config.root, config.package);
    const target = path.join(dir, ".npmrc");
    const example = path.join(dir, ".npmrc.example");
    if (!fs.existsSync(dir) || fs.existsSync(target) || !fs.existsSync(example)) continue;
    jobs.push({ lane, target, example });
  }
  return jobs;
}

function checkNpmrc(jobs) {
  for (const [lane, config] of Object.entries(LANES)) {
    if (!config.package || !config.root) continue;
    const dir = path.join(FHF_ROOT, config.root, config.package);
    if (!fs.existsSync(dir)) continue;
    if (fs.existsSync(path.join(dir, ".npmrc"))) record("ok", `npmrc ${lane}`, ".npmrc present");
  }
  for (const job of jobs) {
    record("fail", `npmrc ${job.lane}`, ".npmrc missing (gitignored; a fresh clone has only the example)",
      "node scripts/harness/doctor.mjs --fix");
  }
}

function checkProjectionDrift() {
  const result = spawnSync(process.execPath,
    [path.join(HARNESS_ROOT, "scripts", "harness", "check-loader-drift.mjs"), "--only-root"],
    { encoding: "utf8", cwd: HARNESS_ROOT });
  if (result.status === 0) return record("ok", "projection", "no drift against the engine");
  record("fail", "projection", "drift against the engine",
    "node scripts/harness/sync-loader-shims.mjs");
}

// ── Version lock and sync notice ──────────────────────────────────────────
//
// A teammate's real question is "is my workspace current with the engine?". Two ways to be
// behind, and only one was covered: consumer files drifting from what sync wrote (check-loader-drift
// catches that), and the engine moving on without sync being re-run (nothing caught that).
// sync-reminder.mjs is advisory prose that fires only when you personally edit a rules file, and it
// names no command.
//
// This records the engine revision at the last successful sync and compares it to the engine now.
// It is a WARNING, never a block: being behind is a nudge, not a gate. The revision file lives in
// .harness/, which is machine-local and outside the protected gate paths.
const REVISION_FILE = path.join(FHF_ROOT, ".harness", "synced-revision.json");

function engineRevision() {
  const result = spawnSync("git", ["-C", HARNESS_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function lockedRevision() {
  if (!fs.existsSync(REVISION_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(REVISION_FILE, "utf8"));
  } catch {
    return null;
  }
}

function stampRevision() {
  const sha = engineRevision();
  if (!sha) return null;
  const stamp = {
    schema: "fhf-harness/synced-revision/v1",
    engineSha: sha,
    syncedAt: new Date().toISOString(),
    controlPlaneVersion: CONTROL_PLANE.version ?? null,
    catalogVersion: CONTROL_PLANE.productTopology?.catalogVersion ?? null,
  };
  fs.mkdirSync(path.dirname(REVISION_FILE), { recursive: true });
  fs.writeFileSync(REVISION_FILE, `${JSON.stringify(stamp, null, 2)}\n`, "utf8");
  return stamp;
}

function describeRevision() {
  const locked = lockedRevision();
  const current = engineRevision();
  return {
    locked,
    current,
    label: `harness v${CONTROL_PLANE.version ?? "?"} catalog ${CONTROL_PLANE.productTopology?.catalogVersion ?? "?"}`
      + (current ? ` engine ${current.slice(0, 8)}` : ""),
  };
}

function checkSyncedRevision({ fix }) {
  const { locked, current } = describeRevision();
  if (!current) return record("warn", "version lock", "engine revision cannot be read (not a git checkout?)", null);

  if (fix) {
    const stamp = stampRevision();
    return record("fixed", "version lock", `stamped engine ${stamp.engineSha.slice(0, 8)}`);
  }
  if (!locked) {
    return record("warn", "version lock", "no synced revision recorded yet",
      "node scripts/harness/doctor.mjs --fix");
  }
  if (locked.engineSha === current) {
    return record("ok", "version lock", `current with engine ${current.slice(0, 8)} (synced ${locked.syncedAt})`);
  }

  const behind = spawnSync("git",
    ["-C", HARNESS_ROOT, "rev-list", "--count", `${locked.engineSha}..HEAD`], { encoding: "utf8" });
  const count = behind.status === 0 ? behind.stdout.trim() : "?";
  record("warn", "version lock",
    `engine moved ${count} commit(s): ${locked.engineSha.slice(0, 8)} -> ${current.slice(0, 8)}`,
    "node scripts/harness/sync-loader-shims.mjs && node scripts/harness/doctor.mjs --fix");
}

function checkActiveTask() {
  const active = resolveActiveTask({ root: FHF_ROOT, config: CONTROL_PLANE });
  const value = active.file;
  if (!value) {
    return record("warn", "active task", "no task selected — automation writes will be refused",
      "name the ticket or task title in the prompt, then: node .harness/task-protocol.mjs list");
  }
  if (!fs.existsSync(value)) {
    return record("fail", "active task", `${active.source} selects a file that does not exist: ${value}`,
      "node .harness/task-protocol.mjs list");
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(value, "utf8"));
    record("ok", "active task", `${manifest.id} via ${active.source} stage=${manifest.stage} ticket=${manifest.ticketFamily?.primary ?? "local"}`);
    const gates = CONTROL_PLANE.engineering?.taskProtocol?.approval?.gates ?? [];
    const required = gates.filter((gate) => (gate.requiredFrom ?? []).includes(manifest.stage));
    const stamps = manifest.approval?.stamps ?? {};
    const pending = required.filter((gate) => !stamps[gate.id]);
    if (!required.length) {
      record("warn", "task gates", `stage "${manifest.stage}" requires no gates`, null);
    } else if (pending.length) {
      record("fail", "task gates",
        `pending: ${pending.map((gate) => gate.id).join(", ")} (of ${required.map((g) => g.id).join(" -> ")})`,
        `A human runs: node .harness/task-protocol.mjs approve --manifest ${value} --gate ${pending[0].id}`);
    } else {
      record("ok", "task gates", `all stamped: ${required.map((gate) => gate.id).join(", ")}`);
    }
  } catch (error) {
    record("fail", "active task", `manifest does not parse: ${error.message}`, null);
  }
}

function diagnose({ fix }) {
  checkWorkspaceSetup();
  checkLanes();

  const jobs = npmrcRepairs();
  if (fix) {
    for (const job of jobs) {
      fs.copyFileSync(job.example, job.target);
      record("fixed", `npmrc ${job.lane}`, "copied .npmrc.example -> .npmrc");
    }
    checkNpmrc([]);
  } else {
    checkNpmrc(jobs);
  }

  checkProjectionDrift();
  checkSyncedRevision({ fix });
  checkActiveTask();

  const ICONS = { ok: "ok   ", warn: "warn ", fail: "FAIL ", fixed: "FIXED" };
  console.log("");
  console.log(describeRevision().label);
  console.log("");
  for (const finding of findings) {
    console.log(`${ICONS[finding.state]} ${finding.label.padEnd(22)} ${finding.detail}`);
    if (finding.remedy) console.log(`      -> ${finding.remedy}`);
  }

  const failed = findings.filter((finding) => finding.state === "fail");
  const fixed = findings.filter((finding) => finding.state === "fixed");
  console.log("");
  if (fixed.length) console.log(`Repaired ${fixed.length} Class A item(s).`);
  if (!failed.length) {
    console.log("No blocking problems found.");
    return;
  }
  console.log(`${failed.length} blocking problem(s). Each line above names its fix.`);
  console.log("Paste any guard message into --explain for the same answer:");
  console.log('  node scripts/harness/doctor.mjs --explain "<message>"');
  process.exit(1);
}

function selftest() {
  const cases = [
    ["no active task: name the ticket or task title in the prompt", /task-protocol\.mjs list/],
    ["BLOCKED: an unapproved task may act only from planned", /task-protocol\.mjs next/],
    ["backend automation requires current digest-bound human approval", /--gate <id>/],
    ["path is outside plan.changeUnits paths: tests/x.py", /re-approve/i],
    ["WORKSPACE BLOCKED: Harness configuration is unavailable", /Set-Location/],
    ["BLOCKED: that write modifies a harness gate (.claude/settings.json)", /FHF_ALLOW_HARNESS_EDIT=1/],
    ["BLOCKED: bound this Read to 120 lines or fewer", /limit/],
    ["protect-prod-data", /FHF_ALLOW_PROD_DATA=1/],
    ["context-read-guard", /limit/],
  ];

  let failed = 0;
  for (const [message, expected] of cases) {
    const hits = REMEDIES.filter(
      (entry) => entry.match.test(message) || entry.hooks.some((hook) => message.includes(hook)),
    );
    const text = hits.flatMap((hit) => [hit.means, ...hit.dos]).join("\n");
    const ok = hits.length > 0 && expected.test(text);
    console.log(`${ok ? "ok  " : "FAIL"} ${message.slice(0, 62)}`);
    if (!ok) failed += 1;
  }

  // Every guard that can block should be reachable by name, or its absence is the next gap.
  const named = new Set(REMEDIES.flatMap((entry) => entry.hooks));
  console.log(`\n${named.size} guards reachable by name via --explain.`);

  if (failed) {
    console.error(`${failed} selftest case(s) failed.`);
    process.exit(1);
  }
  console.log(`${cases.length} selftest cases passed.`);
}

const args = process.argv.slice(2);
if (args[0] === "--selftest") selftest();
else if (args[0] === "--explain") explain(args.slice(1).join(" "));
else diagnose({ fix: args.includes("--fix") });
