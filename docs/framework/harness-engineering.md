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
- Read output is bounded before it enters context, except paths in `readOutput.fullContextPaths` (`docs/framework/`, `docs/adr/`), which are the correct context and load in full. Every other large file stays in configured line chunks. The router injects the matched bundle slice, so the control plane does not have to be dumped into the turn.
- `engineering.harness.hooks` is the only hook list. Claude settings and Cursor hooks are projections of it.
  `emitPrompt` writes one payload for both prompt events. Rule text stays in `.claude/rules`.

The runtime sequence is: classify prompt → select the highest-priority route as a candidate →
name every other match → honour task intent, then that route's `invoke` → read the injected
bundle seeds, legal `expandBy` reasons, and one topology hop → perform the job. Text inside
`chat_selection` is not part of the match. Prompt keywords are advisory; task intent remains
authoritative, and a single regex is not proof when another route also matched. The same
`prompt-router.mjs` is the decision for every host that can deliver `additionalContext`.
Claude `UserPromptSubmit` and Cursor `beforeSubmitPrompt` run that same script and emit one payload.
The route text is in `additionalContext` and `user_message`. `session-context.mjs` repeats the same
loop-state and routing rule at session start for both hosts. The skill hook blocks names off the allow-list
and `skillLanes` misses; it does not re-score the prompt. `spawnBudget` and `modelTiers` are
parent policy, not hook gates. A manifest that names an expansion reason outside the bundle's
`expandBy`, or a repository that is not a seed or one hop from those seeds, is invalid.

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

Human approval is six ordered stamps (`spec`, `scenarios`, `plan`, `test-cases`, `evidence`,
`release`), each bound to a digest of named manifest fields and recorded as
`{ approvedBy, approvedAt, digest }`. A human stamps a gate with
`node .harness/task-protocol.mjs approve --manifest <task.json> --gate <id>` from a real terminal
or a piped `yes`; Claude Code and Cursor Agent cannot approve. The legacy single `approvedDigest`
still satisfies the `plan` gate only. Changed ticket data, source SHAs/paths, classification, graph
slice, dependencies, impact, runners, proof modes, scenario citations, or evidence artifacts
invalidate the matching stamp and block the next step. Unclassified or `ask-product` rows emit
`classify-intent-vs-built` and block planning. `defect` rows emit `resolve-intent-vs-built-defect`
and block verified/complete. Dependency cycles and unknown dependencies also block. The decision
core emits one machine-readable next action; it never approves, commits, merges, deploys, or writes
externally. Do not route FHF work through the global `lane` CLI or dashboard. Session start and
every prompt inject the current gate. Write and pytest hooks fail closed on the earliest
missing stamp, so step 2 cannot start until step 1 is approved. Approval itself stays
human: the harness never types `yes`.

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
- Session-start, pre-compaction, and session-end hooks restore or checkpoint the same file,
  and every loop completion event checkpoints it at the phase boundary.
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

### Vendor conformance

Verified 2026-09-03 against the vendor sources, not against recollection: Claude Code hooks,
sub-agents, and settings references; Cursor hooks and rules references; and the AGENTS.md
standard. Re-verify when a vendor changes its lifecycle surface.

Confirmed correct, no change warranted:

- Exit 2 is the only self-blocking exit code, which is what every guard here uses. Exit 0 with
  `hookSpecificOutput` is the structured alternative, and `lib/hook-runtime.mjs` already emits
  `permissionDecision: allow` and `additionalContext` in that form.
- `SubagentStart` is wired on both Claude and Cursor, so agent-roster enforcement no longer
  depends on matching the Task tool alone and is not bypassed by other spawn paths.
- `cursor.promptRouting: before-submit-prompt` means Cursor runs `prompt-router.mjs` from
  `engineering.harness.hooks.prompt`, the same script Claude runs. `emitPrompt` is the only prompt
  payload. Session start runs `session-context.mjs` from `engineering.harness.hooks.sessionStart` on both.
