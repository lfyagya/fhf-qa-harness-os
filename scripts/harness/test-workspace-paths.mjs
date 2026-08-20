import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveConsumerRoot, resolveLaneRoot } from "./workspace-paths.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-workspace-paths-"));
const harnessRoot = path.join(root, "harness");
const consumerRoot = path.join(root, "consumer");

try {
  fs.mkdirSync(path.join(harnessRoot, "config"), { recursive: true });
  fs.writeFileSync(
    path.join(harnessRoot, "config", "qa-control-plane.json"),
    JSON.stringify({
      paths: {
        consumerRoot: "../consumer",
        lanes: {
          e2e: { root: "automation/e2e", rootEnv: "E2E_ROOT" },
          smoke: { root: "automation/smoke", rootEnv: "SMOKE_ROOT" },
        },
      },
    }),
    "utf8",
  );

  assert.equal(resolveConsumerRoot(harnessRoot, { env: {} }), consumerRoot);
  assert.equal(
    resolveConsumerRoot(harnessRoot, { env: { FHF_CONSUMER_ROOT: path.join(root, "configured-consumer") } }),
    path.join(root, "configured-consumer"),
  );
  assert.equal(
    resolveConsumerRoot(harnessRoot, { explicit: path.join(root, "sync-target"), env: { FHF_CONSUMER_ROOT: consumerRoot } }),
    path.join(root, "sync-target"),
  );
  assert.equal(
    resolveLaneRoot(harnessRoot, consumerRoot, "e2e", { env: {} }),
    path.join(consumerRoot, "automation", "e2e"),
  );
  assert.equal(
    resolveLaneRoot(harnessRoot, consumerRoot, "e2e", { env: { E2E_ROOT: path.join(root, "external-e2e") } }),
    path.join(root, "external-e2e"),
  );
  assert.equal(
    resolveLaneRoot(harnessRoot, consumerRoot, "smoke", { explicit: path.join(root, "target-smoke"), env: {} }),
    path.join(root, "target-smoke"),
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("workspace path resolution tests passed");
