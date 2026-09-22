export function emitAllow() {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    },
  })}\n`);
}

export function emitEmpty() {
  process.stdout.write("{}\n");
}

export function emitContext(payload, claudeEvent, context) {
  if (!context) return emitEmpty(payload);
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: claudeEvent,
      additionalContext: context,
    },
  })}\n`);
}

export function emitStopFollowup(_payload, message) {
  process.stdout.write(`${JSON.stringify({ decision: "block", reason: message })}\n`);
}

export function emitPrompt(payload, context) {
  const event = String(payload?.hook_event_name ?? payload?.hookEventName ?? "");
  if (event === "beforeSubmitPrompt") {
    const original = String(payload?.prompt ?? payload?.user_message ?? "");
    const userMessage = context ? `${original}\n\n${context}` : original;
    process.stdout.write(`${JSON.stringify({ continue: true, user_message: userMessage })}\n`);
    return;
  }
  if (!context) return emitEmpty(payload);
  emitContext(payload, "UserPromptSubmit", context);
}
