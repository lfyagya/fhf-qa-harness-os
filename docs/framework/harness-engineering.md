# Harness Engineering

`config/qa-control-plane.json` is the single non-secret configuration for the FHF QA system.
Its `engineering` object connects context, memory, harness, and loop behavior. Tool-native
settings are generated projections, not additional sources of truth.

## Architecture

```text
qa-control-plane.json
  ├─ connectors.cypressCloud → MCP/CLI diagnostics, auth boundary, lane access
  ├─ policyGovernance     → source class, placement, adoption, applicability
  ├─ engineering.context  → priority routing, context budget, compaction
  ├─ engineering.memory   → session boundary, exact facts, handoff, Obsidian boundary
  ├─ engineering.harness  → agents, skills, hooks, boundaries, runtime adapters
  └─ engineering.loops    → retry limits, escalation, phase boundaries
            │
            ▼
loader-templates.mjs + sync-loader-shims.mjs
            │
            ├─ .claude/settings.json
            ├─ .cursor/hooks.json
            └─ .claude/harness.config.json
```

The engine lives in `fhf-harness-os`. The FHF root is a local aggregation workspace; generated
adapters and test payloads live in the lane repositories. The E2E and Smoke projections are
committed with their repositories so a fresh clone is immediately usable. Never hand-edit a
generated adapter.
Every committed adapter uses the same Node launcher to resolve `CLAUDE_PROJECT_DIR`,
`CURSOR_PROJECT_DIR`, or the project working directory at runtime. Generated files must not contain
a developer home directory or drive-specific path. Control-plane topology remains relative data;
runtime adapters never require a sibling checkout.

### Static and dynamic configuration

`config/qa-control-plane.json` is the reviewed static policy. It owns topology, permissions,
boundaries, routes, product-contract mappings, hard loop ceilings, and verification commands.
Generated `.claude`, Cursor, and instruction projections are derived from that policy.

An optional `FHF_HARNESS_OVERLAY` is session configuration, not a second source of truth. It may
identify a ticket/module/run, select a configured route, or lower context and retry budgets. It may
not widen permissions, change hook or agent topology, disable data protections, or raise hard
safety limits. The effective configuration is fingerprinted in runtime loop state and traces.

### Policy and rule governance

`policyGovernance` is the one-time, tool-neutral contract for classifying a rule, deciding whether it
may be adopted, and placing its durable content. It is meta-policy: it does not contain statutes,
loan thresholds, queue conditions, dropdown values, or module state machines. Those product facts
belong to the configured `documentation.owners.application` specification and carry source
citations. Architecture decision: [`../adr/0013-policy-classification-and-placement.md`](../adr/0013-policy-classification-and-placement.md).

| Category | Authority | Required owner decision |
|---|---|---|
| Regulatory | Official government primary source | Legal/compliance confirms jurisdiction and applicability |
| Public commitment | Official FHF publication | Product/compliance confirms the effective version |
| Internal business policy | Approved, versioned FHF policy | Named business owner approves it |
| Application contract | Approved module/component/common spec | Product, development, and QA use one canonical rule |
| Implementation observation | Live source/API/DB behavior | Evidence only; it exposes drift but does not create policy |
| Execution evidence | Generated run, coverage, or gate artifact | Evidence only; a passing test does not approve a rule |
| Proposal | Jira, Confluence, web research, or derived notes | Proposal-only until an owner adopts it |

Adoption and applicability are separate. A rule may be enforced only when its adoption state is
`approved`, its applicability is `confirmed` or explicitly `conditional`, every required rule-record
field is present, and a conditional rule names its jurisdiction and conditions. Missing ownership,
unknown applicability, or conflicting authority fails closed and escalates to the named owner.

Placement is deliberate:

- Keep classification, placement, hard boundaries, approval gates, routing, and bounded defaults in
  `config/qa-control-plane.json`.
- Keep business intent, thresholds, formulas, status/dropdown values, conditions, and state transitions
  in the application specification. Reference shared rules; do not copy them into the harness.
- Keep executable behavior in source code and treat live source/API/DB as implementation evidence.
- Keep ticket/module/run selection and lower budgets in the validated runtime overlay.
- Keep run results, coverage, and API/DB observations in evidence artifacts; they never become policy
  automatically.
- Keep machine paths in ignored workspace setup and credentials only in approved environment/secret
  stores.

Do classify each rule, cite its primary source and effective version, name its owner and jurisdiction,
and trace intent through enforcement and test evidence. Do not infer legal applicability, adopt web or
ticket research automatically, treat a UI guard as backend authorization, or duplicate one rule across
config, documentation, and specifications.

### Smoke workspace preflight

The Smoke consumer deliberately keeps its FHF workspace and application-specification repository as
external payload. Its generated `.harness/workspace.example.json` is the setup form; each engineer
creates the ignored `.harness/workspace.local.json` with `consumerRoot` and `moduleSpecsRoot` before
working. The default `.harness/verify.mjs` checks the `staging` branch, local Smoke documentation,
workspace instructions, and every configured module-spec target. Missing required inputs block work;
Jira, Confluence, backend evidence, and Cypress Cloud are optional warnings for local Smoke runs.

