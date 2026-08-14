# Harness Engineering

`config/qa-control-plane.json` is the single non-secret configuration for the FHF QA system.
Its `engineering` object connects context, memory, harness, and loop behavior. Tool-native
settings are generated projections, not additional sources of truth.

## Architecture

```text
qa-control-plane.json
  ├─ connectors.cypressCloud → MCP/CLI diagnostics, auth boundary, lane access
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
  → select skill/agent
  → execute through pre/post guards
  → verify
  → repair within configured limit
  → durable handoff or owner escalation
```

Generator and evaluator remain separate. Cypress implementation routes to `cypress-generator`;
merge judgment routes to `cypress-gate`; failures route to `cypress-debugger`; shipping and
reports route to `cypress-shipper`.

## Change protocol

1. Change `config/qa-control-plane.json` for policy, topology, budgets, routing, memory, or limits.
2. Change hook/script code only for executable behavior.
3. Run `scripts/harness/sync-loader-shims.mjs`.
4. Run every command in `engineering.harness.verify.canonical` from this repo.
5. Do not commit generated or agent-authored work without owner review.

`engineering.harness.verify` is split on purpose:

- `canonical` — `scripts/harness/*` checks that exist only in `fhf-harness-os`.
- `consumer` — `node .harness/verify.mjs`, vendored into every clone.

`check-docs-links.mjs` validates the four engineering pillars, routes, roster, hook paths, limits,
documentation owners, and Obsidian boundary. `check-loader-drift.mjs` verifies named generated
files only; it does not treat owner `.cursor/*`, owner `.github/*`, or `architecture/README.md`
as generated. `test-hooks.mjs` verifies runtime behavior. `test-adapter-contract.mjs` checks official
compaction projection, hook deduplication, capability fallbacks, sandbox boundaries, and loop wiring.
