# FHF QA Control Plane

The control plane is the AI-independent operating layer above the E2E and Smoke test repositories.
It centralizes read-only Atlassian context, repository-derived evidence, proposed application-spec
changes, implementation routing, and a portable command-center report. The separately owned backend
repository is available only as a read-only API and Oracle evidence source.

Architecture decision: [`../adr/0005-centralized-qa-control-plane.md`](../adr/0005-centralized-qa-control-plane.md)

Canonical configuration: `config/qa-control-plane.json`
Runner: `scripts/harness/qa-command-center.mjs`
Consumer evidence: `paths.consumerRoot` + `paths.evidenceDir` from `config/qa-control-plane.json`

## Operating contract

1. Read Jira, Confluence, and Teamwork Graph through the client's Atlassian MCP connection.
2. Fetch every page of the configured sprint JQL. A partial page is rejected by the runner.
3. Keep the raw MCP result outside version control; never include credentials.
4. Save optional Teamwork Graph and Confluence enrichment using the generated snapshot contract.
5. After explicit consent to export sanitized evidence into the FHF workspace, run
   `qa-command-center.mjs refresh --input <page1.json,page2.json> --graph <graph.json>
   --confluence <pages.json> --consent <single-use-reference>`.
6. Review `spec-delta-proposals.md`; module assignments marked `review` are not facts. For a
   ticket selected from that queue, call Teamwork Graph context and inspect its parent/linked
   work items or pages before proposing a module or spec target.
7. Ask for explicit approval before editing an application-intelligence spec, Jira, or Confluence.
8. Route approved implementation to the correct repository and its native architecture.
9. Record lifecycle evidence with the `workflow` command.
10. Regenerate coverage and rebuild the command center after implementation or execution.

## Commands

```text
node scripts/harness/qa-command-center.mjs self-test
node scripts/harness/qa-command-center.mjs contract
node scripts/harness/qa-command-center.mjs snapshot --input <jira-page.json> --consent <reference>
node scripts/harness/qa-command-center.mjs workflow --ticket SERV-12345 --stage configured --status completed --evidence <path-or-url> --consent <reference>
node scripts/harness/qa-command-center.mjs build --consent <reference>
node scripts/harness/qa-command-center.mjs refresh --input <page1.json,page2.json> --graph <graph.json> --confluence <pages.json> --consent <reference>
node scripts/harness/generate-coverage.mjs --consent <reference>
node scripts/harness/eval-harness.mjs [--trace <loop-trace.jsonl>]
node scripts/harness/calibrate-gate.mjs collect --trace <loop-trace.jsonl>
node scripts/harness/calibrate-gate.mjs status
```

`snapshot` validates and normalizes sprint data. `build` combines the current snapshot with
coverage, execution, and chain-risk evidence. `refresh` performs both. Multiple comma-separated
input files represent paginated Jira results; the final page must carry `isLast: true`.
`contract` prints the portable MCP interchange shape without writing a file.
Snapshot/build/refresh/workflow and coverage generation require an
explicit evidence-export consent reference and refuse to run unless all runtime outputs are ignored
by the consumer repository. The snapshot stores an allowlisted issue projection; descriptions,
assignees, raw Graph objects, Confluence bodies, account IDs, and cloud IDs are not persisted.
`workflow` updates one ticket stage. Approval-gated stages reject completion without
`--approval <reference> --target <exact-target> --payload-hash <sha256>` and reject reused approval
references.

Lock files record their owner PID and fail closed. If a process terminates while holding a lock,
verify that PID is no longer running before explicitly removing the reported stale lock file.

## Complete configuration

`config/qa-control-plane.json` owns:

- Atlassian project, JQL, field IDs, allowed Confluence spaces, and connector policy.
- All three repository roots, package roots, and target branches.
- Approval policy and the ordered nine-stage ticket lifecycle.
- Freshness limits and measurable gates for traceability, unmapped work, review backlog,
  execution age, and Cypress UI Coverage.
- Module aliases, Jira Module prefixes, application-spec targets, and prioritization weights.
- Context, memory, harness, and bounded-loop engineering under `engineering`.
- Documentation ownership and source precedence.

The config contains no credentials, OAuth tokens, account IDs, or Atlassian cloud IDs.