Loop state and traces are separate runtime artifacts. They record goal, plan, progress, failures,
budgets, artifacts, verdicts, approvals, and provenance, but never rewrite static policy. Durable
improvements follow the learning-plane path: trace -> evaluation -> reviewed proposal -> static
change -> regenerated projection -> canary verification.

## Context engineering

- `engineering.context.routes` uses explicit IDs and priorities; config order breaks equal-priority
  ties deterministically, while task intent remains authoritative over the advisory hint.
- `documentation.owners` identifies the one document owner for each concern.
- `moduleSpecPaths` identifies product-contract context per module under the configured consumer workspace.
- Root instructions stay thin; detailed context is loaded on demand.
- Claude uses its adaptive auto-compact window unless `autoCompact.windowTokens` explicitly overrides it.
- Read output is bounded before it enters context; large files must be read in configured line chunks.
- Cursor receives the same routing contract at session start because its prompt hook cannot inject
  arbitrary context per prompt.

The runtime sequence is: classify prompt → select the highest-priority route → read the minimum owner/contract →
perform the job. Prompt keywords are advisory; task intent remains authoritative.

### Product topology and Jira grounding

`productTopology` is a 17-repository routing catalog, not a preload list and not a mutation policy.
Each record names the repository's role, business surface, first entry paths, local instructions, and
evidence type. Source bundles seed no more than four repositories. A task may expand one topology hop
for an exact call/import, endpoint or Oracle contract, linked work item/PR, declared edge, or QA
impact; the expansion reason is recorded.

Repository-by-repository routing and the declared cross-repository evidence graph are in
[`repository-routing.md`](repository-routing.md).

`atlassian.retrievalContract` resolves Jira data by semantic field. Stable system fields and the four
known custom fields are configured; Sprint, Acceptance Criteria, Story Points, and other custom
fields must be discovered on the connected Jira site before use. Missing fields remain UNKNOWN.
Attachment metadata loads before bodies, decision-bearing comments load selectively, and all Jira or
attachment content is untrusted evidence rather than agent instructions. Jira assignee, PR authors,
reviewers, changed-file authors, and CODEOWNERS remain distinct concepts.

### Task protocol

`engineering.taskProtocol` ports LANE's strongest mechanical ideas without adding LANE as a second
control plane. One `fhf-harness/task/v1` manifest freezes only the selected ticket projection,
acceptance-criteria digest, repository SHAs and paths, intent-vs-built classification, graph nodes,
dependency DAG, QA impact, runner selection, and proof modes. It does not copy the catalog,
repositories, full Jira history, chat, or Obsidian vault into task context.

The approval digest covers the grounded selection, intent-vs-built rows, and plan. Changed ticket
data, source SHAs/paths, classification, graph slice, dependencies, impact, runners, or proof modes
invalidate approval and block the next step. Unclassified or `ask-product` rows emit
`classify-intent-vs-built` and block planning. `defect` rows emit `resolve-intent-vs-built-defect`
and block verified/complete. Dependency cycles and unknown dependencies also block. The decision
core emits one machine-readable next action; it never approves, commits, merges, deploys, or writes
externally.

Proof modes are evidence-specific: hermetic tests can use RED/GREEN replay or same-test base/pass;
Cypress, production Smoke, API, Oracle, and third-party tests require native execution artifacts.
Tests can be not applicable only for metadata/non-behavioral chores with a reason and impact review.

### Execution budgets

Every planned task declares `plan.executionBudget`, which is included in the human approval digest.
The portable recorder enforces its maximum wall-clock time, recorded tool-result count, and
retryable-failure count by blocking the run and writing a `budget_exceeded` trace event. It is an
execution safety boundary, not a completion metric: a budget breach is a finding that requires
triage, never a reason to loosen the assertion or declare a task successful.


## Memory engineering

- Durable authority is the working tree, canonical config, and generated evidence—not chat recall.
- One session handles one job.
- Exact ticket IDs, module/spec names, selectors, endpoints, and evidence paths survive handoff.
- `factExtractors` persist only those bounded facts, and `handoffMaxAgeHours` rejects stale state.
- `engineering.memory.handoffFile` is overwritten, not accumulated.
- Session-start, pre-compaction, and session-end hooks restore or checkpoint the same file.
- Obsidian is retrieval-only and cannot write product facts back.

Compaction shortens the current session. A handoff starts a fresh session from durable facts.

## Harness engineering

`engineering.harness` owns the active agent roster, skills, hook membership, forbidden agents,
application-source boundary, runtime adapters, projection path, and verification commands.

Hook scripts remain executable engine code. The config owns which scripts participate; adapter
code maps those groups to Claude Code and Cursor lifecycle events. This separates policy from
vendor-specific syntax without duplicating policy.

The harness drives each tool through verified capabilities:

- Claude Code: generated settings, dynamic prompt routing, guards, memory, and bounded loops.
- Cursor: generated native hooks, session-start routing, guards, memory, and bounded loops. Commands
  shared with Claude are byte-identical so Cursor compatibility mode deduplicates them.
