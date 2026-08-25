// Converts authored Markdown into Confluence storage-format XHTML.
// The Markdown files in the consumer repository are the only authored source; published
// Confluence pages are generated projections, so this module must stay dependency-free.
import { createHash } from "node:crypto";

export const DOCS_PROJECTION_SCHEMA_VERSION = 1;

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#-]*)\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBER = /^(\s*)\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const LINK = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const CODE_SENTINEL = /\u0000c(\d+)\u0000/g;

// Confluence code-macro language identifiers differ from common Markdown fence hints.
const LANGUAGES = new Map([
  ["", "text"],
  ["text", "text"],
  ["txt", "text"],
  ["js", "js"],
  ["javascript", "js"],
  ["mjs", "js"],
  ["ts", "js"],
  ["json", "json"],
  ["jsonc", "json"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
  ["sh", "bash"],
  ["bash", "bash"],
  ["shell", "bash"],
  ["zsh", "bash"],
  ["powershell", "powershell"],
  ["ps1", "powershell"],
  ["sql", "sql"],
  ["py", "py"],
  ["python", "py"],
  ["java", "java"],
  ["diff", "diff"],
  ["md", "text"],
  ["markdown", "text"],
]);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// CDATA cannot contain the terminator, so a literal occurrence is split across two sections.
function cdata(value) {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  let inCode = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === "\\" && trimmed[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (character === "`") inCode = !inCode;
    if (character === "|" && !inCode) {
      cells.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function isTableRow(line) {
  return line.includes("|") && splitRow(line).length > 1;
}

function isTableDivider(line) {
  return isTableRow(line) && splitRow(line).every((cell) => /^:?-+:?$/.test(cell));
}

const EXTENSION = 'data-extension-type="com.atlassian.confluence.macro.core"';

/**
 * Blocks, panels, and macros are the only places the two Confluence dialects differ. Headings,
 * paragraphs, tables, lists, and inline markup are identical, so they stay dialect-agnostic.
 *
 * - `storage` is the XHTML storage format the REST API accepts.
 * - `html` is the Confluence HTML+ dialect the MCP tools accept; they reject storage XML.
 */
export const DIALECTS = {
  storage: {
    code(language, body) {
      const resolved = LANGUAGES.get(language.toLowerCase()) ?? "text";
      return [
        '<ac:structured-macro ac:name="code" ac:schema-version="1">',
        `<ac:parameter ac:name="language">${resolved}</ac:parameter>`,
        `<ac:plain-text-body>${cdata(body)}</ac:plain-text-body>`,
        "</ac:structured-macro>",
      ].join("");
    },
    diagram(macroName, body) {
      return [
        `<ac:structured-macro ac:name="${escapeXml(macroName)}" ac:schema-version="1">`,
        `<ac:plain-text-body>${cdata(body)}</ac:plain-text-body>`,
        "</ac:structured-macro>",
      ].join("");
    },
    panel(html) {
      return `<ac:structured-macro ac:name="info" ac:schema-version="1"><ac:rich-text-body>${html}</ac:rich-text-body></ac:structured-macro>`;
    },
    tableOfContents(maxLevel) {
      return [
        '<ac:structured-macro ac:name="toc" ac:schema-version="1">',
        '<ac:parameter ac:name="minLevel">2</ac:parameter>',
        `<ac:parameter ac:name="maxLevel">${maxLevel}</ac:parameter>`,
        "</ac:structured-macro>",
      ].join("");
    },
  },
  html: {
    code(language, body) {
      const resolved = LANGUAGES.get(language.toLowerCase()) ?? "text";
      return `<pre><code class="language-${resolved}">${escapeXml(body)}</code></pre>`;
    },
    diagram(macroName, body) {
      return [
        `<div data-type="bodied-extension" ${EXTENSION} data-extension-key="${escapeXml(macroName)}">`,
        `<pre>${escapeXml(body)}</pre>`,
        "</div>",
      ].join("");
    },
    panel(html) {
      return `<div data-type="panel-info">${html}</div>`;
    },
    tableOfContents(maxLevel) {
      const parameters = escapeXml(JSON.stringify({ minLevel: 2, maxLevel }));
      return `<div data-type="extension" ${EXTENSION} data-extension-key="toc" data-parameters="${parameters}"></div>`;
    },
  },
};

export function dialectFor(name) {
  const dialect = DIALECTS[name];
  if (!dialect) throw new Error(`Unknown Confluence dialect: ${name}`);
  return dialect;
}

/**
 * Renders inline Markdown. Code spans are extracted before escaping so their contents are
 * never interpreted as emphasis, and links are resolved before emphasis so that underscores
 * and asterisks inside URLs survive.
 */
function renderInline(text, context) {
  const codeSpans = [];
  let work = text.replace(/`([^`]+)`/g, (_, code) => {
    codeSpans.push(code);
    return `\u0000c${codeSpans.length - 1}\u0000`;
  });
  work = escapeXml(work);
  work = work.replace(LINK, (_, label, target) => renderLink(label, target, context));
  work = work.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  work = work.replace(/(?<![*\w])\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  work = work.replace(CODE_SENTINEL, (_, index) => `<code>${escapeXml(codeSpans[Number(index)])}</code>`);
  return work;
}

function renderLink(label, target, context) {
  const text = label || target;
  if (target.startsWith("#") || ABSOLUTE.test(target)) {
    return `<a href="${escapeXml(target)}">${text}</a>`;
  }
  // The anchor is split here so link resolvers only ever deal with a document path.
  const [targetPath, anchor] = target.split("#");
  const resolved = targetPath ? context.resolveLink?.(targetPath) : null;
  if (resolved) {
    const href = anchor ? `${resolved}#${anchor}` : resolved;
    return `<a href="${escapeXml(href)}">${text}</a>`;
  }
  // Fail closed: a relative link with no published counterpart would ship as a dead link.
  context.issues.push(`Unmapped relative link "${target}" in ${context.sourceLabel}`);
  return text;
}

function renderParagraph(lines, context) {
  const text = lines.join(" ").trim();
  return text ? `<p>${renderInline(text, context)}</p>` : "";
}

function renderTable(rows, context) {
  const [header, ...body] = rows;
  const head = splitRow(header)
    .map((cell) => `<th><p>${renderInline(cell, context)}</p></th>`)
    .join("");
  const cells = body
    .map((row) => {
      const columns = splitRow(row)
        .map((cell) => `<td><p>${renderInline(cell, context)}</p></td>`)
        .join("");
      return `<tr>${columns}</tr>`;
    })
    .join("");
  return `<table><tbody><tr>${head}</tr>${cells}</tbody></table>`;
}

/**
 * Builds nested lists from indentation. Each entry is { depth, ordered, text }.
 */
function renderList(entries, context) {
  const output = [];
  const open = [];
  for (const entry of entries) {
    // Closing a deeper list returns to the parent item, which is still open.
    while (open.length && entry.depth < open.at(-1).depth) {
      output.push(`</li></${open.pop().tag}>`);
    }
    if (!open.length || entry.depth > open.at(-1).depth) {
      const tag = entry.ordered ? "ol" : "ul";
      output.push(`<${tag}><li>`);
      open.push({ tag, depth: entry.depth });
    } else {
      output.push("</li><li>");
    }
    output.push(`<p>${renderInline(entry.text, context)}</p>`);
  }
  while (open.length) output.push(`</li></${open.pop().tag}>`);
  return output.join("");
}

/**
 * Converts a Markdown document to Confluence storage format.
 *
 * @param {string} markdown authored document contents
 * @param {object} options
 * @param {(target: string) => string|null} [options.resolveLink] maps a relative Markdown
 *   target to a published Confluence URL; returning null records an issue and drops the link
 * @param {string} [options.diagramMacroName] macro name for ```mermaid fences
 * @param {string} [options.sourceLabel] label used in issue messages
 * @param {boolean} [options.dropFirstHeading] omit the leading H1, since Confluence renders
 *   the page title separately
 * @param {"storage"|"html"} [options.format] Confluence dialect to emit
 * @returns {{ storage: string, issues: string[], title: string|null }}
 */
export function markdownToStorage(markdown, options = {}) {
  const {
    resolveLink,
    diagramMacroName = "mermaid",
    sourceLabel = "document",
    dropFirstHeading = true,
    format = "storage",
  } = options;
  const dialect = dialectFor(format);
  const context = { resolveLink, issues: [], sourceLabel };
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let paragraph = [];
  let listEntries = [];
  let tableRows = [];
  let quoteLines = [];
  let title = null;
  let seenHeading = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const html = renderParagraph(paragraph, context);
    if (html) output.push(html);
    paragraph = [];
  };
  const flushList = () => {
    if (!listEntries.length) return;
    output.push(renderList(listEntries, context));
    listEntries = [];
  };
  const flushTable = () => {
    if (!tableRows.length) return;
    output.push(renderTable(tableRows, context));
    tableRows = [];
  };
  const flushQuote = () => {
    if (!quoteLines.length) return;
    output.push(`<blockquote><p>${renderInline(quoteLines.join(" "), context)}</p></blockquote>`);
    quoteLines = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
    flushQuote();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const fence = FENCE.exec(line);
    if (fence) {
      flushAll();
      const [, marker, language] = fence;
      const body = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`).test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      const contents = body.join("\n");
      output.push(
        language.toLowerCase() === "mermaid"
          ? dialect.diagram(diagramMacroName, contents)
          : dialect.code(language, contents),
      );
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const text = heading[2].trim();
      if (!seenHeading && level === 1) {
        title = text;
        seenHeading = true;
        if (dropFirstHeading) continue;
      }
      seenHeading = true;
      output.push(`<h${level}>${renderInline(text, context)}</h${level}>`);
      continue;
    }

    if (RULE.test(line) && !isTableRow(line)) {
      flushAll();
      output.push("<hr />");
      continue;
    }

    if (isTableRow(line) && !BULLET.test(line)) {
      if (isTableDivider(line)) continue;
      flushParagraph();
      flushList();
      flushQuote();
      tableRows.push(line);
      continue;
    }
    flushTable();

    const quote = QUOTE.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      quoteLines.push(quote[1]);
      continue;
    }
    flushQuote();

    const bullet = BULLET.exec(line);
    const numbered = NUMBER.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const [, indent, text] = bullet ?? numbered;
      listEntries.push({
        depth: Math.floor(indent.replaceAll("\t", "  ").length / 2),
        ordered: Boolean(numbered),
        text,
      });
      continue;
    }

    // A plain line directly beneath a list item is a continuation of that item.
    if (listEntries.length && /^\s{2,}\S/.test(line)) {
      listEntries.at(-1).text += ` ${line.trim()}`;
      continue;
    }
    flushList();

    paragraph.push(line.trim());
  }

  flushAll();
  return { storage: output.join(""), issues: context.issues, title };
}

// --- page-map maintenance -------------------------------------------------
//
// A page entry whose pageId is null is a declared documentation owner with no Confluence page
// yet. The publisher creates those on a --publish run and writes the returned identifier back
// into the control plane, so a new owner never needs a manual round-trip through the Confluence
// UI. Both helpers are pure so the projection suite can cover them.

/**
 * Page entries that are declared but not yet created.
 *
 * @param {Array<{source: string, pageId: string|null}>} pages
 * @returns {Array<object>} entries awaiting creation
 */
export function pagesNeedingCreation(pages) {
  return (pages ?? []).filter((page) => page.pageId === null || page.pageId === undefined);
}

/**
 * Assigns a Confluence page identifier to one entry in the raw control-plane text.
 *
 * Edits the text instead of reserialising the parsed object, because the control plane is
 * hand-authored: JSON.stringify rewrites its indentation and line endings, which buries a
 * one-line change in a whole-file diff.
 *
 * @param {string} configText raw qa-control-plane.json contents
 * @param {string} source the page entry to assign, matched exactly
 * @param {string} pageId the numeric identifier Confluence returned
 * @returns {string} the updated text
 */
export function withAssignedPageId(configText, source, pageId) {
  if (!/^[0-9]+$/.test(String(pageId))) {
    throw new Error(`Refusing to assign a non-numeric Confluence pageId: ${pageId}`);
  }
  const sourceAt = configText.indexOf(`"source": "${source}",`);
  if (sourceAt === -1) throw new Error(`No page entry for source: ${source}`);
  const KEY = `"pageId":`;
  const keyAt = configText.indexOf(KEY, sourceAt);
  const nullAt = configText.indexOf("null", keyAt);
  if (keyAt === -1 || nullAt === -1 || configText.slice(keyAt + KEY.length, nullAt).trim() !== "") {
    throw new Error(`Page entry is not awaiting an id: ${source}`);
  }
  return `${configText.slice(0, nullAt)}"${pageId}"${configText.slice(nullAt + "null".length)}`;
}

/**
 * The record a publish or dry run leaves behind.
 *
 * Exists because the outcome of a run was only ever observable in a terminal, and a terminal is not
 * evidence: whether a page was created had to be recalled rather than read. Created identifiers are
 * included so that a run whose write-back failed can still be recovered from this file instead of
 * from Confluence by hand.
 *
 * Carries metadata only. No credentials, no page bodies.
 *
 * @param {object} run
 * @param {"dry-run"|"publish"} run.mode
 * @param {string} run.ranAt ISO timestamp
 * @param {string} run.spaceKey
 * @param {Array<{source: string, title: string, pageId: string}>} [run.created]
 * @param {Array<{source: string, pageId: string}>} [run.updated]
 * @param {Array<{source: string, pageId: string|null}>} [run.unchanged]
 * @param {Array<{source: string}>} [run.unrecorded] created pages whose id never reached the config
 * @returns {object} the record to serialise
 */
export function publishRunRecord(run) {
  const list = (value) => (Array.isArray(value) ? value : []);
  const unrecorded = list(run.unrecorded);
  return {
    schema: "fhf-harness/confluence-publish/v1",
    mode: run.mode,
    ranAt: run.ranAt,
    spaceKey: run.spaceKey,
    wrote: run.mode === "publish",
    counts: {
      created: list(run.created).length,
      updated: list(run.updated).length,
      unchanged: list(run.unchanged).length,
      unrecorded: unrecorded.length,
    },
    created: list(run.created),
    updated: list(run.updated),
    unchanged: list(run.unchanged),
    unrecorded,
    // A run that created pages but failed to record their ids is the one state that silently
    // desynchronises the page map from the space, so it is called out rather than inferred.
    healthy: unrecorded.length === 0,
  };
}