Documentation changes start with `documentation.owners`. Update or delete; do not create a second
report for the same concern. `scripts/harness/check-docs-links.mjs` validates owners and links.
The `engineering.memory` policy permits Obsidian indexing for retrieval, but never fact write-back
or precedence over repository evidence.

`engineering.harness.adapters` maps this tool-neutral policy to verified runtime capabilities.
Claude Code and Cursor receive generated lifecycle enforcement. Codex, Copilot, and Gemini receive
instruction adapters only where no verified equivalent hook contract exists; the harness records
that capability gap instead of generating unsupported configuration.

## Ticket lifecycle

Every current-sprint ticket is represented in `qa-workflow-state.json` across:

`intake → specProposal → approved → configured → implemented → gated → executed → pr →
externallyUpdated`

Jira status provides an initial derived position. Local workflow evidence can refine each stage
with `pending`, `in_progress`, `completed`, `blocked`, or `skipped`. Completing a stage requires
the prior stage to be completed or skipped. `approved` and `externallyUpdated` require a recorded,
single-use approval reference bound to the ticket, stage, exact target, and payload hash. Jira status
is contextual only; it never substitutes for repository evidence or approval.

## Source precedence

Live application source, backend source, actual API responses, and DB evidence outrank Jira or
Confluence prose. Jira and Confluence explain intent and history; they do not silently rewrite
current-state specifications. Teamwork Graph relationships improve classification, but an
ambiguous relationship remains in the review queue.

## Routing

- E2E / functional / regression: the configured E2E checkout, branch `dev`.
- Production smoke / availability / auth / structure: the configured Smoke checkout, branch
  `staging`, GET-only.
- API request/response plus Oracle state: consult `fhf-backend-automation` read-only when it is
  available; its owner maintains the independent pytest harness.

The Cypress lanes retain Config → Commands → Tests and the generator → gate → ship sequence. The
backend repository remains separately owned; this harness neither installs configuration nor writes
to it. Its typed API, test, and DB evidence may inform Cypress work through read-only discovery.
When available, reports label this optional source `backendEvidence` for regression impact, coverage,
and UI-to-API-to-DB chain evidence; its absence is evidence unavailable, not a harness failure.

### Cypress Cloud evidence

Cloud evidence follows `connectors.cypressCloud.queryOrder`: MCP for conversational lookup, the
official `cy-cloud` CLI for terminal and Test Replay depth, then local JUnit when Cloud is
unavailable. Cloud CLI setup requires the organization integration, the configured minimum Node
version, the global `@cypress/cloud` package, and local OAuth; CI tokens stay in the external secret
environment. Agents read `projectId` from the selected lane's `cypress.config.js`.

The E2E lane may use full read diagnostics. Production smoke and root sessions are metadata-only
unless the owner explicitly opts in: no replay download/cache and no failure screenshot download.

## Approval boundary

Read-only discovery is autonomous. Exporting generated evidence into the sibling FHF workspace
requires explicit, single-use consent. Every Jira comment, ticket, transition, Confluence update,
and application-intelligence spec edit requires explicit, single-use approval of the exact target
and payload immediately before the write.

## Generated artifacts

- `current-sprint.json` — normalized, complete sprint snapshot with provenance.
- `contract` stdout — portable Jira/Graph/Confluence interchange example.
- `spec-delta-proposals.md` — ticket-to-module/lane/spec candidates; proposal only.
- `qa-workflow-state.json` — per-ticket lifecycle status, evidence, and approval references.
- `coverage-computed.json` — repository-derived structural coverage.
- `qa-command-center.json`, `.md`, and `.html` — shared data, AI-readable report, and portable
  human dashboard.

Atlassian-derived snapshots, enrichments, proposals, workflow state, and command-center outputs are
runtime-only and must remain ignored in `FHF/.gitignore`. Only sanitized reports should be published,
and only after a separate approved publication step.

Unavailable sources are shown as `unknown`, never converted to zero. Every available source
includes a timestamp so stale evidence is visible.

Runtime loop traces are likewise evidence, not policy. `eval-harness.mjs` derives repair convergence
from redacted `cypress/handoff/loop-trace.jsonl` events grouped by `runId`; it does not read a static
repair-outcome fixture. Gate calibration imports machine verdicts only after a recorded gate run and
requires explicit human pass/fail labels, scores, reviewer identity, and rationale before reporting
Cohen's kappa or Spearman correlation.
