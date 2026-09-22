import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function ruleIndexText(root = ROOT) {
  const dir = path.join(root, "rules");
  if (!existsSync(dir)) {
    return "Standing orders live in rules/. This checkout has no rules/ directory. Regenerate the projection from fhf-harness-os.";
  }
  const lines = readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((file) => {
      const text = readFileSync(path.join(dir, file), "utf8");
      const title = text.split(/\r?\n/).find((line) => line.startsWith("# "))?.slice(2).trim() || file;
      return `- rules/${file}: ${title}`;
    });
  return ["Standing orders (one body in rules/, same index on every tool):", ...lines].join("\n");
}
