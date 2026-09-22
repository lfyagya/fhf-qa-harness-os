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

// One object for every host. Claude reads additionalContext. Cursor reads
// user_message on beforeSubmitPrompt and additional_context on session start.
// The text in those fields is the same.
export function emitContext(payload, claudeEvent, context) {
  if (!context) return emitEmpty(payload);
  const codex = process.env.FHF_HOOK_HOST === "codex";
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
  const codex = process.env.FHF_HOOK_HOST === "codex";
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