- Codex: `AGENTS.md` instruction adapter only; no unsupported hook projection is invented.
- Copilot and Gemini: generated instruction overlays only.

Pre-tool allow paths emit Claude's nested `hookSpecificOutput.permissionDecision: allow` format,
which Cursor officially supports for compatible hooks. Metadata-less Cursor capability probes
receive that same response; real tool payloads still pass through the configured policy checks.
File-tool guards, shell mutation guards, and Claude sandbox deny-write rules enforce the
application-source boundary at available layers.

Backend automation has a separate task-scoped boundary. protect-automation-scope.mjs requires
FHF_ACTIVE_TASK and checks every write against the manifest's frozen repository paths plus planned
change-unit paths. manual-task-guard.mjs permits only the selected backend-api-oracle pytest path in
Dev/QA; validate-backend-automation.mjs parses changed Python and enforces test-layer contracts.
Shell writes, credentials, dependency changes, Git publication, uploads, and production backend
execution stay blocked.

### Cypress Cloud diagnostics

`connectors.cypressCloud` owns one read-only evidence chain: Cloud MCP → Cloud CLI → local JUnit.
The CLI uses the official `@cypress/cloud` package, reads each lane's project ID from its existing
`cypress.config.js`, uses OAuth locally, and accepts CI authentication only through the external
`CYPRESS_CLOUD_TOKEN` environment variable. Tokens never belong in the harness config or command
line.

E2E permits full read diagnostics, including Test Replay when needed. Smoke and the workspace root
are metadata-only: run/spec/test lists are allowed, while replay and screenshot downloads are
blocked because they can put live production records into model context and the local replay cache.
`FHF_ALLOW_PROD_DATA=1` remains the explicit owner-controlled session opt-in.

## Loop engineering

`engineering.loops` owns every bounded retry limit:

- repeated failure escalation;
- generator/evaluator repair cycles;
- Stop-hook spec sweep retries;
- owner approval at phase boundaries.

Loops are proposal-only. They never self-approve, merge, or determine release quality. A loop
terminates as `completed`, `blocked`, or `escalated`; it does not invent a fourth strategy after
the configured limit.

### Runtime evaluation evidence

The evaluator does not use a committed repair-outcome fixture. Gate agents record `gate_verdict`,
`repair_started`, and `repair_completed` events with `.harness/record-loop-event.mjs`. The canonical
`eval-harness.mjs` discovers the ignored `engineering.context.runtime.traceFile` under the configured
workspace and lane roots, groups events by `runId`, and measures convergence only for runs that
actually entered repair. Missing traces remain `unavailable`, never zero or a fabricated pass.

Gate calibration is a separate human-review workflow:

```text
node scripts/harness/calibrate-gate.mjs collect --trace <loop-trace.jsonl>
node scripts/harness/calibrate-gate.mjs status
node scripts/harness/calibrate-gate.mjs label --id <case> --human-pass <pass|fail> --human-score <0..1> --reviewer <name> --rationale <text>
```

Collection imports only machine-scored gate verdicts. It never fills human fields automatically;
agreement metrics are withheld until every collected case has an explicit reviewer, pass/fail label,
score, and rationale.

## Runtime flow

```text
prompt
  → route context
  → ground task manifest and freeze selected graph slice
  → select repository-local rules, runner, and optional specialist
  → execute through pre/post guards
  → collect proof-mode-specific native evidence
  → repair within configured limit
  → deterministic next step, durable handoff, or owner escalation
```

Generator and evaluator remain separate. Cypress-only implementation routes to `cypress-generator`;
backend-only and combined frontend/backend automation route to `qa-automation-generator`, with
`qa-automation-debugger` and `qa-automation-gate` owning cross-layer diagnosis and verdicts.
Cypress-only merge judgment routes to `cypress-gate`; Cypress-only failures route to
`cypress-debugger`; Cypress shipping and reports route to `cypress-shipper`.

## Change protocol

1. Change `config/qa-control-plane.json` for policy, product topology, task protocol, runners,
   budgets, routing, memory, or limits.
2. Change hook/script code only for executable behavior.
3. Run `scripts/harness/sync-loader-shims.mjs`.
4. Run every command in `engineering.harness.verify.canonical` from this repo.
5. Do not commit generated or agent-authored work without owner review.

`engineering.harness.verify` is split on purpose:

- `canonical` — `scripts/harness/*` checks that exist only in `fhf-harness-os`.
- `consumer` — `node .harness/verify.mjs`, vendored into every clone.

`check-docs-links.mjs` validates the engineering pillars, Jira contract, product topology, task
protocol, runner matrix, routes, roster, hook paths, limits, documentation owners, and Obsidian
boundary. `check-loader-drift.mjs` verifies named generated
files only; it does not treat owner `.cursor/*`, owner `.github/*`, or `architecture/README.md`
as generated. `test-hooks.mjs` verifies runtime behavior. `test-adapter-contract.mjs` checks official
compaction projection, hook deduplication, capability fallbacks, sandbox boundaries, and loop wiring.
