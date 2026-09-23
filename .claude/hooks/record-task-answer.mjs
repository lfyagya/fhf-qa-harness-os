#!/usr/bin/env node
// PostToolUse:AskUserQuestion — record the owner's answer to a task question (ADR-0044).
//
// Why this exists (2026-09-23): the owner answers the harness's task questions through the
// question UI, and that answer comes back as a tool result, not a prompt, so the prompt router
// never sees it. The agent cannot be the recorder: it could write "yes" without asking. This hook
// reads the answer the tool itself returned, which the agent cannot produce without showing the
// question to the owner. Tools with no question UI fall back to a typed reply in the router.
import { readFileSync } from "node:fs";
import { loadHarnessConfig } from "./lib/harness-config.mjs";
import { emitContext, emitEmpty } from "./lib/hook-runtime.mjs";
import {
  answerQuickTask,
  isAffirmative,
  isNegative,
  routeTaskFocus,
  sessionFocus,
  taskRoot,
} from "./lib/task-protocol.mjs";

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

function answersOf(response) {
  const found = [];
  if (response?.answers && typeof response.answers === "object") {
    for (const [question, answer] of Object.entries(response.answers)) found.push({ question, answer: String(answer ?? "") });
  }
  const text = typeof response === "string" ? response : JSON.stringify(response ?? {});
  for (const match of text.matchAll(/"([^"]+)"="([^"]*)"/g)) found.push({ question: match[1], answer: match[2] });
  return found;
}

const config = loadHarnessConfig();
const root = taskRoot(payload);
const sessionId = payload.session_id ?? null;
const focus = sessionFocus(root, config, sessionId);
const answers = answersOf(payload.tool_response ?? payload.tool_output);
const lines = [];

const quickAnswer = answers.find((item) => /quick task/i.test(item.question));
if (focus?.quick?.state === "pending" && quickAnswer && (isAffirmative(quickAnswer.answer) || isNegative(quickAnswer.answer))) {
  lines.push(answerQuickTask({ root, config, focus, affirmative: isAffirmative(quickAnswer.answer) }));
} else if (focus?.awaiting || focus?.key) {
  // The answer to "which task?": a SERV key, a manifest file, or a keyword.
  for (const item of answers) {
    const line = routeTaskFocus({ root, config, text: item.answer, sessionId });
    if (line) {
      lines.push(line);
      break;
    }
  }
}

if (lines.length) emitContext(payload, "PostToolUse", lines.join("\n"));
else emitEmpty(payload);
process.exit(0);
