import fs from "node:fs";
import path from "node:path";

function nonBlank(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function loadWorkspacePathsConfig(harnessRoot) {
  const file = path.join(harnessRoot, "config", "qa-control-plane.json");
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read workspace path configuration at ${file}: ${error.message}`);
  }
  if (!nonBlank(config?.paths?.consumerRoot)) {
    throw new Error(`Workspace path configuration at ${file} is missing paths.consumerRoot`);
  }
  return config.paths;
}

export function resolveConsumerRoot(harnessRoot, { explicit, env = process.env } = {}) {
  const configured = loadWorkspacePathsConfig(harnessRoot).consumerRoot;
  const selected = nonBlank(explicit) ?? nonBlank(env.FHF_CONSUMER_ROOT) ?? configured;
  return path.resolve(harnessRoot, selected);
}

export function resolveLaneRoot(harnessRoot, consumerRoot, lane, { explicit, env = process.env } = {}) {
  const laneConfig = loadWorkspacePathsConfig(harnessRoot).lanes?.[lane];
  if (!laneConfig) throw new Error(`Workspace path configuration is missing paths.lanes.${lane}`);
  const selected = nonBlank(explicit)
    ?? nonBlank(laneConfig.rootEnv && env[laneConfig.rootEnv])
    ?? nonBlank(laneConfig.root);
  if (!selected) throw new Error(`Workspace path configuration is missing paths.lanes.${lane}.root`);
  return path.isAbsolute(selected) ? path.resolve(selected) : path.resolve(consumerRoot, selected);
}
