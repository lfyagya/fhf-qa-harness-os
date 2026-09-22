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

export function emitScopedAllow(payload, context) {
  const codex = hostRejectsCursorFields(payload);
  const event = String(payload?.hook_event_name ?? payload?.hookEventName ?? "");
  const claudeEvent = event === "SubagentStart" ? "SubagentStart" : "PreToolUse";
  const output = {
    hookSpecificOutput: {
      hookEventName: claudeEvent,
      additionalContext: context,
    },
  };
  if (claudeEvent === "PreToolUse") output.hookSpecificOutput.permissionDecision = "allow";
  else output.continue = true;
  if (!codex) output.additional_context = context;
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

// One object for every host. Claude reads additionalContext. Cursor reads
// user_message on beforeSubmitPrompt and additional_context on session start.
// Codex rejects those two extra fields, which its payload marks with turn_id
// or permission_mode. The command is the same.
function hostRejectsCursorFields(payload) {
  return payload?.turn_id != null || payload?.permission_mode != null;
}

export function emitContext(payload, claudeEvent, context) {
  if (!context) return emitEmpty(payload);
  const codex = hostRejectsCursorFields(payload);
  const output = {
    hookSpecificOutput: {
      hookEventName: claudeEvent,
      additionalContext: context,
    },
  };
  if (claudeEvent !== "PreToolUse" && claudeEvent !== "PermissionRequest") output.continue = true;
  if (!codex) output.additional_context = context;
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

export function emitPrompt(payload, context) {
  const event = String(payload?.hook_event_name ?? payload?.hookEventName ?? "");
  const text = String(context ?? "");
  if (!text && event !== "beforeSubmitPrompt") return emitEmpty(payload);
  const original = String(payload?.prompt ?? payload?.user_message ?? "");
  const delivered = text ? (original ? `${original}\n\n${text}` : text) : original;
  const codex = hostRejectsCursorFields(payload);
  const output = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: text,
    },
  };
  if (!codex) {
    output.user_message = delivered;
    output.additional_context = text;
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

export function emitStopFollowup(_payload, message) {
  process.stdout.write(`${JSON.stringify({ decision: "block", reason: message })}\n`);
}
