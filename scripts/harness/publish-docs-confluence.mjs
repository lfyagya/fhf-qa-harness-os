#!/usr/bin/env node
// Projects the authored Markdown docs onto their Confluence pages.
//
// The Markdown files under the consumer repository are the only authored source. Confluence
// pages are generated projections, exactly like .claude/harness.config.json: never hand-edit a
// published page, because the next run overwrites it.
//
// Dry-run is the default. Publishing requires --publish plus credentials in the environment,
// which is the mechanical expression of approval.confluenceWrites in the control plane.
//
//   node scripts/harness/publish-docs-confluence.mjs
//   node scripts/harness/publish-docs-confluence.mjs --out build/confluence
//   node scripts/harness/publish-docs-confluence.mjs --only 01-quick-start --publish
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  markdownToStorage,
  dialectFor,
  sha256,
  pagesNeedingCreation,
  withAssignedPageId,
} from "./docs-confluence-lib.mjs";
import { resolveConsumerRoot } from "./workspace-paths.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG_FILE = path.join(HARNESS_ROOT, "config", "qa-control-plane.json");
const VERSION_TAG = "fhf-docs-hash";

function flag(name) {
  return process.argv.includes(name);
}

function value(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function posix(value) {
  return value.replaceAll("\\", "/").replace(/^\.?\//, "");
}

function fail(message) {
  console.error(`Documentation publish failed: ${message}`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
const publishing = config.documentation?.publishing?.confluence;
if (!publishing) fail("documentation.publishing.confluence is not configured");
if (publishing.version !== 1) fail("documentation.publishing.confluence.version must be 1");

const consumerRoot = resolveConsumerRoot(HARNESS_ROOT);
const pages = publishing.pages ?? [];
if (!pages.length) fail("documentation.publishing.confluence.pages is empty");

// Relative Markdown links are rewritten to the published page they correspond to.
const pageBySource = new Map(pages.map((page) => [posix(page.source), page]));

function resolveLinkFor(sourcePath) {
  return (targetPath) => {
    const absolute = path.resolve(path.dirname(path.join(consumerRoot, sourcePath)), targetPath);
    const page = pageBySource.get(posix(path.relative(consumerRoot, absolute)));
    if (!page) return null;
    // A sibling awaiting creation has no identifier yet, so a dry run renders a placeholder
    // instead of failing closed. The --publish pass creates first, then rebuilds with real ids.
    const id = page.pageId ?? "pending-creation";
    return `${publishing.baseUrl}/wiki/spaces/${publishing.spaceKey}/pages/${id}`;
  };
}

// REST accepts storage format; the Atlassian MCP tools accept HTML+ and reject storage XML.
const format = value("--format", "storage");
const dialect = dialectFor(format);

function banner(page) {
  const text = (publishing.generatedBanner ?? "")
    .replaceAll("{source}", page.source)
    .replaceAll("{repository}", publishing.sourceRepository ?? "");
  return text ? dialect.panel(`<p>${text}</p>`) : "";
}

function build(page) {
  const file = path.join(consumerRoot, posix(page.source));
  if (!fs.existsSync(file)) fail(`Source is missing: ${page.source}`);
  const markdown = fs.readFileSync(file, "utf8");
  const { storage, issues, title } = markdownToStorage(markdown, {
    resolveLink: resolveLinkFor(posix(page.source)),
    diagramMacroName: publishing.diagramMacro ?? "mermaid",
    sourceLabel: page.source,
    format,
  });
  const outline = publishing.tableOfContents ? dialect.tableOfContents(2) : "";
  return {
    ...page,
    title: page.title ?? title,
    storage: `${banner(page)}${outline}${storage}`,
    hash: sha256(storage).slice(0, 12),
    issues,
  };
}

const only = value("--only");
const selected = pages.filter((page) => !only || page.source.includes(only) || page.pageId === only);
if (!selected.length) fail(`--only ${only} matched no configured page`);

function buildAll() {
  const rendered = selected.map(build);
  const problems = rendered.flatMap((page) => page.issues);
  if (problems.length) {
    console.error("Documentation publish failed: unresolved links");
    problems.forEach((issue) => console.error(`- ${issue}`));
    process.exit(1);
  }
  return rendered;
}

function writeRendered(rendered) {
  const outDir = value("--out");
  if (!outDir) return;
  const root = path.resolve(outDir);
  fs.mkdirSync(root, { recursive: true });
  for (const page of rendered) {
    const name = `${path.basename(page.source, ".md")}.${format === "html" ? "html" : "xhtml"}`;
    fs.writeFileSync(path.join(root, name), page.storage, "utf8");
  }
  console.log(`Wrote ${rendered.length} rendered page(s) to ${root}`);
}

let built = buildAll();

const credentials = {
  baseUrl: publishing.baseUrl,
  email: process.env[publishing.emailEnv ?? "CONFLUENCE_EMAIL"],
  token: process.env[publishing.apiTokenEnv ?? "CONFLUENCE_API_TOKEN"],
};
const authorized = Boolean(credentials.email && credentials.token);

async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.email}:${credentials.token}`).toString("base64")}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${url} -> ${response.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

const readPage = (id) => request("GET", `${credentials.baseUrl}/wiki/api/v2/pages/${id}`);

// Creation needs the numeric space id; the control plane configures the human-readable key.
async function resolveSpaceId() {
  const found = await request(
    "GET",
    `${credentials.baseUrl}/wiki/api/v2/spaces?keys=${encodeURIComponent(publishing.spaceKey)}`,
  );
  const space = (found.results ?? [])[0];
  if (!space || !space.id) throw new Error(`Space ${publishing.spaceKey} is not readable`);
  return space.id;
}

// Creates each pending page empty and records its identifier, then the caller rebuilds so the
// normal update pass writes the real body. The empty first version is deliberate: a page must
// exist before its id can be substituted into the links its siblings make to it.
async function createPending(pending) {
  const spaceId = await resolveSpaceId();
  for (const page of pending) {
    const created = await request("POST", `${credentials.baseUrl}/wiki/api/v2/pages`, {
      spaceId,
      status: "current",
      title: page.title,
      body: { representation: "storage", value: "<p>Awaiting first publish.</p>" },
    });
    const id = String(created.id ?? "");
    const entry = pages.find((candidate) => candidate.source === page.source);
    entry.pageId = id;
    pageBySource.set(posix(page.source), entry);
    fs.writeFileSync(
      CONFIG_FILE,
      withAssignedPageId(fs.readFileSync(CONFIG_FILE, "utf8"), page.source, id),
      "utf8",
    );
    console.log(`create  ${id}  ${page.title}`);
  }
}

async function main() {
  const publish = flag("--publish");
  let created = 0;
  if (publish && !authorized) {
    fail(
      `--publish needs ${publishing.emailEnv} and ${publishing.apiTokenEnv} in the environment. ` +
        "Credentials must never be stored in the control plane.",
    );
  }

  const pending = pagesNeedingCreation(built);
  if (pending.length && !publish) {
    console.log(`${pending.length} page(s) awaiting creation in space ${publishing.spaceKey}:`);
    pending.forEach((page) => console.log(`  create  ${page.title}  (${page.source})`));
    console.log("Links to them render as placeholders until --publish creates them.");
  } else if (pending.length) {
    await createPending(pending);
    created = pending.length;
    built = buildAll();
  }
  writeRendered(built);

  let changed = 0;
  let skipped = 0;
  for (const page of built) {
    const marker = `${VERSION_TAG}:${page.hash}`;
    let live = null;
    if (authorized) {
      try {
        live = await readPage(page.pageId);
      } catch (error) {
        fail(`Cannot read page ${page.pageId} (${page.source}): ${error.message}`);
      }
    }

    const current = live?.version?.message ?? "";
    const upToDate = current.includes(marker);
    const state = !authorized ? "unknown" : upToDate ? "up to date" : "differs";
    console.log(
      `${publish && !upToDate ? "publish" : "check "} ${page.pageId ?? "pending"}  ${marker}  ${state}  ${page.title}`,
    );

    if (!publish || upToDate) {
      skipped += 1;
      continue;
    }
    await request("PUT", `${credentials.baseUrl}/wiki/api/v2/pages/${page.pageId}`, {
      id: page.pageId,
      status: "current",
      title: page.title,
      body: { representation: "storage", value: page.storage },
      version: { number: (live?.version?.number ?? 0) + 1, message: `Generated from ${page.source} (${marker})` },
    });
    changed += 1;
  }

  if (!publish) {
    console.log(
      `\nNOTHING WAS WRITTEN. Dry run: ${built.length} page(s) rendered.` +
        (authorized ? "" : `\nSet ${publishing.emailEnv} and ${publishing.apiTokenEnv} to compare against live pages.`) +
        "\nRe-run with --publish to write. Confluence writes require owner approval.",
    );
    return;
  }
  // A publish run must leave every identifier recorded. Creation writes each one back immediately, so
  // a null surviving here means a create was reported but not persisted — the state that silently
  // desynchronises this file from the space, and makes the next run create duplicates instead of
  // updating. Re-read from disk rather than trusting the in-memory copy: the point is to prove the
  // write landed.
  const unrecorded = pagesNeedingCreation(
    JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")).documentation?.publishing?.confluence?.pages,
  );
  if (unrecorded.length) {
    fail(
      `published, but ${unrecorded.length} page id(s) were not recorded in ${path.basename(CONFIG_FILE)}: ` +
        `${unrecorded.map((page) => page.source).join(", ")}. ` +
        "Those pages now exist in the space and this file does not know their ids, so re-running would " +
        "create duplicates. Record the ids by hand before publishing again.",
    );
  }
  console.log(
    `\nCreated ${created} page(s); updated ${changed}; ${skipped} already current or unchanged.`,
  );
}

main().catch((error) => fail(error.message));
