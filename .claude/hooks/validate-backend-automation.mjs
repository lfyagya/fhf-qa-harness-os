#!/usr/bin/env node
// PostToolUse:Edit|Write — validate changed backend Python against repository-native contracts.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadHarnessConfig } from "./lib/harness-config.mjs";
import { hookContent, hookFilePath } from "./lib/hook-payload.mjs";
import { emitAllow } from "./lib/hook-runtime.mjs";
import { authorizeAutomationWrite } from "./lib/task-scope.mjs";

const PYTHON_CHECK = String.raw`
import ast
import json
import sys

source = sys.stdin.read()
tree = ast.parse(source)
issues = []

def dotted(node):
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return ".".join(reversed(parts))

for node in ast.walk(tree):
    if isinstance(node, ast.Assert):
        issues.append({"line": node.lineno, "message": "raw assert is forbidden; use tests.commons.assertions helpers"})
    if isinstance(node, ast.Call):
        name = dotted(node.func)
        if name in {"os.getenv", "time.sleep"}:
            issues.append({"line": node.lineno, "message": f"{name} is forbidden in backend tests"})
        if name.startswith("requests.") or name in {
            "session.get", "session.post", "session.put", "session.patch", "session.delete", "session.request"
        }:
            issues.append({"line": node.lineno, "message": "direct HTTP calls are forbidden in tests; use a typed api/ client"})

print(json.dumps(issues))
`;

function pythonCheck(source) {
  const commands = [
    ["python", ["-c", PYTHON_CHECK]],
    ["py", ["-3", "-c", PYTHON_CHECK]],
  ];
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, { input: source, encoding: "utf8", timeout: 10000 });
    if (result.error?.code === "ENOENT") continue;
    if (result.status !== 0) {
      return { ok: false, issues: [`Python syntax validation failed: ${(result.stderr || result.error?.message || "unknown error").trim()}`] };
    }
    try {
      return {
        ok: true,
        issues: JSON.parse(result.stdout).map((issue) => `line ${issue.line}: ${issue.message}`),
      };
    } catch (error) {
      return { ok: false, issues: [`Python validator returned invalid output: ${error.message}`] };
    }
  }
  return { ok: false, issues: ["Python runtime is required to validate backend automation changes"] };
}

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  emitAllow(payload);
  process.exit(0);
}

const config = loadHarnessConfig();
const cwd = payload.cwd ?? process.cwd();
const filePath = hookFilePath(payload);
const scope = authorizeAutomationWrite({ filePath, cwd, config, sessionId: payload.session_id ?? null });
if (!scope.applies) {
  emitAllow(payload);
  process.exit(0);
}
if (!scope.allowed) {
  console.error(`BACKEND VALIDATION BLOCKED: ${scope.reason}`);
  process.exit(2);
}
if (!scope.relative.toLowerCase().endsWith(".py")) {
  emitAllow(payload);
  process.exit(0);
}

const candidate = filePath
  ? (path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath))
  : null;
const absolute = candidate && existsSync(candidate)
  ? candidate
  : null;
const source = absolute ? readFileSync(absolute, "utf8") : hookContent(payload);
const parsed = pythonCheck(source);
if (!parsed.ok) {
  console.error(parsed.issues.join("\n"));
  process.exit(2);
}

const normalized = scope.relative.toLowerCase();
const assertionHelper = normalized === "tests/commons/assertions.py";
const testCode = normalized.startsWith("tests/") && !assertionHelper;
const issues = testCode ? parsed.issues : parsed.issues.filter((issue) => issue.includes("syntax"));
if (issues.length > 0) {
  console.error("BACKEND AUTOMATION BLOCKED:");
  issues.forEach((issue) => console.error(`- ${issue}`));
  process.exit(2);
}
emitAllow(payload);
