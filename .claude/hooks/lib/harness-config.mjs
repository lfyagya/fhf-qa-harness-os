import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  process.env.FHF_HARNESS_CONFIG,
  path.resolve(HERE, "..", "..", "harness.config.json"),
  path.resolve(HERE, "..", "..", "..", "config", "qa-control-plane.json"),
].filter(Boolean);

export function loadHarnessConfig() {
  const file = CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error(`Harness config not found. Checked: ${CANDIDATES.join(", ")}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function engineeringConfig() {
  const engineering = loadHarnessConfig().engineering;
  if (!engineering) throw new Error("Harness config is missing engineering");
  return engineering;
}
