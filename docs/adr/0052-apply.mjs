#!/usr/bin/env node
// ADR-0052 — lane evaluators spawn only when that lane changed.
//
//   FHF_ALLOW_HARNESS_EDIT=1 node docs/adr/0052-apply.mjs
//   node docs/adr/0052-apply.mjs --target <copy>   # no opt-in; copy holds no gates
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const targetFlag = process.argv.indexOf("--target");
const ROOT = targetFlag === -1
  ? SELF_ROOT
  : path.resolve(process.argv[targetFlag + 1] ?? "");
const CONFIG = path.join(ROOT, "config", "qa-control-plane.json");
const GOLDEN = path.join(ROOT, "scripts", "harness", "evals", "routes.golden.json");

const PRE_MERGE_OLD = `          "id": "pre-merge",
          "priority": 95,
          "match": "\\\\b(pre-?merge|ready to (commit|merge))\\\\b",
          "hint": "Pre-merge → spawn cypress-gate for the verdict.",
          "invoke": {
            "kind": "agent",
            "name": "cypress-gate"
          }`;

const PRE_MERGE_NEW = `          "id": "cypress-pre-merge",
          "priority": 108,
          "match": "(?=.*\\\\b(?:pre-?merge|ready to (?:commit|merge)|review before merge)\\\\b)(?=.*\\\\b(?:cypress|\\\\.cy\\\\.js|cypress-gate)\\\\b)",
          "hint": "Cypress pre-merge → spawn cypress-gate because this prompt named Cypress. It reviews specs and must not merge. Engine configuration uses engine-pre-merge, not this route.",
          "invoke": {
            "kind": "agent",
            "name": "cypress-gate"
          }
        },
        {
          "id": "engine-pre-merge",
          "priority": 107,
          "match": "(?=.*\\\\b(?:pre-?merge|ready to (?:commit|merge)|review before merge)\\\\b)(?=.*\\\\b(?:harness|engine|control[- ]plane|qa-control-plane|hooks?|ADR-00\\\\d{2}|verify-canonical)\\\\b)",
          "hint": "Engine pre-merge → stay in parent and run engine verification: node scripts/harness/test-hooks.mjs, node scripts/harness/doctor.mjs --selftest, node scripts/harness/verify-canonical.mjs. Do not spawn cypress-gate. Merge-readiness is those exits, not a lane evaluator.",
          "invoke": {
            "kind": "parent"
          }
        },
        {
          "id": "pre-merge",
          "priority": 95,
          "match": "\\\\b(pre-?merge|ready to (commit|merge))\\\\b",
          "hint": "Pre-merge → stay in parent. Spawn cypress-gate only if the diff contains Cypress specs or Cypress config. Spawn qa-automation-gate only if it contains backend pytest. Engine, harness, and docs changes: run test-hooks.mjs and verify-canonical.mjs; do not spawn a lane evaluator.",
          "invoke": {
            "kind": "parent"
          }`;

function readNormalized(file) {
  const raw = fs.readFileSync(file, "utf8");
  return { text: raw.replace(/\r\n/g, "\n"), eol: raw.includes("\r\n") ? "\r\n" : "\n" };
}

function writeNormalized(file, text, eol) {
  fs.writeFileSync(file, eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text);
}

if (ROOT === SELF_ROOT && process.env.FHF_ALLOW_HARNESS_EDIT !== "1") {
  throw new Error(
    "Set FHF_ALLOW_HARNESS_EDIT=1 to apply ADR-0052 (writes the control plane). "
    + "Only the owner sets it. Preview: node docs/adr/0052-apply.mjs --target <copy>",
  );
}

const { text, eol } = readNormalized(CONFIG);
if (text.includes('"id": "cypress-pre-merge"') && text.includes('"id": "engine-pre-merge"')) {
  console.log("control plane cypress-pre-merge: already applied");
} else {
  if (!text.includes(PRE_MERGE_OLD)) throw new Error("control plane: pre-merge block not found");
  writeNormalized(CONFIG, text.replace(PRE_MERGE_OLD, PRE_MERGE_NEW), eol);
  const next = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  const routes = next.engineering.context.routes;
  if (!routes.some((route) => route.id === "cypress-pre-merge")) {
    throw new Error("control plane: cypress-pre-merge did not land");
  }
  const generic = routes.find((route) => route.id === "pre-merge");
  if (generic?.invoke?.kind !== "parent") throw new Error("control plane: pre-merge invoke is not parent");
  if (!routes.some((route) => route.id === "engine-pre-merge")) {
    throw new Error("control plane: engine-pre-merge did not land");
  }
  console.log("control plane pre-merge: patched");
}

if (fs.existsSync(GOLDEN)) {
  const golden = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
  const pre = golden.cases.find((item) => item.id === "pre-merge");
  if (pre) pre.expectedAgent = null;
  if (!golden.cases.some((item) => item.id === "cypress-pre-merge")) {
    const index = golden.cases.findIndex((item) => item.id === "pre-merge");
    golden.cases.splice(index + 1, 0, {
      id: "cypress-pre-merge",
      prompt: "is this Cypress spec ready to merge?",
      expectedRoute: "cypress-pre-merge",
      expectedAgent: "cypress-gate",
    });
  }
  if (!golden.cases.some((item) => item.id === "engine-pre-merge")) {
    const index = golden.cases.findIndex((item) => item.id === "pre-merge");
    golden.cases.splice(index + 1, 0, {
      id: "engine-pre-merge",
      prompt: "is this harness config ready to merge?",
      expectedRoute: "engine-pre-merge",
      expectedAgent: null,
    });
  }
  fs.writeFileSync(GOLDEN, `${JSON.stringify(golden, null, 2)}\n`);
  console.log("routes.golden.json: patched");
}

console.log("");
console.log("ADR-0052 applied. Next: node scripts/harness/test-hooks.mjs");
