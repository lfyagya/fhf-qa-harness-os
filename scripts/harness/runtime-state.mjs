import { loadHarnessConfig } from "../../.claude/hooks/lib/harness-config.mjs";
import {
  LOOP_STATE_SCHEMA,
  TRACE_SCHEMA,
  appendTrace as appendPortableTrace,
  baseConfigFingerprint as basePortableConfigFingerprint,
  createLoopState as createPortableLoopState,
  effectiveConfigFingerprint as effectivePortableConfigFingerprint,
  serializeTrace as serializePortableTrace,
  updateLoopState as updatePortableLoopState,
  writeRuntimeArtifact,
} from "./portable-runtime-state.mjs";

export { LOOP_STATE_SCHEMA, TRACE_SCHEMA, writeRuntimeArtifact };

export function baseConfigFingerprint(config = loadHarnessConfig()) {
  return basePortableConfigFingerprint(config);
}

export function effectiveConfigFingerprint(config = loadHarnessConfig()) {
  return effectivePortableConfigFingerprint(config);
}

export function createLoopState(options = {}) {
  return createPortableLoopState({ ...options, config: options.config ?? loadHarnessConfig() });
}

export function updateLoopState(state, patch = {}, config = loadHarnessConfig()) {
  return updatePortableLoopState(state, patch, config);
}

export function serializeTrace(event, config = loadHarnessConfig()) {
  return serializePortableTrace(event, config);
}

export function appendTrace(file, event, config = loadHarnessConfig()) {
  return appendPortableTrace(file, event, config);
}
