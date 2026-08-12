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

export function detectLane(cwd, config = loadHarnessConfig()) {
  const resolved = path.resolve(cwd || process.cwd()).replace(/\\/g, "/").toLowerCase();
  const lanes = Object.entries(config.paths?.lanes ?? {})
    .map(([name, value]) => ({
      name,
      root: String(value?.root ?? "").replace(/\\/g, "/").toLowerCase(),
    }))
    .filter((lane) => lane.root)
    .sort((a, b) => b.root.length - a.root.length);
  for (const { name, root } of lanes) {
    const needle = `/${root}`;
    if (resolved.includes(`${needle}/`) || resolved.endsWith(needle)) return name;
  }
  return "root";
}

export function engineeringConfig() {
  const engineering = loadHarnessConfig().engineering;
  if (!engineering) throw new Error("Harness config is missing engineering");
  return engineering;
}
