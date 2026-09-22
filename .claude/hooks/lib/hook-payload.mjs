export function hookInput(payload) {
  let input = payload?.tool_input ?? payload?.input ?? payload?.arguments ?? {};
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      return input;
    }
  }
  return input;
}

export function hookReadLimit(payload) {
  const input = hookInput(payload);
  const candidates = [
    input?.limit,
    input?.head_limit,
    input?.maxLines,
    input?.max_lines,
    input?.line_limit,
    payload?.limit,
  ];
  for (const candidate of candidates) {
    const limit = Number(candidate);
    if (Number.isInteger(limit) && limit > 0) return limit;
  }
  return null;
}

export function hookFilePath(payload) {
  const input = hookInput(payload);
  const text = typeof input === "string" ? input : input.patch ?? input.command ?? "";
  const patchPath = text.match(/^\*\*\* (?:Add|Update) File: (.+)$/m)?.[1];
  return String(
    (typeof input === "object" &&
      (input.file_path ?? input.path ?? input.target_file)) ||
      patchPath ||
      "",
  ).replace(/\\/g, "/");
}

export function hookContent(payload) {
  const input = hookInput(payload);
  if (typeof input === "string") return input;
  return String(
    input.new_string ?? input.content ?? input.patch ?? input.diff ?? input.command ?? "",
  );
}
