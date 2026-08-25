#!/usr/bin/env node
import { markdownToStorage, pagesNeedingCreation, withAssignedPageId, publishRunRecord } from './docs-confluence-lib.mjs';

const failures = [];

function expect(name, actual, expected) {
  const passed = typeof expected === 'function' ? expected(actual) : String(actual).includes(expected);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}`);
  if (!passed) failures.push(`${name}: got ${JSON.stringify(actual)}`);
}

const resolveLink = (target) => (target === '02-next.md' ? 'https://example.atlassian.net/wiki/spaces/TE/pages/222' : null);
const convert = (markdown, options = {}) => markdownToStorage(markdown, { resolveLink, sourceLabel: 'fixture.md', ...options });

const heading = convert('# Page title\n\nBody text.\n');
expect('captures the leading H1 as the title', heading.title, (value) => value === 'Page title');
expect('omits the leading H1 from the body', heading.storage, (value) => !value.includes('<h1>'));
expect('renders a paragraph', heading.storage, '<p>Body text.</p>');

const inline = convert('# T\n\nUse **bold**, *thin*, and `cy.visit()` here.\n');
expect('renders bold', inline.storage, '<strong>bold</strong>');
expect('renders emphasis', inline.storage, '<em>thin</em>');
expect('renders inline code', inline.storage, '<code>cy.visit()</code>');

const escaped = convert('# T\n\nCompare a < b && c > d.\n');
expect('escapes markup characters', escaped.storage, '<p>Compare a &lt; b &amp;&amp; c &gt; d.</p>');

const emphasisSafeCode = convert('# T\n\nThe `a_b*c` token is literal.\n');
expect('does not emphasise inside code spans', emphasisSafeCode.storage, '<code>a_b*c</code>');

const table = convert('# T\n\n| Lane | Branch |\n|---|---|\n| E2E | `dev` |\n');
expect('renders a table header', table.storage, '<th><p>Lane</p></th>');
expect('renders a table cell', table.storage, '<td><p><code>dev</code></p></td>');
expect('drops the divider row', table.storage, (value) => !value.includes('---'));

const pipeInCode = convert('# T\n\n| Pattern | Note |\n|---|---|\n| `a\\|b` | alternation |\n');
expect('keeps escaped pipes inside a cell', pipeInCode.storage, (value) => value.includes('a|b'));

const code = convert('# T\n\n```js\nconst a = 1;\n```\n');
expect('renders a code macro', code.storage, 'ac:name="code"');
expect('maps the fence language', code.storage, '<ac:parameter ac:name="language">js</ac:parameter>');
expect('wraps code in CDATA', code.storage, '<![CDATA[const a = 1;]]>');

const unknownLanguage = convert('# T\n\n```\nplain\n```\n');
expect('defaults an unlabelled fence to text', unknownLanguage.storage, '<ac:parameter ac:name="language">text</ac:parameter>');

const cdataBreak = convert('# T\n\n```text\nend ]]> more\n```\n');
expect('splits a CDATA terminator', cdataBreak.storage, ']]]]><![CDATA[>');

const diagram = convert('# T\n\n```mermaid\nflowchart LR\n  A --> B\n```\n', { diagramMacroName: 'mermaid' });
expect('renders a diagram macro', diagram.storage, 'ac:name="mermaid"');
expect('keeps diagram source verbatim', diagram.storage, 'A --> B');
expect('does not wrap a diagram in the code macro', diagram.storage, (value) => !value.includes('ac:name="code"'));

const list = convert('# T\n\n- first\n- second\n  - nested\n- third\n');
expect('opens a bullet list', list.storage, '<ul><li><p>first</p>');
expect('nests inside the parent item', list.storage, '<ul><li><p>nested</p></li></ul></li>');
expect('returns to the outer level', list.storage, '<li><p>third</p></li></ul>');
expect('balances list tags', list.storage, (value) => {
  const opened = (value.match(/<ul>/g) ?? []).length;
  const closed = (value.match(/<\/ul>/g) ?? []).length;
  return opened === 2 && closed === 2;
});

const ordered = convert('# T\n\n1. one\n2. two\n');
expect('renders an ordered list', ordered.storage, '<ol><li><p>one</p></li><li><p>two</p></li></ol>');

const quote = convert('# T\n\n> Smoke is GET-only.\n');
expect('renders a blockquote', quote.storage, '<blockquote><p>Smoke is GET-only.</p></blockquote>');

const rule = convert('# T\n\nAbove.\n\n---\n\nBelow.\n');
expect('renders a horizontal rule', rule.storage, '<hr />');

const link = convert('# T\n\nGo to [the next page](02-next.md) now.\n');
expect('rewrites a mapped relative link', link.storage, 'href="https://example.atlassian.net/wiki/spaces/TE/pages/222"');
expect('reports no issue for a mapped link', link.issues, (value) => value.length === 0);

const anchored = convert('# T\n\nSee [detail](02-next.md#evidence).\n');
expect('preserves a link anchor', anchored.storage, 'pages/222#evidence');

const external = convert('# T\n\nSee [Cypress](https://docs.cypress.io/).\n');
expect('keeps an external link', external.storage, 'href="https://docs.cypress.io/"');

const broken = convert('# T\n\nSee [missing](99-nope.md).\n');
expect('fails closed on an unmapped link', broken.issues, (value) => value.length === 1 && value[0].includes('99-nope.md'));
expect('drops the dead anchor but keeps the text', broken.storage, (value) => value.includes('missing') && !value.includes('99-nope.md'));

const htmlCode = convert('# T\n\n```bash\nnode verify.mjs\n```\n', { format: 'html' });
expect('html dialect uses a code element', htmlCode.storage, '<pre><code class="language-bash">node verify.mjs</code></pre>');
expect('html dialect emits no storage XML', htmlCode.storage, (value) => !value.includes('ac:structured-macro'));

const htmlDiagram = convert('# T\n\n```mermaid\nflowchart LR\n  A --> B\n```\n', { format: 'html' });
expect('html dialect uses a bodied extension', htmlDiagram.storage, 'data-extension-key="mermaid"');
expect('html dialect names the macro core type', htmlDiagram.storage, 'data-extension-type="com.atlassian.confluence.macro.core"');
expect('html dialect escapes the arrow', htmlDiagram.storage, 'A --&gt; B');
expect('html dialect avoids CDATA', htmlDiagram.storage, (value) => !value.includes('CDATA'));

const htmlShared = convert('# T\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- item\n', { format: 'html' });
expect('shared blocks are dialect-independent', htmlShared.storage, '<table><tbody><tr><th><p>A</p></th>');
expect('shared lists are dialect-independent', htmlShared.storage, '<ul><li><p>item</p></li></ul>');

try {
  convert('# T\n', { format: 'nope' });
  expect('rejects an unknown dialect', 'no error', () => false);
} catch (error) {
  expect('rejects an unknown dialect', error.message, 'Unknown Confluence dialect');
}

// --- page-map maintenance -------------------------------------------------

const CRLF = String.fromCharCode(13, 10);
const LF = String.fromCharCode(10);
const countOf = (text, needle) => text.split(needle).length - 1;

const pageMap = [
  { source: 'docs/a.md', pageId: '111', title: 'A' },
  { source: 'docs/b.md', pageId: null, title: 'B' },
  { source: 'docs/c.md', pageId: null, title: 'C' },
];
expect('finds every page awaiting creation', pagesNeedingCreation(pageMap).map((page) => page.source).join(), 'docs/b.md,docs/c.md');
expect('treats an assigned page as created', pagesNeedingCreation(pageMap), (value) => !value.some((page) => page.pageId));
expect('tolerates an absent page list', pagesNeedingCreation(undefined), (value) => value.length === 0);

const configText = [
  '            "source": "docs/a.md",',
  '            "pageId": "111",',
  '            "title": "A"',
  '            "source": "docs/b.md",',
  '            "pageId": null,',
  '            "title": "B"',
].join(CRLF);

const assigned = withAssignedPageId(configText, 'docs/b.md', '4472600000');
expect('assigns the returned id', assigned, '"pageId": "4472600000"');
expect('leaves an already-assigned entry alone', assigned, '"pageId": "111"');
expect('writes no bare line feed', assigned, (value) => countOf(value, LF) === countOf(value, CRLF));
expect('rewrites only the null token', assigned, (value) => value.length === configText.length + 8);

for (const [name, source, id] of [
  ['refuses an unknown source', 'docs/zz.md', '1'],
  ['refuses an entry that already has an id', 'docs/a.md', '1'],
  ['refuses a non-numeric id', 'docs/b.md', '12a'],
]) {
  try {
    withAssignedPageId(configText, source, id);
    expect(name, 'no error', () => false);
  } catch (error) {
    expect(name, error.message, (value) => value.length > 0);
  }
}

// --- run record -----------------------------------------------------------

const stamp = '2026-01-01T00:00:00.000Z';
const publishRun = publishRunRecord({
  mode: 'publish',
  ranAt: stamp,
  spaceKey: 'TE',
  created: [{ source: 'a.md', title: 'A', pageId: '111' }],
  updated: [{ source: 'b.md', pageId: '222' }],
  unchanged: [{ source: 'c.md', pageId: '333' }],
});
expect('stamps the record schema', publishRun.schema, 'fhf-harness/confluence-publish/v1');
expect('marks a publish run as having written', publishRun.wrote, (value) => value === true);
expect('counts each outcome separately', JSON.stringify(publishRun.counts), '{"created":1,"updated":1,"unchanged":1,"unrecorded":0}');
expect('keeps created ids for recovery', JSON.stringify(publishRun.created), '111');
expect('a fully recorded run is healthy', publishRun.healthy, (value) => value === true);

const dryRun = publishRunRecord({ mode: 'dry-run', ranAt: stamp, spaceKey: 'TE' });
expect('marks a dry run as having written nothing', dryRun.wrote, (value) => value === false);
expect('tolerates absent outcome lists', JSON.stringify(dryRun.counts), '{"created":0,"updated":0,"unchanged":0,"unrecorded":0}');

const desynced = publishRunRecord({
  mode: 'publish',
  ranAt: stamp,
  spaceKey: 'TE',
  created: [{ source: 'a.md', title: 'A', pageId: '111' }],
  unrecorded: [{ source: 'a.md' }],
});
expect('an unrecorded id makes the run unhealthy', desynced.healthy, (value) => value === false);
expect('and is still recoverable from the record', JSON.stringify(desynced.created), '111');

const blocked = publishRunRecord({
  mode: 'blocked',
  ranAt: stamp,
  spaceKey: 'TE',
  blockedBy: 'missing CONFLUENCE_EMAIL or CONFLUENCE_API_TOKEN',
});
expect('records a refused run rather than leaving no file', blocked.mode, 'blocked');
expect('a blocked run wrote nothing', blocked.wrote, (value) => value === false);
expect('a blocked run says why', blocked.blockedBy, 'missing CONFLUENCE_EMAIL');
expect('omits blockedBy when a run was not refused', dryRun, (value) => !('blockedBy' in value));

if (failures.length) {
  console.error('\nConfluence projection test failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('\nConfluence projection conversion is correct.');