- Cursor defaults to fail-open on hook crash or timeout. Every protective `preToolUse` entry and the
  `subagentStart` entry set `failClosed: true`. Post-write validators also fail closed, so a validator
  crash cannot be reported as a clean pass.
- `codex.instructionFile: AGENTS.md` with `hookCapability: instruction-only` matches the standard:
  plain Markdown, no frontmatter, no hook surface, nearest-file precedence.
- Cursor rules ship as `.mdc`. Plain `.md` in `.cursor/rules/` is ignored by Cursor.
- Agent `maxTurns` is pinned by `engineering.harness.agentRuntime` and checked before projection.
  Backend and cross-layer agents preload `backend-test-author` through native `skills` frontmatter;
  projection fails when either guarantee drifts from policy.

Known divergence from available vendor capability, recorded rather than silently accepted:

- `updatedInput` on `PreToolUse` can correct a tool call instead of rejecting it. Every guard here
  blocks; none repair.
- The hook `if` field can pre-filter a command before the script runs. Not used; all filtering is
  in-script.

Newly governed and enforced:

- `qualityAssurance.tagTaxonomy` owns the Cypress hierarchy: TYPE plus MODULE plus FEATURE plus
  BEHAVIOR on `describe` (directly or through `SUITE_TAGS`), and STATUS on every `it`.
  `validate-cypress-rules.mjs` consumes that policy for both lanes in addition to the Smoke critical
  cap and quarantine metadata.
- `qualityAssurance.frontendTestData` owns allowed and forbidden data sources, isolation, and
  cleanup. Cypress builders and evaluators consume it; persistent E2E mutation retains the stronger
  synthetic-owned identity, known-baseline, exact-result, prohibited-outcome, and verified-cleanup
  requirements.
- `engineering.taskProtocol.crossRepositorySeam` makes ADR-0024's first step executable. When a
  manifest selects frontend and backend automation, each participating change unit records the same
  `{ endpoint, correlationKey }`, or an explicit `NOT_APPLICABLE` with evidence. Task validation
  rejects omission, malformed linkage, and mismatched seams.
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

### Agent loop contract

Every roster agent participates in the same loop under one `runId` (ADR-0025). The contract has two
halves and both are required — an agent that only records produces a log, and an agent that only
reads cannot be measured.

- **Read first.** Before planning, an agent reads `engineering.context.runtime.stateFile`. Absent
  means first pass. Present and matching the active `runId` means `verdicts`, `failures`,
  `lastProgressAt`, and `repairCycles` are inputs: the agent states what changed since that cycle
  and never re-applies an action the state records as attempted without effect. `repeat-tool-guard.mjs`
  compares the next tool call with the last recorded call and output. An identical call exits 2 and
  returns that output. `PostToolUse` and `PostToolUseFailure` record the exchange in
  `engineering.context.runtime.lastToolFile`.
- **Record throughout.** Evaluators record `gate_verdict`. Every other phase records
  `phase_started` and `phase_completed` with a `phase` from `engineering.loops.phases`
  (`generation`, `debug`, `ship`, `gate`, `sweep`), validated by the recorder. `progress` is true
  only when the pass changed a file or produced new evidence.

`repair_started` and `repair_completed` stay reserved for repair cycles, because
`repairOutcomesFromTrace` derives convergence from those two types — labelling first-pass work as
repair would corrupt the metric.

### Conformance with the published loop pattern

Lulla et al., *Loop Engineering: Building Blocks, Adoption, and Impact* (August 2026), studied 36,710
repositories and found 217 running autonomous agent loops in production. They name six building
blocks. Audited against this harness on 2026-09-16:

| Building block | Here |
|---|---|
| Triggered runs | 15 wired hook phases — the loop starts on an event, not a send |
| Machine-checkable stop conditions | `engineering.loops` limits; terminal states `completed`/`blocked`/`escalated` |
| Persistent state files | `engineering.context.runtime.stateFile` + `traceFile`, `runId`-scoped |
| Verifier sub-agents | `cypress-gate`, `qa-automation-gate`, `verify-subagent-citations`, plus code verifiers |
| Budgets | `executionBudget` hard ceilings, recorder-enforced, `budget_exceeded` on breach |
| Escalation points | owner-action stop; `escalated` is a terminal state, not a failure mode |

