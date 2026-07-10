import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const DOCS_DIR = path.join(ROOT, "docs");

// Files whose links count as a "reference" into docs/ — the routing entry points.
const REFERRER_ROOTS = [
  path.join(ROOT, "CLAUDE.md"),
  path.join(ROOT, ".claude", "rules"),
  DOCS_DIR,
];

const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
// This repo's docs mostly cross-reference by backtick'd path, not markdown links:
// `docs/modules/README.md`. Counts toward "referenced" (orphan check) but isn't dead-link checked —
// prose mentions of not-yet-written paths are common and not worth blocking on.
const BACKTICK_PATH_RE = /`([\w./-]+\.md)`/g;

function looksLikePath(target) {
  return target.includes("/") || target.endsWith(".md");
}

function walkMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  if (fs.statSync(dir).isFile()) return dir.endsWith(".md") ? [dir] : [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("_archive")) continue; // frozen archive — not linted
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

const referrerFiles = REFERRER_ROOTS.flatMap(walkMarkdown);
const docsFiles = walkMarkdown(DOCS_DIR);

const deadLinks = [];
const referenced = new Set();

for (const file of referrerFiles) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const match of line.matchAll(LINK_RE)) {
      const target = match[1].trim();
      if (/^([a-z]+:)?\/\//i.test(target) || target.startsWith("mailto:") || target.startsWith("#")) {
        continue; // external / anchor-only — not a repo file reference
      }
      if (!looksLikePath(target)) continue; // bare IDs (Confluence/session UUIDs) aren't file refs
      const [targetPath] = target.split("#");
      if (!targetPath) continue;
      const resolved = path.resolve(path.dirname(file), targetPath);
      if (!fs.existsSync(resolved)) {
        deadLinks.push(`${path.relative(ROOT, file)}:${i + 1} — links to missing "${target}"`);
      } else {
        referenced.add(resolved);
      }
    }
    for (const match of line.matchAll(BACKTICK_PATH_RE)) {
      const target = match[1].trim();
      // Backtick mentions are commonly repo-root-relative (`docs/foo.md`) rather than
      // relative to the referring file — try both, don't dead-link check either.
      const candidates = [path.resolve(path.dirname(file), target), path.resolve(ROOT, target)];
      const resolved = candidates.find((c) => fs.existsSync(c));
      if (resolved) referenced.add(resolved);
    }
  });
}

const orphans = docsFiles
  .filter((f) => path.basename(f) !== "README.md")
  .filter((f) => !referenced.has(f))
  .map((f) => path.relative(ROOT, f));

// Orphans are a warning, not a gate: this repo also references docs by grep (source-map.md),
// so "unlinked" doesn't reliably mean "dead" — ponytail: revisit if false positives stay low after a few runs.
if (orphans.length) {
  console.warn(`Orphaned docs (${orphans.length}, not linked from CLAUDE.md, .claude/rules/, or any other doc):`);
  for (const issue of orphans) console.warn(`- ${issue}`);
}

if (deadLinks.length) {
  console.error("Dead links in docs:");
  for (const issue of deadLinks) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("docs/ links resolve.");
