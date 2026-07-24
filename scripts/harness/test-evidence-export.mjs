import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  publishEvidenceBundle,
  writeBundleAtomic,
} from "./evidence-export-policy.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fhf-evidence-export-"));
const harnessRoot = path.join(root, "harness");
const consumerRoot = path.join(root, "consumer");
const evidenceDir = path.join(consumerRoot, "docs", "evidence");
const policy = {
  command: "test",
  harnessRoot,
  consumerRoot,
  evidenceDir,
  runtimeFiles: ["one.json", "two.md"],
};

try {
  fs.mkdirSync(consumerRoot, { recursive: true });
  fs.writeFileSync(
    path.join(consumerRoot, ".gitignore"),
    [
      "docs/evidence/one.json",
      "docs/evidence/two.md",
      "docs/evidence/*.json.lock",
      "docs/evidence/*.*.tmp",
      "docs/evidence/*.*.bak",
      "",
    ].join("\n"),
    "utf8"
  );
  const first = path.join(evidenceDir, "one.json");
  const second = path.join(evidenceDir, "two.md");
  const files = [
    { file: first, content: "{}\n" },
    { file: second, content: "# Report\n" },
  ];
  assert.throws(() => publishEvidenceBundle({ ...policy, consent: null }, files));
  publishEvidenceBundle({ ...policy, consent: "approval-1" }, files);
  assert.throws(() => publishEvidenceBundle({ ...policy, consent: "approval-1" }, files));
  assert.equal(fs.readFileSync(first, "utf8"), "{}\n");
  assert.equal(fs.readFileSync(second, "utf8"), "# Report\n");
  const staleLock = path.join(harnessRoot, ".qa-consent-ledger.json.lock");
  fs.writeFileSync(staleLock, JSON.stringify({ pid: 2147483647 }), "utf8");
  assert.throws(() => publishEvidenceBundle({ ...policy, consent: "approval-2" }, files));
  fs.rmSync(staleLock);
  publishEvidenceBundle({ ...policy, consent: "approval-2" }, files);
  assert.equal(fs.existsSync(staleLock), false);

  assert.throws(() => writeBundleAtomic([
    { file: first, content: "{\"staged\":true}\n" },
    { file: second, content: "# Staged\n" },
  ], { failDuringStage: 2 }));
  assert.equal(fs.readFileSync(first, "utf8"), "{}\n");
  assert.equal(fs.readFileSync(second, "utf8"), "# Report\n");

  assert.throws(() => writeBundleAtomic([
    { file: first, content: "{\"changed\":true}\n" },
    { file: second, content: "# Changed\n" },
  ], { failAfterPublish: 1 }));
  assert.equal(fs.readFileSync(first, "utf8"), "{}\n");
  assert.equal(fs.readFileSync(second, "utf8"), "# Report\n");
  assert.equal(
    fs.readdirSync(evidenceDir).some((name) => /\.(tmp|bak)$/.test(name)),
    false
  );
  assert.equal(
    fs.readdirSync(harnessRoot).some((name) => /\.(tmp|bak|lock)$/.test(name)),
    false
  );
  console.log("evidence-export policy tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
