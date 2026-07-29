export function hookInput(payload) {
  return payload?.tool_input ?? payload?.input ?? {};
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