All six are present. The paper's central finding is that *"almost none of the repositories commit the
state files the discourse prescribes"* — the block this harness has had since ADR-0025, and the one
that makes a loop resumable rather than merely repetitive.

One dimension was genuinely missing and is now added: `executionBudget.hardCeilings.maxTokens`.
Wall-clock time and recorded tool results bound a run's *shape*, not its *spend*. It is an optional
field rather than a required one — adding it to `requiredFields` would invalidate every manifest
written before today — and `tokenEnforcement` is `advisory-until-a-runtime-reports-usage`, because a
ceiling nothing measures is decoration.

## Graph engineering

Feng et al., *Graph Engineering in the Era of LLM Agents* (August 2026), argues that individual agent
capability hits an architectural ceiling when work needs "heterogeneous expertise, interdependent
subtasks, parallel execution, independent verification, and persistent state". It names three
primitives, and this harness already has all three:

| Primitive | Here |
|---|---|
| **Node** — an agent or task | the roster in `engineering.harness.agents` |
| **Edge** — execution flow | `engineering.context.routes`, every one carrying `invoke` |
| **State** — shared, evolving context | `cypress/handoff/loop-state.json`, schema `fhf-harness/loop-state/v1` |

The distinction that matters: in a loop, state is buried implicitly in a growing message history; in
a graph it is an explicit object every node reads and writes. The agent loop contract above — read
the state file before planning, record throughout — is that property already stated as a rule.

**A loop is a graph with one dominant path.** Loop engineering does not stop applying when graph
engineering starts; it becomes the behaviour of a single node. The harness's bounded retries run
*inside* a node, and the routing table is the graph between them.

### Two different graphs — do not conflate them

`build-knowledge-index.mjs` emits a **knowledge graph**: specs, business rules, tests, endpoints and
Oracle objects joined by declared references. It improves what the model *knows*, and belongs to
context engineering.

An **agent graph** coordinates workers — who runs, in what order, sharing what state. It improves how
agents *cooperate*.

They share a word and nothing else. "We already have a graph" is true of the first and says nothing
about the second.

### When a graph is warranted

Start at the simplest layer that solves the problem and add structure only on hitting that layer's
failure mode:

- an agent retrying the same failing call needs a **verifier**, not a better prompt;
- an agent that has forgotten the original goal needs **state**, not a larger context window;
- an agent that cannot hold the breadth of a task needs a **graph**, not a stronger model.

`backfill-traces.mjs` is the worked example. 617 business rules across 14 modules exceed one agent's
span — tunnel vision, the third failure mode — so the work fans out per module and converges into
patches. It does not hit the other two, which is why it stays a script with a code verifier rather
than becoming a framework. Its verifier is `resolveTraces()`: a checker that is code cannot agree
with a worker's mistake, which is strictly stronger than a second model reviewing the first.

A `phase_completed`, `repair_completed`, or `loop_completed` event is also a **memory checkpoint**:
the recorder merges the event's `findings` and `artifacts` through the configured `factExtractors`
into `engineering.memory.handoffFile`. Compaction discards the within-session channel before the
PreCompact hook fires, so the phase boundary — not session end — is where facts are captured.

### Runtime evaluation evidence

The evaluator does not use a committed repair-outcome fixture. Gate agents record `gate_verdict`,
`repair_started`, and `repair_completed` events with `.harness/record-loop-event.mjs`. The canonical
`eval-harness.mjs` discovers the ignored `engineering.context.runtime.traceFile` under the configured
workspace and lane roots, groups events by `runId`, and measures convergence only for runs that
actually entered repair. Missing traces remain `unavailable`, never zero or a fabricated pass.

Convergence is gated on `thresholds.minimumRepairSamples`, not on the first recorded outcome. Below
that floor the rate is reported and marked UNKNOWN without failing the gate: a single outcome
carries a Wilson interval too wide to support any verdict, and failing on it would make recording
the first real trace the act that turns the gate red.

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
