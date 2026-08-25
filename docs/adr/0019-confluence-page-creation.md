# ADR-0019 - Confluence Page Creation

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-26 |

## Context

The documentation publisher could only read and update pages that already existed: `GET` and `PUT`
against `/wiki/api/v2/pages/{id}`. A new documentation owner therefore had to be created by hand in
the Confluence UI before it could ever publish, because the page map needs an identifier that only
creation returns.

That asymmetry mattered more than it looks. `documentation.owners` grows whenever a new owner is
declared, but the page map could not follow without a human round-trip, so the space permanently
lagged the repository. It also degraded the pages that matter most: relative links are rewritten to
Confluence URLs only when the target is registered, so a cross-referencing page — exactly the kind
worth publishing — rendered with dead links until every one of its targets had been created by hand.
Five declared owners were blocked this way, and the QA AI adoption page's pointer table was among
the casualties.

## Decision

A page entry whose `pageId` is explicitly `null` is a declared owner awaiting creation.

On a `--publish` run the publisher resolves the numeric space identifier from the configured space
key, creates each pending page with an empty body, writes the returned identifier back into the
control plane, then rebuilds and runs the normal update pass. The empty first version is deliberate:
a page must exist before its identifier can be substituted into the links its siblings make to it,
so creation and content are necessarily two versions.

The write-back edits the raw control-plane text rather than reserialising the parsed object.
`JSON.stringify` rewrites indentation and line endings, which turns a one-line assignment into a
whole-file diff — observed while preparing this change.

A dry run lists the pending pages and renders links to them as placeholders instead of failing
closed, so the default invocation stays useful before anything exists. The documentation check
accepts an explicit `null` and still rejects a missing, empty, or non-numeric identifier, so a
typo cannot masquerade as a pending page.

Two pure helpers, `pagesNeedingCreation` and `withAssignedPageId`, carry the logic and are covered by
the projection suite, including that the write-back preserves CRLF and touches nothing but the null
token.

## Consequences

Five owners are registered awaiting creation: the testing standard, the execution strategy, the
triage runbook, the `data-cy` hook ledger, and the regression-effort workflow. The first authorized
`--publish` creates and fills them, and the adoption page's links resolve as a result.

A publish run now needs page-create permission in the target space, not only update. Confluence
writes remain gated on `approval.confluenceWrites`, dry run remains the default, and credentials
remain environment-only.

The creation path itself is not unit-tested, because it requires a live Confluence endpoint; the
pure helpers around it are. That boundary is deliberate and worth remembering before extending it.

Two citations in the adoption page were changed from links to plain paths, because neither can ever
be a page: one is generated evidence rather than a document, and the other belongs to a separate
repository with its own authority. Fail-closed link checking is preserved rather than weakened with
an allowlist.

**What does NOT change:** hook topology, the agent roster, skill routing, the engine/payload boundary
from ADR-0001 and ADR-0018, and the rule that Markdown is the source while Confluence is a generated
projection.
