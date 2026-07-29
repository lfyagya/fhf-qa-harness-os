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
