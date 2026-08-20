# Engineering Agentic AI Systems — The Complete Technical Guide

**Harness Engineering · Context Engineering · Memory Engineering · Loop Engineering · Self-Learning Systems**

---

## How to Read This Document

This guide is written to be read front-to-back the first time, then used as a reference. Each part follows the same structure: **concepts first** (the mental model), **why it matters** (the failure you avoid), **design patterns** (the reusable solutions), **pseudocode** (the shape of an implementation), and **implementation tips** (hard-won practical advice).

The five disciplines covered here are not independent topics. They are five views of one problem: *how do you turn a stateless text-prediction model into a reliable system that does real work over time?* Keep that question in mind throughout — every technique in this document is an answer to some piece of it.

---

# PART 1 — FOUNDATIONS

## Chapter 1: The Agentic AI Stack — From "Chat" to "Systems That Do Work"

### 1.1 The core limitation of a raw LLM

A large language model, by itself, is a **pure function**:

```
tokens_in  →  [ model ]  →  tokens_out
```

It has no memory between calls, no hands, no eyes, no clock, and no persistence. Every invocation starts from zero. It cannot check whether what it said was true, cannot retry when it fails, and forgets everything the moment the call ends.

And yet inside that pure function lives something remarkable: general reasoning, language understanding, code generation, planning ability. The entire discipline of agentic engineering is about **wrapping that pure function in machinery** that compensates for what it lacks:

| The model lacks... | We engineer... |
|---|---|
| Hands (ability to act) | **Harness** — tools, executors, sandboxes |
| Working attention discipline | **Context engineering** — what goes into the window |
| Long-term memory | **Memory engineering** — stores, retrieval, consolidation |
| Persistence over time | **Loop engineering** — the cycle that keeps it going |
| Ability to improve | **Self-learning** — feedback that changes future behavior |

This table is the whole document in miniature. Everything that follows elaborates one row of it.

### 1.2 What makes a system "agentic"

There is a spectrum, not a binary. It helps to name the levels precisely because the engineering effort required jumps at each level:

**Level 0 — Completion.** One prompt in, one answer out. No tools, no state. (Autocomplete, one-shot summarization.)

**Level 1 — Chat.** Multi-turn conversation. The "memory" is just the transcript replayed each turn. Still no ability to act.

**Level 2 — Tool-augmented chat.** The model can call functions (search, calculator, database query), but a human drives every step. The model acts, but only one step at a time, on request.

**Level 3 — Workflow.** A *developer-defined* sequence of LLM calls and tool calls. The path is fixed in code; the model fills in the blanks at each node. Predictable, testable, limited.

**Level 4 — Agent.** The model *decides its own path*. It is given a goal, a set of tools, and a loop. It plans, acts, observes results, and re-plans until the goal is met or a budget is exhausted. The control flow lives in the model's decisions, not in your code.

**Level 5 — Self-improving agent.** An agent whose performance on future tasks improves as a result of past tasks — via accumulated memory, learned skills, refined prompts, or updated weights.

A crucial engineering rule falls out of this spectrum:

> **Use the lowest level that solves the problem.** Workflows (Level 3) are cheaper, more predictable, and easier to debug than agents (Level 4). Reach for autonomy only when the task's path genuinely cannot be known in advance — open-ended research, debugging, multi-step tasks in unpredictable environments.

### 1.3 The canonical agent equation

Nearly every agent system, regardless of framework, reduces to this loop:

```
state = initial_context(goal)
while not done:
    action  = model(state)          # model decides what to do
    result  = environment(action)   # harness executes it
    state   = update(state, action, result)   # context/memory updated
```

Three functions — `model`, `environment`, `update` — and one loop. The five engineering disciplines map onto it directly:

- **Harness engineering** builds `environment(action)`: how actions are defined, executed, sandboxed, and reported back.
- **Context engineering** decides what `state` contains when it's handed to the model — the single most leveraged decision in the system.
- **Memory engineering** extends `state` beyond one loop and one session — what survives, where it lives, how it comes back.
- **Loop engineering** designs the `while` itself: when to plan, when to reflect, when to stop, when to spawn sub-loops.
- **Self-learning** closes the outer loop: results from *past* runs change how *future* runs behave.

### 1.4 Why "engineering" and not "prompting"

Early LLM work treated the prompt as the product. That era is over for serious systems, for three reasons:

1. **Reliability compounds badly.** A single model call that's right 95% of the time yields a 20-step agent that completes correctly ~36% of the time (0.95²⁰). Agents need *error recovery machinery*, not just better prompts — recovery is what converts per-step reliability into end-to-end reliability.
2. **Context is a physical constraint.** Windows are large but finite, and effective attention degrades well before the hard limit. Managing what occupies the window is a resource-allocation problem, like managing RAM.
3. **Behavior must be inspectable.** Production systems need tracing, evals, rollback, and audit. Those are systems-engineering artifacts, not prompt artifacts.

The prompt still matters — enormously — but it is now *one component* inside an engineered system, the way a SQL query matters inside a database application.

---

## Chapter 2: The Core Mental Model — Model → Harness → Loop → Context → Memory → Learning

### 2.1 The layered architecture

Think of the full system as concentric layers around the model:

```
┌──────────────────────────────────────────────────────────┐
│  SELF-LEARNING LAYER                                     │
│  evals · feedback · skill library · prompt optimization  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  MEMORY LAYER                                      │  │
│  │  episodic · semantic · procedural stores           │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │  LOOP LAYER                                  │  │  │
│  │  │  plan → act → observe → reflect → repeat     │  │  │
│  │  │  ┌────────────────────────────────────────┐  │  │  │
│  │  │  │  CONTEXT LAYER                         │  │  │  │
│  │  │  │  system prompt · retrieved docs ·      │  │  │  │
│  │  │  │  tool results · compacted history      │  │  │  │
│  │  │  │  ┌──────────────────────────────────┐  │  │  │  │
│  │  │  │  │  HARNESS                         │  │  │  │  │
│  │  │  │  │  tools · executor · sandbox ·    │  │  │  │  │
│  │  │  │  │  permissions · tracing           │  │  │  │  │
│  │  │  │  │  ┌────────────────────────────┐  │  │  │  │  │
│  │  │  │  │  │        MODEL (LLM)         │  │  │  │  │  │
│  │  │  │  │  └────────────────────────────┘  │  │  │  │  │
│  │  │  │  └──────────────────────────────────┘  │  │  │  │
│  │  │  └────────────────────────────────────────┘  │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

Each layer has a distinct **timescale**:

| Layer | Timescale | Question it answers |
|---|---|---|
| Model | Milliseconds (one forward pass) | "Given this text, what comes next?" |
| Harness | One action (~seconds) | "How does a decision become a safe, real effect?" |
| Context | One model call | "What should the model see right now?" |
| Loop | One task (minutes–hours) | "How do steps chain into completed work?" |
| Memory | Across sessions (days–months) | "What should persist beyond this task?" |
| Learning | Across tasks (weeks–forever) | "How does the whole system get better?" |

This timescale view is the most useful diagnostic lens you will get from this document. When an agent misbehaves, ask: *at which timescale did it fail?*

- Wrong single answer with good inputs → **model** problem (pick a stronger model, or restructure the prompt).
- Right decision, wrong execution or unsafe side effect → **harness** problem.
- Model confused, missing info, or distracted by irrelevant info → **context** problem.
- Individual steps fine, but wandering, looping, or stopping early → **loop** problem.
- Great in session one, amnesiac in session two → **memory** problem.
- Same mistake repeated across weeks → **learning** problem.

### 2.2 How the layers interact — the two flows

Two flows run through the stack constantly:

**The downward flow (intent → effect):** a goal enters at the top, the loop decomposes it into steps, context engineering assembles what the model needs for each step, the model decides an action, the harness executes it in the world.

**The upward flow (effect → knowledge):** raw results come back from the harness, get summarized into context, notable events get written into memory, and patterns across many memories get distilled into learned skills and improved prompts.

Most architectural bugs are flow bugs: information that should travel up gets dropped (results not fed back, lessons not stored), or the downward flow lets too much through (unfiltered context, unsandboxed actions).

### 2.3 The economics: tokens, latency, and reliability

Every design choice trades off three currencies:

- **Tokens (cost):** every byte in context is paid for on every call. Long histories mean quadratic-ish cost growth over a task.
- **Latency:** more loop iterations, more retrieval calls, and bigger contexts all slow the system. Sub-agents parallelize but add coordination overhead.
- **Reliability:** more verification steps, more reflection, and more redundancy improve correctness but consume tokens and time.

A useful heuristic: **spend tokens where errors are expensive, save tokens where errors are cheap.** A financial-report agent should verify aggressively; a brainstorming agent should not.

### 2.4 A worked example: one request through all layers

To make the layers concrete, trace a single request — *"Find why our checkout latency spiked yesterday and draft an incident summary"* — through the full stack:

1. **Learning layer** (before the task even starts): the agent's skill library contains a `latency-investigation` skill distilled from past incidents; its instructions get loaded.
2. **Memory layer:** episodic memory retrieval surfaces a note from three weeks ago: "checkout latency correlated with cache-node restarts." That note enters context.
3. **Loop layer:** the planner decomposes: (a) pull latency metrics, (b) pull deploy log, (c) correlate, (d) draft summary. It will re-plan after (c) if no cause is found.
4. **Context layer:** for step (a), the context contains the system prompt, the plan, the skill instructions, the memory note — *not* the entire metrics database. Retrieval is scoped to yesterday's checkout metrics.
5. **Harness:** the model emits `query_metrics(service="checkout", window="24h")`. The harness validates arguments, runs the query read-only, truncates the result to the significant series, and returns it.
6. **Upward flow:** the result enters context; the loop's observe phase notes a spike at 14:20; correlation with the deploy log finds a cache config change at 14:15. The drafted summary is produced; the run's trajectory is stored to episodic memory; a consolidation job later strengthens the "cache changes → checkout latency" association in semantic memory.

Every layer touched, once. That is the shape of a healthy agentic system.

### 2.5 Principles that recur across all five disciplines

Before diving into each discipline, note five principles that will reappear in every part. Internalizing them gives you taste — the ability to make good decisions in situations this document doesn't cover.

**P1 — The model is stateless; the system is stateful.** All state lives *outside* the model, in artifacts you control: context buffers, files, databases, traces. This is a feature: it makes state inspectable and editable.

**P2 — Everything the model sees is a design decision.** There is no "neutral" context. Whatever is in the window shapes behavior; whatever is absent is invisible. You are always curating, whether deliberately or by accident.

**P3 — Feedback loops beat perfect plans.** Because errors compound, agents that observe and correct outperform agents that plan flawlessly and execute blindly. Invest in observation and recovery, not just planning.

**P4 — Compression with intent.** At every boundary (tool result → context, context → memory, memory → skill), information must be compressed. Good compression preserves *decision-relevant* detail and discards the rest. Bad compression is truncation.

**P5 — Autonomy is granted, not assumed.** Capability and permission are separate axes. An agent may be capable of deleting a database and still be forbidden to. Design permission boundaries first, capabilities second.

---

# PART 2 — HARNESS ENGINEERING

## Chapter 3: What a Harness Is

### 3.1 Definition and scope

The **harness** is everything that stands between the model's *decision* to act and the *actual effect* in the world. If the model is the driver, the harness is the entire vehicle: controls, engine, brakes, airbags, and dashboard.

Concretely, a harness comprises:

1. **Tool definitions** — the menu of actions the model can take, described in schemas the model reads.
2. **The dispatcher/executor** — code that parses the model's tool call, validates it, routes it to the right implementation, and runs it.
3. **The environment** — where execution happens: a sandbox, a container, an API client, a browser.
4. **Permission and policy layer** — what's allowed, what needs confirmation, what's forbidden.
5. **Result processing** — turning raw outputs (stack traces, HTML, 50MB of JSON) into something useful and appropriately sized for the context window.
6. **Error handling, retries, budgets** — the machinery that keeps one failed action from killing the task.
7. **Observability** — traces, logs, and replay so humans can see what happened and why.

### 3.2 Why the harness deserves the word "engineering"

The naive view: "tools are just function calling — write a function, give it a schema, done." The reality: **the harness is where most production failures happen**, because it is the boundary between probabilistic text and deterministic systems. Common boundary failures:

- The model emits a tool call with a hallucinated parameter name → parse error → agent stuck.
- A tool returns 200,000 tokens of raw API response → context flooded → model degrades for the rest of the task.
- An error returns `"Error: exception"` with no detail → the model can't recover because it can't diagnose.
- A "list files" tool secretly allows path traversal → security incident.
- Two tools have overlapping purposes → the model dithers between them, wasting turns.

Each of these is a harness bug, not a model bug. The same model with a better harness would have succeeded.

### 3.3 The harness contract

A well-engineered harness upholds a contract with the model, analogous to an API contract between services:

> **Every action the model requests receives a response that is: (a) truthful, (b) informative enough to act on, (c) small enough not to poison the context, and (d) delivered even when the action failed.**

Point (d) matters most. Silence is the worst possible tool result. A model that never learns its action failed will build the rest of its plan on a false premise.

---

## Chapter 4: Tool Design Principles

### 4.1 Tools are prompts

The single most important insight of tool design: **the tool's name, description, and parameter schema are part of the prompt.** The model chooses tools by reading these descriptions the way a new employee reads documentation. Every rule of good prompt writing applies:

- **Name tools by intent, not implementation.** `search_customer_orders` beats `query_db_v2`. The model reasons in task language, not infrastructure language.
- **Describe when to use the tool and when *not* to.** The best tool descriptions read like advice from a senior engineer: "Use this for X. Do not use it for Y — use `other_tool` instead. Results are capped at N items."
- **Document edge cases in the description.** If a parameter is case-sensitive, if dates must be ISO-8601, if an empty result means "not found" vs "no access" — say so. The model can only respect constraints it can see.
- **Give parameters unambiguous names and enums where possible.** `sort_order: "asc" | "desc"` is model-proof; `flag: boolean` ("what does true mean?") is not.

A practical test: hand your tool descriptions to a competent human with no other documentation and ask them to do the task. Where they get confused, the model will too.

### 4.2 Granularity: how big should a tool be?

Two failure poles:

- **Too fine-grained:** `open_file`, `read_line`, `move_cursor`, `close_file`. The model burns dozens of turns doing what one call should do, and each turn adds latency and error probability.
- **Too coarse-grained:** `do_the_task(description)`. The tool becomes an opaque sub-agent; the model can't decompose, inspect, or recover from partial failures.

The design rule: **a tool should correspond to one meaningful decision.** The model decides *what* to read → one `read_file(path)` call. The model decides *what to search for* → one `search(query, filters)` call. Everything below the decision level (opening handles, pagination mechanics, auth) belongs inside the tool implementation, invisible to the model.

Corollary — **consolidate workflows the model always performs together.** If every use of `list_contacts` is followed by `get_contact_details`, offer `search_contacts` that returns details inline. Each eliminated round trip is saved tokens, saved latency, and one less chance to err.

### 4.3 Designing tool *outputs* (the neglected half)

Most teams obsess over tool inputs and neglect outputs. But outputs land directly in the context window, so they are context engineering by another name:

1. **Return the significant part, not the raw payload.** An HTTP tool should return status, key headers, and parsed body — not the raw bytes. A test-runner tool should return failures with stack traces, and just a count for passes.
2. **Cap and paginate.** Every tool that can return unbounded data must have a hard cap and a way to get more (`offset`, `next_page_token`). State the cap in the description so the model knows results may be partial.
3. **Prefer high-signal identifiers.** Returning `name`, `slug`, or `title` alongside opaque UUIDs helps the model keep entities straight across turns.
4. **Make results self-describing.** `{"results": [], "note": "no orders matched; filters applied: status=refunded, window=30d"}` prevents the model from misreading an empty list as an error — or an error as an empty list.
5. **Consider response-format modes.** A `detail: "concise" | "full"` parameter lets the loop request cheap summaries during exploration and full detail only when needed.

### 4.4 Errors as first-class outputs

Design error responses with the same care as success responses. A good error tells the model **what failed, why, and what to try instead**:

```json
{
  "ok": false,
  "error": "file_not_found",
  "message": "No file at 'src/utils/date.ts'.",
  "suggestion": "Directory 'src/utils/' contains: dates.ts, format.ts. Did you mean 'dates.ts'?"
}
```

That `suggestion` field routinely converts a failed trajectory into a one-turn recovery. Other error-design rules:

- **Never swallow errors.** An exception inside a tool must surface as a structured error result, not a silent empty response.
- **Distinguish retryable from fatal.** `rate_limited (retry_after: 30s)` and `permission_denied` demand different model behavior; label them.
- **Validate before executing.** Catch schema violations, missing parameters, and obviously invalid values *before* touching the real system, and report them precisely ("`limit` must be ≤ 100, got 5000").

### 4.5 Idempotency and safety semantics

Because models retry, wander, and occasionally repeat themselves, tools must be safe under repetition:

- **Reads should be pure.** No side effects, ever.
- **Writes should be idempotent where possible.** `set_status(order_id, "shipped")` is safe to repeat; `increment_counter()` is not. Where true idempotency is impossible, accept a client-generated `request_id` and deduplicate server-side.
- **Destructive operations get speed bumps.** Require an explicit `confirm: true` parameter, or split into `propose_deletion` → human/policy approval → `execute_deletion`.
- **Declare side-effect class in the tool metadata.** Tag each tool `read`, `write`, or `destructive`. The policy layer (§5) keys off these tags.

### 4.6 Scaling the tool catalog: flat lists vs. tool search

With ≤ ~20 well-differentiated tools, list them all in every call. Beyond that, tool definitions themselves start consuming serious context, and — worse — similar tools blur together and selection accuracy drops.

Patterns for large catalogs:

- **Tool search / deferred loading:** expose a single `search_tools(query)` meta-tool. Full definitions are loaded into context only for tools relevant to the current task. This keeps the resident tool set small and sharp.
- **Namespacing:** prefix tools by domain (`jira_create_issue`, `slack_send_message`). Clear namespaces help the model — and human reviewers — partition the space.
- **Task-scoped toolsets:** the orchestrator (or a router step) selects a toolset per task phase: research phase gets search tools; execution phase gets write tools. This doubles as a safety measure — write tools simply don't exist during research.
- **Prune ruthlessly.** If two tools overlap, merge or delete one. Every ambiguous choice you remove is reliability you gain for free.

---

## Chapter 5: Safety Rails

### 5.1 The principle: capability ≠ permission

Design the harness so that what the agent *can* do and what it *may* do are enforced in different places. Capability lives in tool implementations; permission lives in a policy layer the model cannot alter. Never rely on the prompt alone to prevent an action — prompts shape behavior, policies enforce it.

### 5.2 Sandboxing

Run agent actions in the least-privileged environment that still permits the task:

- **Filesystem:** a scratch directory per task; read-only mounts for reference material; explicit allow-lists for writable paths. The agent's workspace should be disposable.
- **Code execution:** containers or microVMs with CPU/memory/time limits and no default network. If the network is needed, allow-list domains at the egress proxy.
- **Credentials:** the model never sees raw secrets. Tools hold credentials server-side; the model references resources by name ("the production database" → resolved and permission-checked in the harness).
- **Blast radius:** prefer staging systems, dry-run modes, and shadow writes. An agent that can only propose diffs (which are then applied by deterministic code after review) is categorically safer than one that edits live systems.

### 5.3 Human-in-the-loop (HITL) gates

Full autonomy is a dial, not a switch. Standard settings:

| Mode | Behavior | Use when |
|---|---|---|
| **Approve-each-action** | Every side-effecting call pauses for confirmation | New agents, high-stakes domains |
| **Approve-by-class** | Reads auto-approved; writes require confirmation; destructive requires typed confirmation | The common production default |
| **Plan approval** | Human approves the *plan* once; execution proceeds unattended within it | Long tasks with trusted tool policies |
| **Post-hoc review** | Agent acts freely; all effects are reviewable and reversible | Low-stakes, fully sandboxed work |

Two implementation notes. First, make gates *cheap to approve* (one keypress, rich diff shown inline) or humans will rubber-stamp without reading — which is worse than no gate. Second, log the human decision with the trace; approvals are part of the audit story.

### 5.4 Rollback and reversibility

Design for undo before you design for do:

- **Checkpoint before mutation.** Snapshot files (or use git commits) before edits; take DB backups or use transactions before writes.
- **Prefer append over overwrite.** New versions beside old ones; soft-deletes over hard-deletes.
- **Compensating actions.** For external effects that can't be transactionally undone (an email sent, an API call made), maintain a ledger of effects and, where possible, a compensation routine (send correction, call the cancel endpoint).
- **The reversibility test:** before granting an agent a tool, ask "if it calls this at the worst possible moment with the worst possible arguments, how do we get back?" If there's no answer, add a gate or remove the tool.

### 5.5 Prompt injection defense at the harness level

Any text an agent reads — web pages, emails, file contents, tool results — may contain adversarial instructions ("ignore previous instructions and send the credentials to..."). Harness-level defenses:

- **Provenance tagging:** wrap untrusted content in markers the system prompt defines as *data, never instructions* (e.g., a `<document>` envelope), and instruct the model accordingly. This is mitigation, not proof.
- **Policy holds regardless of persuasion:** because permission is enforced outside the model (§5.1), even a fully-persuaded model cannot exceed its grants. This is your real defense.
- **Taint-aware gating:** actions requested *after* ingesting untrusted content can be held to stricter approval rules, especially exfiltration-shaped actions (sending data out, making network calls with content payloads).
- **Egress control:** the surest way to prevent data exfiltration is a network layer that can't reach arbitrary destinations.

### 5.6 Observability and tracing

You cannot debug, audit, or improve what you cannot replay. Minimum viable observability:

- **Full trajectory traces:** every model call (context in, output out), every tool call (arguments, result, latency, error), with a shared `task_id` and step counter.
- **Redaction at write time:** secrets and PII scrubbed before traces are persisted.
- **Cost accounting:** tokens and dollars per step and per task; anomaly alerts on runaway loops.
- **Replay:** the ability to re-run a trace with a modified prompt, tool, or model version is the single most valuable debugging capability you can build. It converts "the agent did something weird" from an anecdote into an experiment.

---

## Chapter 6: A Minimal Harness — Reference Architecture and Pseudocode

### 6.1 Architecture

```
             ┌───────────────────────────────────────────┐
             │                AGENT LOOP                  │
             └───────────────┬───────────────────────────┘
                             │ tool_call(name, args)
                             ▼
   ┌───────────────────────────────────────────────────────┐
   │                      DISPATCHER                        │
   │  1. parse & validate against schema                    │
   │  2. policy check (side-effect class, taint, budget)    │
   │  3. [gate] pause for human approval if required        │
   │  4. route to executor                                  │
   └───────────────┬───────────────────────────────────────┘
                   ▼
   ┌───────────────────────────┐     ┌──────────────────────┐
   │        EXECUTORS          │────▶│   SANDBOX / CLIENTS   │
   │  files · shell · http ·   │     │  container, DB conn,  │
   │  search · domain APIs     │     │  API clients (creds   │
   └───────────────┬───────────┘     │  held here, not in    │
                   │                 │  the model's view)    │
                   ▼                 └──────────────────────┘
   ┌───────────────────────────┐
   │     RESULT PROCESSOR       │  truncate · summarize ·
   │                            │  structure · tag provenance
   └───────────────┬───────────┘
                   │ tool_result (bounded, structured)
                   ▼
             back to AGENT LOOP        ──▶  TRACE STORE (every step)
```

### 6.2 Pseudocode

```python
# ---------- Tool definition ----------
@dataclass
class Tool:
    name: str
    description: str          # written like documentation for a new hire
    schema: JsonSchema        # parameter validation
    effect: Literal["read", "write", "destructive"]
    handler: Callable[[dict, Sandbox], ToolResult]
    output_cap_tokens: int = 2000

# ---------- Dispatcher ----------
def dispatch(call: ToolCall, ctx: TaskContext) -> ToolResult:
    tool = registry.get(call.name)
    if tool is None:
        return err("unknown_tool",
                   suggestion=nearest_tool_names(call.name, registry))

    errors = validate(call.args, tool.schema)
    if errors:
        return err("invalid_arguments", details=errors)   # precise, actionable

    decision = policy.check(tool, call.args, ctx)          # effect class, taint,
    if decision.forbidden:                                 # budgets, allow-lists
        return err("policy_denied", reason=decision.reason)
    if decision.needs_approval:
        approved = await gate.request(call, preview=tool.preview(call.args))
        trace.log_approval(ctx.task_id, call, approved)
        if not approved:
            return err("user_denied", message="Action was not approved.")

    try:
        raw = with_timeout(tool.handler, call.args, ctx.sandbox,
                           timeout=policy.timeout_for(tool))
    except RetryableError as e:
        raw = retry_with_backoff(tool.handler, call.args, ctx.sandbox,
                                 max_attempts=3)
    except Exception as e:
        raw = err(classify(e), message=str(e),
                  suggestion=recovery_hint(tool, call.args, e))

    result = process(raw, cap=tool.output_cap_tokens)      # truncate w/ summary,
    result = tag_provenance(result, source=tool.name)      # mark as data-not-instructions
    trace.log(ctx.task_id, call, result, cost=meter.read())
    return result

# ---------- Result processing ----------
def process(raw: ToolResult, cap: int) -> ToolResult:
    if raw.token_count <= cap:
        return raw
    head = take_tokens(raw, cap * 0.8)
    return raw.replace(
        content=head,
        note=f"[truncated: {raw.token_count} tokens total; "
             f"use pagination or narrower filters to see more]")
```

### 6.3 Implementation tips

1. **Start with five tools, not fifty.** Read, write, search, execute, and one domain-specific tool cover most tasks. Add tools only when traces show the model contorting to work around a gap.
2. **Watch real trajectories weekly.** The fastest harness-improvement loop is reading traces and asking "where did the model struggle, and which tool description or output format caused it?"
3. **Test tools against the model, not just against unit tests.** A tool can be functionally correct and still be unusable because its description misleads the model. Build small evals: given task X, does the model pick the right tool with the right arguments?
4. **Version your tool schemas.** Tool changes silently shift agent behavior; treat them like API changes, with changelogs and eval re-runs.
5. **Budget everything.** Per-task caps on tool calls, tokens, wall-clock time, and dollars. Runaway loops are a *when*, not an *if*.

---

# PART 3 — CONTEXT ENGINEERING

## Chapter 7: The Context Window as a Scarce Resource

### 7.1 What "context" actually is

The context window is everything the model can see when producing its next output: the system prompt, tool definitions, conversation history, retrieved documents, tool results, and the current instruction. It is the model's **entire perceptual universe for that call**. Nothing outside it exists, and everything inside it exerts influence.

**Context engineering** is the discipline of deciding, for every model call, *which tokens occupy that universe* — and it has largely superseded "prompt engineering" as the core skill, because in an agentic system the system prompt is a small, static fraction of the context. The dynamic majority (history, retrievals, tool results) is where quality is won or lost.

### 7.2 The attention budget

Two physical realities govern the window:

1. **Hard limit:** the window has a maximum size. Exceed it and the call fails or truncates.
2. **Soft degradation:** long before the hard limit, effective quality declines. Models exhibit *position effects* (information in the middle of very long contexts is recalled less reliably than information at the start or end — the "lost in the middle" effect), and *dilution effects* (the more irrelevant material present, the more attention is spread thin, and the likelier the model latches onto the wrong thing).

The right mental model: the window is not a bucket to fill but an **attention budget to allocate**. Every token you add pays rent in three currencies — dollars (per-call cost), latency, and *diluted attention on everything else*. The question is never "does this fit?" but "does this earn its place?"

> **The golden rule of context engineering: find the smallest possible set of high-signal tokens that maximizes the likelihood of the desired next step.**

### 7.3 The anatomy of a well-built context

A healthy agent context, at any given step, is layered roughly like this (top of window → bottom):

```
┌───────────────────────────────────────────────┐
│ 1. SYSTEM PROMPT      (stable — identity,     │
│    rules, tool guidance, output contracts)    │
├───────────────────────────────────────────────┤
│ 2. TASK FRAME         (the goal, constraints, │
│    acceptance criteria, current plan)         │
├───────────────────────────────────────────────┤
│ 3. DURABLE KNOWLEDGE  (retrieved memories,    │
│    loaded skills, project conventions)        │
├───────────────────────────────────────────────┤
│ 4. WORKING HISTORY    (compacted transcript   │
│    of the task so far — decisions & results,  │
│    not raw dumps)                             │
├───────────────────────────────────────────────┤
│ 5. FRESH EVIDENCE     (latest tool results,   │
│    retrieved documents for the current step)  │
├───────────────────────────────────────────────┤
│ 6. THE IMMEDIATE ASK  (what to do right now)  │
└───────────────────────────────────────────────┘
```

Layers 1–2 change rarely; 3 changes per task; 4 grows and must be actively compacted; 5 turns over every step; 6 is the loop's instruction. Most context bugs are layer-4 and layer-5 problems: raw material accumulating uncompacted, or evidence retrieved too broadly.

### 7.4 Stability as a first-class property (caching)

Modern inference stacks cache the key/value computation for context *prefixes*. If the first N tokens of your context are byte-identical across calls, those tokens are dramatically cheaper and faster. Design consequences:

- Put stable content (system prompt, tool definitions, task frame) **first** and never rewrite it mid-task.
- Append; don't edit. Inserting one character early in the context invalidates the cache for everything after it.
- Timestamp-like volatile values don't belong in the prefix.

This is a rare free lunch: the same layout discipline that helps the model (stable framing, fresh evidence last) also cuts cost and latency.

---

## Chapter 8: Core Techniques

### 8.1 System prompt design — the Goldilocks altitude

System prompts fail at two extremes:

- **Too specific (hardcoded logic):** long if-else chains of instructions for every situation. Brittle — the first situation you didn't anticipate breaks it — and a maintenance nightmare as contradictions accumulate.
- **Too vague (empty exhortation):** "You are a helpful, accurate assistant. Be thorough." Provides no actual signal about how to behave in this system.

The right altitude: **state the heuristics an excellent practitioner would follow, plus the hard constraints, and trust the model's generality for the rest.** Structure that works well in practice:

```
1. ROLE & OBJECTIVE     — what this agent is, what "done" means
2. HARD CONSTRAINTS     — non-negotiables (never X; always Y before Z)
3. TOOL GUIDANCE        — when to use which tool; common pitfalls
4. WORKFLOW HEURISTICS  — how to approach tasks (explore before acting,
                          verify after writing, prefer small steps)
5. OUTPUT CONTRACT      — formats, tone, what to include/omit
6. EXAMPLES             — 1–3 canonical demonstrations (worth more than
                          paragraphs of description; keep them diverse
                          and current)
```

Use clear section delimiters (headers or XML-style tags) — models parse structure well, and so do the humans who maintain the prompt. Write it like a well-organized runbook, then **prune**: for every sentence ask "what failure does this prevent?" If you can't name one, cut it.

### 8.2 Retrieval (RAG) — pre-computed context

Retrieval-augmented generation injects relevant documents into context at question time. In agentic systems, treat classic RAG as one point on a spectrum (see §8.3), best suited when:

- The corpus is large, mostly static, and semantically searchable (docs, wikis, tickets, papers).
- Latency matters — one retrieval call beats an agent exploring for ten turns.

Engineering notes that matter more than embedding-model choice:

- **Chunking is context design.** Chunks should be self-contained claims with their headers/breadcrumbs attached ("Ch 4 > Refunds > EU policy: ..."). A chunk that can't be understood alone can't be used alone.
- **Hybrid search wins.** Semantic (embedding) search plus lexical (BM25/keyword) search plus metadata filters. Pure semantic search misses exact identifiers; pure lexical misses paraphrases.
- **Two-stage retrieve-then-rerank.** Cast a wide net (top-50 cheap), then rerank to a handful (top-3–8) with a stronger model. What enters context should be few and dense, not many and diluted.
- **Attach provenance.** Every retrieved chunk enters context with its source. This enables citation, enables the model to weigh conflicting sources, and supports the injection defenses of §5.5.

### 8.3 Just-in-time context — agentic retrieval

The alternative to pre-loading: give the agent lightweight **references** (file paths, links, query interfaces, IDs) and tools to open them, and let it load what it needs *when it needs it*. This mirrors how humans work — we don't memorize the codebase; we keep it findable and open files on demand.

Advantages: context stays lean; the agent's exploration itself produces signal (a file's name, size, and neighbors carry meaning); no stale pre-computed index. Costs: exploration takes turns and tokens; the agent may miss what a good retrieval system would have surfaced.

**The mature answer is hybrid:** pre-load the cheap, high-value orientation material (project structure, conventions, the task-relevant memory notes), and leave the long tail behind tools. Let observed trajectories tune the boundary: if the agent always opens the same three files first, pre-load them.

### 8.4 Compaction — surviving long tasks

Any task long enough to matter will overflow the window with its own history. **Compaction** replaces older history with a distilled summary, preserving continuity in bounded space.

What a good compaction summary preserves (in priority order):

1. **The goal and current plan state** — what's done, what remains.
2. **Decisions and their reasons** — "chose approach B because A failed on X."
3. **Hard-won facts** — discovered constraints, key file paths, IDs, error signatures.
4. **Open questions and known unresolved issues.**
5. **Pointers, not payloads** — file paths and query strings that can re-fetch detail, instead of the detail itself.

What it discards: raw tool outputs already acted upon, dead-end exploration (keep one line: "X was tried and doesn't work because Y"), and conversational filler.

Mechanics:

```python
def maybe_compact(history, budget):
    if tokens(history) < budget.soft_limit:      # e.g., 70% of window share
        return history
    keep_tail = last_n_turns(history, n=5)       # recent turns stay verbatim
    to_fold   = history[:-5]
    summary   = model_call(COMPACTION_PROMPT, to_fold)   # structured template,
    return [summary_block(summary)] + keep_tail          # not freeform prose
```

Two safeguards: **compact with a structured template** (sections for plan / decisions / facts / open items) so nothing category-critical silently drops; and **tune on real traces** — the classic compaction bug is discarding a detail (an exact error message, a version number) the agent needs three steps later. A cheaper first line of defense: **tool-result aging** — clear or stub out raw tool outputs older than a few turns (leaving "result of step 7: see summary"), since the deepest history is rarely re-read but the decisions extracted from it are.

### 8.5 Sub-agent context isolation

For tasks with parallelizable or deep-dive components, spawn **sub-agents with their own clean context windows**. An orchestrator holds the plan; each sub-agent receives a narrow brief, explores deeply in its own window (burning tens of thousands of tokens freely), and returns a *condensed* result — the distilled answer, not the journey.

```
ORCHESTRATOR (plan, coordination — small, stable context)
 ├── sub-agent A: "Find how auth middleware handles token refresh.
 │                 Return: files involved, flow summary ≤ 500 tokens."
 ├── sub-agent B: "Survey competitor pricing pages. Return table."
 └── sub-agent C: "Reproduce bug #4132; return minimal repro steps."
```

This is context engineering's answer to the attention budget: *detailed exploration happens in disposable windows; only distilled knowledge enters the durable one.* Design rules: give each sub-agent an explicit **output contract** (format + token budget) or the condensation doesn't happen; and beware over-decomposition — coordination costs are real, and a task with tight sequential dependencies belongs in one context.

### 8.6 Structured note-taking — memory that costs almost nothing

Give the agent a scratchpad *outside* the context window — a `NOTES.md`, a todo list, a task journal — with tools to read and write it. The agent externalizes its state: plans, progress, discoveries, next steps. When context is compacted or the session restarts, the notes survive and re-anchor the agent.

This one technique — an agent that maintains its own persistent working file — is the highest-leverage, lowest-effort form of both context and memory engineering, and it foreshadows Part 4.

---

## Chapter 9: Failure Modes — Rot, Poisoning, and Distraction

Understanding how contexts fail turns vague "the agent got dumb" complaints into diagnosable bugs.

### 9.1 Context rot

**Symptom:** quality degrades gradually as a task grows longer, even though nothing is "wrong" in the context.
**Mechanism:** accumulated low-signal tokens (stale tool outputs, superseded plans, exhausted dead ends) dilute attention; position effects bury mid-context facts.
**Fixes:** compaction cadence tied to a soft budget (§8.4); tool-result aging; periodic "re-anchoring" where the loop restates goal + plan at the context tail (recency position is powerful — use it for what matters now).

### 9.2 Context poisoning

**Symptom:** the agent confidently pursues something false or wrong for the rest of the task.
**Mechanism:** an error entered the context and became load-bearing — a hallucinated "fact" in an early summary, a misread tool result, or a subtly wrong compaction. Because models treat their own prior statements as evidence, the poison self-reinforces each turn.
**Fixes:** verify before persisting (facts destined for summaries/memory get checked against sources); keep provenance so claims can be re-traced; design the loop's reflect phase to ask "what am I assuming that I haven't verified?"; when a task derails badly, the cheapest cure is often a **fresh-context restart** carrying only verified notes.

Adversarial poisoning — prompt injection via retrieved/browsed content — is the same mechanism with hostile intent; harness defenses in §5.5 apply.

### 9.3 Context distraction

**Symptom:** the agent fixates on something present-but-irrelevant — answering the question a retrieved document raises rather than the one it was asked, or imitating an example's surface features.
**Mechanism:** everything in the window exerts pull; irrelevant-but-vivid material competes with the actual instruction.
**Fixes:** retrieve narrower (rerank hard, top-k small); place instructions *after* long evidence blocks, not before (recency again); wrap documents in explicit framing ("background reference only — the task is X"); prune examples that are no longer representative.

### 9.4 Context clash (a fourth worth naming)

**Symptom:** the agent oscillates or hedges incoherently.
**Mechanism:** the context contains contradictions — an old plan and a new plan, two documents that disagree, an instruction the system prompt forbids.
**Fixes:** compaction should *supersede*, not accumulate (delete the old plan when writing the new one); when sources conflict, surface the conflict explicitly to the model with provenance rather than hoping it picks well.

---

## Chapter 10: Practical Patterns — Worked Examples

### 10.1 Pattern: the context assembler

Make context construction an explicit, testable function — never string concatenation scattered across the codebase:

```python
def build_context(task, step, budgets) -> Context:
    return Context([
        cached_prefix(                               # byte-stable across calls
            system_prompt(task.agent_profile),
            tool_definitions(task.toolset)),
        task_frame(task.goal, task.constraints,
                   task.plan.current()),
        durable(retrieve_memories(task, k=3),        # few and dense
                load_skills(task)),
        working_history(compacted(task.history,
                        budget=budgets.history)),
        fresh(task.latest_results,
              budget=budgets.evidence),
        instruction(step.ask)                        # last = maximally salient
    ]).enforce(budgets.total)                        # hard cap with priorities
```

Because it's a function, you can unit-test it ("given a 200-turn history, the goal statement still appears"), log its output per step, and diff it between runs when behavior changes. The `enforce` step implements priority-based trimming: fresh evidence and the instruction are protected; deep history gives way first.

### 10.2 Pattern: the research agent's funnel

Wide-then-narrow, with condensation at every stage:

1. Broad search returns 50 titles+snippets (cheap tokens).
2. Model selects 8 to open; each is fetched and *immediately summarized to notes* by a sub-agent (full text never enters the main window).
3. Main agent synthesizes from 8 dense notes with provenance.
4. Draft cites sources; a verification pass re-opens only the chunks backing contested claims.

The funnel shape — many cheap shallow looks, few expensive deep looks, aggressive condensation between stages — recurs in almost every well-engineered agent.

### 10.3 Pattern: the coding agent's working set

Mirror how senior engineers manage attention in a large codebase:

- Pre-load: repo map (paths + one-line descriptions), conventions file, the task's issue text.
- Just-in-time: `read_file` on demand; grep-style search instead of loading directories.
- Working set discipline: after editing a file, keep its *current* version and drop stale reads of it (clash prevention).
- Externalize: maintain `PLAN.md` with checklist state; re-read it at every loop iteration top.

### 10.4 Anti-patterns checklist

- ❌ Dumping raw API/tool responses into context "to be safe."
- ❌ One giant system prompt accreting special cases for every past bug.
- ❌ Retrieval top-k = 20 "for coverage" (dilution beats coverage).
- ❌ Compaction as blind truncation of the oldest turns.
- ❌ Editing early context mid-task (cache destruction + clash risk).
- ❌ Instructions buried above 10,000 tokens of documents.
- ❌ Believing a bigger window removes the need for any of this. (It raises the ceiling; the economics and attention effects remain.)

---

# PART 4 — MEMORY ENGINEERING

## Chapter 11: Memory Taxonomy

### 11.1 Why memory is a separate discipline

Context engineering answers "what should the model see *right now*?" Memory engineering answers a different question: **"what should the *system* know tomorrow, next week, and across every task?"** The context window is working RAM — fast, expensive, wiped between sessions. Memory is the disk and the filing system.

Without engineered memory, an agent is a brilliant amnesiac: it re-derives the same facts, re-asks the same questions, and repeats the same mistakes forever. Memory is what makes an agent an *entity with history* rather than a stateless service.

### 11.2 The four memory types (borrowed from cognitive science, made concrete)

| Type | Human analogue | Agent implementation | Example content |
|---|---|---|---|
| **Working** | What's in your head right now | The context window + scratchpad notes | Current plan, latest results |
| **Episodic** | Remembering events ("what happened") | Append-only log of task trajectories & interactions, timestamped | "On Aug 3, deploy failed; cause was expired cert; fixed by rotating" |
| **Semantic** | Knowing facts ("what is true") | Structured store of distilled facts, entities, preferences | "User prefers TypeScript. Staging DB is `pg-stg-04`. Refund window: 30 days" |
| **Procedural** | Knowing how ("skills") | Instructions/skills/playbooks the agent loads to perform task types | "How we do database migrations: steps 1–7, gotchas A–C" |

The types differ on every engineering axis — write path, read path, lifespan, and consolidation — which is why lumping "memory" into a single vector store underperforms:

- **Episodic** memory is written automatically (every task leaves a trace), read by similarity + recency, and is the *raw material* from which the other types are distilled.
- **Semantic** memory is written *deliberately* (extraction with verification), read by entity/topic lookup, and must be kept consistent — contradictory facts are worse than missing ones.
- **Procedural** memory is written rarely (a skill is authored or distilled), read by task-type matching, and versioned like code — because it *is* code, in the loosest sense.

### 11.3 The memory lifecycle

Every piece of memory moves through five stages, and each stage is a design decision:

```
CAPTURE ──▶ ENCODE ──▶ STORE ──▶ RETRIEVE ──▶ CONSOLIDATE / FORGET
 what is     in what     where &    what comes   what gets promoted,
 worth       form?       indexed    back, when,  merged, decayed,
 keeping?               how?       how much?    or deleted?
```

Most memory-system failures are stage mismatches: capturing everything (stage 1 too greedy) then drowning retrieval (stage 4); or encoding raw transcripts (stage 2 lazy) so retrieval returns haystacks instead of needles.

---

## Chapter 12: Storage Architectures

### 12.1 Vector stores

**What:** memories embedded into vectors; retrieval = nearest-neighbor search on the query embedding.
**Strengths:** fuzzy semantic matching ("problems with the checkout flow" finds "cart latency incident"); scales to millions of items; simple to stand up.
**Weaknesses:** no native structure — can't ask "everything about entity X, in order" reliably; similarity ≠ relevance (a vivid but obsolete memory outscores a dull but current one); updates are awkward (you can't easily "correct" a fact, only add a competing one).
**Best for:** episodic memory, document-shaped knowledge.

### 12.2 Knowledge graphs

**What:** entities as nodes, relationships as typed edges (`user —prefers→ TypeScript`, `service:checkout —depends_on→ cache-04`).
**Strengths:** precise multi-hop queries ("what services depend on things that changed yesterday?"); facts are updatable in place; contradictions are detectable (two conflicting edges on the same relation).
**Weaknesses:** extraction from raw text into clean triples is genuinely hard and error-prone; schema design is real work; overkill for unstructured recollection.
**Best for:** semantic memory in domains with rich entity structure (org data, infrastructure, CRM-like knowledge).

### 12.3 File-based memory

**What:** plain files the agent reads and writes with ordinary tools — `MEMORY.md`, `user_profile.md`, a `skills/` directory, per-project notes.
**Strengths:** trivially inspectable and editable by humans; version-controllable (git gives you history, diff, and rollback of the agent's *beliefs*); the agent needs no special machinery — file tools suffice; naturally curated (small, deliberate, high-signal).
**Weaknesses:** doesn't scale past what fits in a directory a model can navigate; retrieval is manual (the agent must know where to look); concurrent writers need discipline.
**Best for:** procedural memory (skills as files is the emerging standard), agent self-notes, small-team/single-user semantic memory. **Do not underestimate this option** — for a large fraction of real systems, a well-organized directory of markdown files beats a vector database on every axis that matters, including quality.

### 12.4 Relational / document stores

Ordinary databases remain the right answer for memory that is *actually structured data*: user preference tables, task outcome records, tool-usage statistics. If it has a schema, give it a schema.

### 12.5 The hybrid architecture (what mature systems converge on)

```
                        ┌─────────────────────────────┐
                        │        MEMORY ROUTER         │
                        │  (retrieval orchestration)   │
                        └──┬─────────┬─────────┬──────┘
                           │         │         │
              ┌────────────▼──┐ ┌────▼─────┐ ┌─▼──────────────┐
              │ EPISODIC      │ │ SEMANTIC │ │ PROCEDURAL     │
              │ vector store  │ │ graph or │ │ files: skills/ │
              │ of trajectory │ │ fact DB  │ │ playbooks,     │
              │ summaries     │ │ w/ prov- │ │ versioned      │
              │ (+ recency    │ │ enance & │ │ in git         │
              │  index)       │ │ conflict │ │                │
              └───────────────┘ │ checks   │ └────────────────┘
                                └──────────┘
                    ▲ writes flow up from consolidation jobs
```

The router is worth emphasizing: at task start, it fans a query out ("user context?", "similar past tasks?", "matching skills?"), gathers candidates from each store, reranks jointly, and hands the context assembler (§10.1) a few dense items. Retrieval strategy differs per store — recency-weighted similarity for episodic, exact entity lookup for semantic, task-type matching for procedural.

---

## Chapter 13: Pipelines — Writing, Reading, Consolidating, Forgetting

### 13.1 The write path: what deserves to be remembered

Greedy capture is the classic beginner error. Store everything and retrieval drowns; the memory becomes a landfill. Selective capture, at three trigger points:

1. **End-of-task (automatic):** every completed task writes one episodic record — a *structured summary* of the trajectory, not the transcript: goal, outcome, key decisions, surprises, errors encountered and their fixes, artifacts produced.
2. **Salience triggers (in-task):** certain events warrant immediate writes — an explicit user correction ("no, always use the staging environment"), a discovered fact that contradicts stored belief, a hard-won solution to a nasty error. Detect these with lightweight rules plus a model judgment ("is this worth remembering beyond the task? what type?").
3. **Deliberate agent writes:** give the agent a `remember(content, type, tags)` tool and prompt guidance on using it. Agents are decent judges of salience when asked to be.

**Encode at write time.** The moment of writing is when full context is available; the retrieval moment is when it's gone. So resolve pronouns, attach entities, timestamps, provenance, and task tags *now*:

```json
{
  "type": "episodic",
  "when": "2026-08-03T14:20:00Z",
  "task": "deploy-hotfix-4132",
  "summary": "Deploy failed at cert validation; root cause expired TLS cert on pg-stg-04; fixed by rotating cert via vault; total delay 40min.",
  "entities": ["pg-stg-04", "vault", "checkout-service"],
  "lesson": "Check cert expiry as first hypothesis for sudden TLS failures on staging.",
  "provenance": "trace:8f3a...",
  "confidence": "verified"
}
```

That `lesson` field — the generalizable takeaway, separated from the incident narrative — is what consolidation (§13.3) feeds on.

### 13.2 The read path: retrieval without drowning

- **Retrieve at task start, sparingly during.** A memory pull when the task begins (goal-conditioned) sets the frame. Mid-task retrieval should be *agent-initiated* via a `recall(query)` tool when it recognizes a gap — not fired on every step, which floods context with near-duplicates.
- **Score = similarity × recency × importance.** Pure similarity resurfaces the vivid-but-stale. A standard scoring blend (each factor normalized): relevance to query, exponential recency decay, and a stored importance weight (bumped by user corrections, repeated retrieval, verified status).
- **Few and dense.** Top-3 well-encoded memories beat top-15. Memories enter context under the same budget discipline as everything else (§10.1).
- **Label memories as memories.** Enter them into context with type and date ("[semantic memory, verified 2026-07-12]: ..."), so the model can weigh them properly and notice staleness.

### 13.3 Consolidation: turning experiences into knowledge

Consolidation is the background process — human sleep is the analogy — that transforms raw episodic accumulation into compact, durable knowledge. Run it as periodic jobs (nightly/weekly), off the critical path:

1. **Deduplicate & merge:** cluster near-identical episodic records; keep one canonical version with a count ("this pattern seen 7×").
2. **Extract semantic facts:** when multiple episodes agree ("three tasks confirm the user prefers concise answers"), promote the fact to semantic memory — with provenance links back to the supporting episodes, and *verification* before promotion (contradiction check against existing facts).
3. **Distill procedures:** when episodic memory shows the same task type solved repeatedly, a consolidation pass drafts a *skill* — a playbook capturing the winning approach and its gotchas. (This is the bridge to self-learning; §21 completes it.)
4. **Resolve contradictions:** new verified facts supersede old ones; the old fact is tombstoned (kept, marked superseded, with date) rather than deleted — belief history is diagnostic gold.
5. **Recompute importance:** decay unused memories; boost repeatedly-retrieved ones.

### 13.4 Forgetting: a feature, not a failure

Systems that never forget degrade: retrieval noise rises, contradictions accumulate, and stale knowledge actively misleads ("the deploy script is `deploy.sh`" — it was renamed months ago). Engineer forgetting deliberately:

- **Decay:** importance scores decay exponentially with time-since-last-use; below a floor, memories drop out of the retrievable set (archive, don't destroy — cheap storage means "forget" should mean "stop retrieving").
- **TTL by type:** working notes expire in days; episodic in months (post-consolidation); semantic facts persist until superseded; skills persist until deprecated.
- **Supersession over deletion:** corrections tombstone the old belief with a pointer to the new one.
- **Compaction of the store itself:** periodically merge long tails of old episodes into era-summaries ("Q2 2026: 40 deploy tasks, common issues were X, Y").

### 13.5 Failure modes to design against

- **Memory poisoning:** an unverified hallucination gets stored, then retrieved as trusted fact — self-reinforcing across tasks (the cross-session cousin of §9.2). Defense: confidence fields, verification before semantic promotion, provenance everywhere.
- **Stale confidence:** old facts retrieved without dates read as current truth. Defense: timestamps in the context representation, staleness checks for volatile domains.
- **Retrieval echo:** the agent stores what it retrieved, creating duplicates that amplify each retrieval. Defense: dedupe on write; never store content tagged as having come *from* memory.
- **Privacy creep:** memories accumulate personal/sensitive data far from its origin. Defense: classification at write time, redaction rules, per-scope stores (per-user, per-project) with hard boundaries, and honoring deletion requests through the *entire* pipeline (including consolidated derivatives).

---

## Chapter 14: Implementation Walkthrough

### 14.1 A minimal-but-real memory subsystem

Schema (one table/collection per concern, plus a vector index):

```sql
-- episodic
CREATE TABLE episodes (
  id UUID PRIMARY KEY,
  task_id TEXT, when_ts TIMESTAMPTZ,
  summary TEXT,             -- the encoded record (§13.1)
  lesson TEXT,
  entities TEXT[],
  embedding VECTOR(1024),
  importance REAL DEFAULT 1.0,
  last_retrieved TIMESTAMPTZ,
  provenance TEXT,
  status TEXT DEFAULT 'active'   -- active | archived
);

-- semantic
CREATE TABLE facts (
  id UUID PRIMARY KEY,
  subject TEXT, predicate TEXT, object TEXT,   -- lightweight triple
  scope TEXT,                                  -- user | project | global
  confidence TEXT,                             -- asserted | verified
  valid_from TIMESTAMPTZ, superseded_by UUID NULL,
  provenance UUID[]                            -- supporting episode ids
);

-- procedural: a directory, not a table
--   skills/<task-type>/SKILL.md   (versioned in git)
```

Core operations:

```python
def remember(content, type, ctx):
    rec = encode(content, ctx)               # resolve refs, entities, tags,
    rec = verify_if_semantic(rec)            # timestamps, provenance
    if is_duplicate(rec):                    # dedupe on write
        return merge_and_count(rec)
    store(rec)

def recall(query, task, k=3):
    cands = []
    cands += episodic.search(query, boost=recency*importance, n=15)
    cands += facts.lookup(entities_in(query) + entities_in(task))
    cands += skills.match(task.type)
    top = rerank(query, cands)[:k]
    touch(top)                               # update last_retrieved/importance
    return [with_labels(m) for m in top]     # "[semantic, verified 2026-07-12]: ..."

def consolidate():                           # nightly job
    merge_duplicates(episodes.recent())
    for pattern in recurring_patterns(episodes):
        fact = extract_fact(pattern)
        if verify(fact) and not contradicts(fact, facts):
            promote(fact, provenance=pattern.episode_ids)
        elif contradicts(fact, facts):
            queue_for_resolution(fact)
    decay_importance(episodes)
    archive_below_floor(episodes)
```

### 14.2 Implementation tips

1. **Start with files.** A `memory/` directory (`profile.md`, `projects/<x>/notes.md`, `skills/`) plus read/write tools delivers 70% of the value at 5% of the complexity. Add the vector store when the directory stops fitting in a navigable structure; add the graph only when multi-hop entity queries become a real need.
2. **Make memory visible.** Users and developers should be able to browse, edit, and delete what the agent believes. Hidden memory erodes trust and hides poisoning.
3. **Measure retrieval quality, not just recall speed.** Build a small eval: for N historical tasks, did `recall()` surface the memory that actually mattered? Precision@3 on that set is your north-star metric.
4. **Write the compaction/consolidation prompts with the same care as the system prompt.** They silently shape everything the system will believe later.
5. **The killer test:** run the same non-trivial task twice, a week apart. The second run should be measurably faster/better *because of* memory — fewer exploration steps, no repeated mistakes. If it isn't, your memory system is decoration.

---

# PART 5 — LOOP ENGINEERING

## Chapter 15: Anatomy of the Agent Loop

### 15.1 The five phases

Every agent loop, whatever the framework calls its parts, cycles through five phases:

```
        ┌──────────────────────────────────────────────┐
        │                                              │
        ▼                                              │
   ① PERCEIVE ──▶ ② PLAN ──▶ ③ ACT ──▶ ④ OBSERVE ──▶ ⑤ REFLECT
   assemble        decide      execute    ingest &      evaluate progress;
   context         next        via        interpret     continue, re-plan,
   (goal, state,   step(s)     harness    results       recover, or stop
   memory, fresh
   evidence)
```

- **Perceive** is context engineering invoked per-iteration: build the window (§10.1).
- **Plan** ranges from implicit ("the model just decides the next tool call") to explicit (a written plan artifact, updated as steps complete). Explicit plans cost tokens but give you inspectability, HITL plan-approval gates (§5.3), and drift detection.
- **Act** is one or more tool calls through the harness — possibly parallel when independent.
- **Observe** is where raw results become understanding: was that what we expected? what changed?
- **Reflect** is the loop's steering wheel: measure progress against the goal, detect being stuck, decide the next iteration's shape — or decide *done*.

Beginner loops collapse phases ④–⑤ into "append result, call model again." Production loops make observation and reflection explicit, because that's where error-compounding is arrested: a bad step caught in reflection costs one iteration; uncaught, it costs the task.

### 15.2 The loop's state

Alongside the context window, a well-built loop maintains explicit machine-readable state:

```python
@dataclass
class LoopState:
    goal: str
    plan: Plan                    # steps w/ status: todo|doing|done|failed
    step_count: int
    budgets: Budgets              # tokens, tool calls, wall clock, dollars
    last_progress_at: int         # step index of last verified progress
    failures: list[FailureRecord] # what failed, how often, with what error
    artifacts: dict[str, Path]    # things produced so far
    verdicts: list[Reflection]    # reflect-phase outputs (for drift analysis)
```

This state lives *outside* the model (P1), drives the loop's control decisions in ordinary code, and is what checkpointing (§18) persists.

---

## Chapter 16: Loop Patterns

Patterns are listed from simplest to most elaborate. The workflow patterns (16.1–16.2) have developer-defined control flow; the agent patterns (16.3+) hand control flow to the model. Recall the Level rule from §1.2: use the simplest pattern that fits.

### 16.1 Workflow patterns (fixed control flow)

- **Prompt chaining:** step A's output feeds step B's prompt (outline → draft → polish). Add programmatic checks between steps.
- **Routing:** a classifier step dispatches the input to one of several specialized paths (support triage → billing flow vs. tech flow).
- **Parallelization:** independent subtasks fan out and results merge — either *sectioning* (different subtasks) or *voting* (same task N times, aggregate for reliability).
- **Evaluator–optimizer:** a generator produces, an evaluator critiques against explicit criteria, the generator revises; loop until pass or max rounds. This is the workhorse pattern for quality-sensitive generation (code, documents, translations) — its power depends entirely on the evaluator having *real* criteria (a rubric, tests, a checklist), not vibes.

### 16.2 Orchestrator–workers

An orchestrator model decomposes the task *dynamically* (unlike parallelization's fixed split), dispatches subtasks to worker agents (each with isolated context, §8.5), and synthesizes results. The pattern of choice for research, multi-file code changes, and anything whose decomposition can't be known upfront. Engineering notes: worker briefs need output contracts; the orchestrator needs a synthesis step that handles conflicting worker findings; and depth beyond two levels (workers spawning workers) rarely pays for its coordination cost.

### 16.3 ReAct — the foundational agent loop

**Re**ason + **Act**: the model interleaves explicit reasoning ("thought") with tool calls ("action"), observing results between each:

```
Thought: I need the current cert expiry for pg-stg-04.
Action:  vault_read(path="certs/pg-stg-04")
Observation: expires 2026-08-02 (yesterday)
Thought: Expired cert matches the TLS failure hypothesis. Next: rotate.
Action:  ...
```

The interleaved thought stream serves three purposes: it improves decision quality (reasoning before acting), it leaves a legible trace (debuggability), and it gives the reflect phase material to evaluate. Virtually every modern tool-using agent is ReAct at its core, with the elaborations below layered on.

### 16.4 Plan-and-execute

Separate planning from execution: a planning step produces an explicit multi-step plan; an execution loop works through it, marking steps done; a re-planning trigger fires when reality diverges (a step fails, new information invalidates assumptions). Compared to pure ReAct: better on long tasks (the plan is an anchor against wandering), cheaper (planning uses the big model once; execution steps can use smaller models), and gate-able (plan approval). The essential subtlety is the **re-planning trigger** — plans must be commitments, not straitjackets. Re-plan on: step failure after retries, discovery that contradicts a plan assumption, or reflect-phase drift detection. Don't re-plan on every hiccup, or you've rebuilt expensive ReAct.

### 16.5 Reflection loops

After producing work, the agent (or a second model instance) critiques it and revises. Three grades, in increasing power:

1. **Self-critique:** same model, "review your answer for errors." Cheap; catches shallow mistakes; prone to self-agreement.
2. **Grounded critique:** critique anchored to external signal — run the tests, check the citations, execute the code, compare against the rubric. **This is the grade that matters.** Reflection without ground truth is a mirror; reflection with ground truth is a feedback loop.
3. **Adversarial critique:** a separate critic model with an explicitly adversarial brief ("find what's wrong"), optionally with different context. Best quality; 2× cost.

### 16.6 Multi-agent loops

Multiple agents with distinct roles interacting: debate (proposer vs. challenger, judge decides), review chains (author → reviewer → approver), or role-structured teams. Use when *genuinely different perspectives or permission sets* are needed — a security-reviewer agent that has no write tools reviews the coder agent's diff. Be skeptical of multi-agent maximalism: each added agent adds coordination surface, and many published multi-agent gains reproduce with one agent and a better loop. The strong, evergreen cases are: context isolation (§8.5), permission separation, and specialization across truly different toolsets.

---

## Chapter 17: Termination, Budgets, and Convergence

### 17.1 The stopping problem

An agent must decide "done" under uncertainty, and both failure directions are costly: stopping early ships incomplete work; stopping late burns budget and often *degrades* completed work (the agent keeps "improving" past the optimum). Engineer termination as a hierarchy of checks, evaluated in the reflect phase:

1. **Goal test (best):** an objective, programmatic completion check — tests pass, the file exists and validates, the answer matches the schema. Invest here first; every task type that gets a real goal test becomes an order of magnitude more reliable.
2. **Self-assessment against acceptance criteria (good):** the task frame (§7.3) carries explicit criteria; reflection checks each. Weaker than a goal test but far stronger than "do you feel done?"
3. **Budget exhaustion (backstop):** hard caps on steps, tokens, time, dollars. On exhaustion: stop gracefully — summarize state, save artifacts and notes, report what's done and what remains. A budget death should never lose work (see checkpointing, §18).

### 17.2 Degenerate loops and how to break them

The classic pathologies, their signatures in `LoopState`, and the standard breaks:

| Pathology | Signature | Break |
|---|---|---|
| **Retry loop** | Same action + same error ≥ 2× | Inject the failure history into context with an explicit "this approach fails; choose a different one"; after N distinct approaches fail, escalate to human |
| **Oscillation** | State A→B→A→B (edit undone, redone...) | Detect via state hashing; freeze the contested decision, force a reflect step that names the tradeoff and commits |
| **Drift** | Actions increasingly unrelated to goal | Re-anchor: restate goal + plan at context tail every k steps; reflection scores each step's goal-relevance |
| **Stall** | `step_count - last_progress_at > k` | Progress watchdog triggers re-plan or escalation |
| **Perfection spiral** | Post-completion edits with shrinking diffs | Stop on goal-test pass; cap revision rounds in evaluator–optimizer |

The general defense underneath all five: **make progress measurable** (explicit plan with checkable steps, goal tests), so "not progressing" is a computable condition rather than a vibe.

### 17.3 Convergence design

Beyond breaking bad loops, design for convergence pressure:

- **Monotonic artifacts:** structure work so it accumulates (a growing checklist of passing tests, sections of a document completed) rather than being globally revisable at every step.
- **Narrowing scope:** later iterations should operate on smaller scopes than earlier ones (whole task → failing area → specific fix). If iteration k+1's scope is larger than iteration k's, that's drift.
- **Decreasing temperature (figuratively):** early iterations explore (try approaches, gather info); late iterations exploit (execute, verify, polish). A loop still "exploring" at step 40 of 50 is a smell that the plan phase failed.

---

## Chapter 18: Checkpointing and Long-Running Agents

### 18.1 The durability problem

Tasks that run for hours — or across days, with waits on humans, CI, or external events — will encounter crashes, restarts, rate limits, and context exhaustion. A durable agent treats its own execution as resumable.

### 18.2 What to checkpoint

Everything needed to resume ≠ everything in RAM. The checkpoint set:

- `LoopState` (§15.2) — plan, budgets spent, failure records, artifact index.
- The **compacted context** (or better: the notes file + the recipe to rebuild context via the assembler, §10.1). Persisting a context-rebuild *recipe* beats persisting raw context: it stays small and rebuilds fresh.
- The workspace (files) — naturally durable if the sandbox is disk-backed; snapshot/commit at checkpoint time.
- The trace pointer (resume point in the trajectory log).

Checkpoint *when*: after every side-effecting action (so effects and recorded state never diverge), on plan updates, and on a timer. Keep checkpoints append-only and versioned — an agent resuming from a *corrupted-belief* checkpoint (context poisoning that got persisted, §9.2) needs the option to rewind further.

### 18.3 Resumption

```python
def resume(task_id):
    st   = checkpoints.latest(task_id)
    ws   = workspace.restore(st.workspace_ref)
    ctx  = build_context(st.task, step=st.step_count,     # rebuild, don't
                         budgets=fresh_budgets())         # replay history
    ctx += resumption_brief(st)   # "You are resuming. Done: ... Next: ...
                                  #  Beware: <failure records>"
    return run_loop(st, ctx, ws)
```

The **resumption brief** is the key artifact — a fresh-context restatement of state that also, usefully, launders accumulated context rot: resumed agents often perform *better* than they did pre-crash. (Some teams exploit this deliberately: scheduled fresh-context restarts on very long tasks.)

### 18.4 Waiting and external events

Long-running agents pause on the world: awaiting human approval (§5.3), a CI run, a reply to an email. Model these as first-class suspensions — checkpoint, register a wake condition (webhook, poll, timeout), release compute — rather than as an agent spinning in a sleep-check loop. This turns the agent from a process into a *state machine advanced by events*, which is what durable-execution frameworks provide; the same shape can be hand-built with a queue and a checkpoint table.

### 18.5 Loop-engineering tips

1. **Instrument the reflect phase.** Log every reflection verdict with its evidence. When agents fail, the reflection log tells you whether the loop *knew* it was failing (control bug) or didn't (observation bug) — different fixes.
2. **Tune iteration granularity.** Steps too small → token burn on ceremony; too large → errors compound invisibly within a step. Rule of thumb: one step = one verifiable claim of progress.
3. **Let easy tasks exit fast.** Loop machinery (plan, reflect, verify) should be *proportional*: a trivial task should cost ~1 model call. Gate the heavyweight loop behind a complexity check.
4. **Parallelize observations, serialize decisions.** Fan out independent reads freely; keep writes and plan changes single-threaded per task.
5. **The loop is a product surface.** Progress reporting ("step 3/7: rotating cert...") is not cosmetic — it's what earns human trust and makes HITL gates usable.

---

# PART 6 — SELF-LEARNING SYSTEMS

## Chapter 19: Levels of Self-Improvement

### 19.1 What "learning" means for a system with frozen weights

Here is the reframe that makes this whole part tractable: **the model's weights do not need to change for the *system* to learn.** The system's behavior is a function of (weights, prompts, tools, memory, skills). Improving any component improves the system. This yields a ladder of self-improvement mechanisms, ordered by cost, risk, and depth:

| Level | What changes | Mechanism | Cost/Risk | Timescale |
|---|---|---|---|---|
| **L1** | Context | Memory-based learning: lessons from past tasks retrieved into future contexts | Trivial / low | Immediate |
| **L2** | Procedural memory | Skill acquisition: distilled, versioned playbooks | Low / low | Days |
| **L3** | Prompts | Automated prompt optimization against evals | Medium / medium | Weekly |
| **L4** | Tools & harness | The system proposes/authors new tools, improved descriptions | Medium / medium | Weekly |
| **L5** | Weights | Fine-tuning (SFT, RLHF/DPO/RLAIF) on accumulated data | High / high | Monthly+ |

Most teams should climb this ladder in order, and many excellent production systems never go past L3. The lower levels are inspectable (you can *read* what was learned — it's text in files), reversible (git revert a bad skill), and cheap. Weight-level learning is powerful but opaque, expensive, and capable of quiet regression.

### 19.2 L1 — Memory-based learning

Already built, if you built Part 4: the `lesson` fields of episodic records (§13.1), retrieved into future task contexts, *are* learning. The agent that hit the expired-cert incident retrieves "check cert expiry first for sudden TLS failures" next time and skips forty minutes of exploration. Engineering focus: lesson *quality* (the write-time encoding prompt should explicitly ask "what generalizes beyond this incident?") and retrieval precision (§14.2, tip 3).

### 19.3 L2 — Skill acquisition

A **skill** is procedural memory made explicit: a named, versioned document (plus optional scripts/templates) that tells the agent how to perform a *class* of task — the approach that works, the order of operations, the gotchas, the quality bar. Skills are loaded into context when a matching task arrives (progressive disclosure: load the index of skills always, the full skill only on match).

Skills come from three sources, in increasing autonomy:

1. **Authored:** a human writes the playbook. (Most skills today; entirely reasonable.)
2. **Distilled:** consolidation (§13.3) drafts a skill from repeated successful trajectories; a human reviews and merges. This is the sweet spot — the system proposes, a human disposes, git records.
3. **Self-acquired:** the agent, upon completing a novel task successfully, writes the skill itself and adds it to its library. The canonical demonstration is the *Voyager* pattern (§21.3). Requires strong verification, because a wrong skill is poisoned procedural memory with a long half-life.

Treat the skill library exactly like a codebase: review, versioning, tests (evals per skill — does loading it improve the task-type's pass rate?), deprecation.

### 19.4 L3 — Prompt self-optimization

The system prompt, tool descriptions, compaction prompts, and reflection prompts are all *parameters* — and they can be optimized against an eval suite rather than hand-tuned forever:

```
loop:
  run eval suite with current prompt P            → score, failure cases
  analyze failures (a model does this)            → hypotheses
  generate candidate edits P₁..Pₖ                 → targeted, minimal diffs
  evaluate candidates on held-out eval split      → pick winner if it beats P
  human reviews the diff                          → merge
```

This is the eval-driven analogue of gradient descent, with prompts as weights and the eval suite as the loss. Two disciplines make it safe: **held-out evaluation** (optimizing on the cases you inspected overfits exactly like it does in ML) and **diff review** (automated prompt edits can encode narrow hacks — "if the question mentions dates, answer March" — that a human catches instantly).

### 19.5 L4 — Tool and harness improvement

Traces reveal harness friction: tools the model misuses, missing tools it works around, descriptions it misreads (§6.3). A learning system closes this loop — a periodic analysis job reads failure traces and proposes: reworded tool descriptions, new tool candidates ("in 14 tasks the agent chained `list`+`get` 5× — propose `search_with_details`"), tighter output caps. Human-reviewed, eval-verified, merged. The agent improving its own body, one PR at a time.

### 19.6 L5 — Weight-level learning (the high-level map)

When the system has accumulated large volumes of high-quality trajectories and the lower levels plateau, weights become the lever:

- **SFT (supervised fine-tuning):** train on curated successful trajectories — "behave like your best runs." Simplest; needs good filtering (train only on *verified* successes or you teach the failure modes too).
- **RLHF (reinforcement learning from human feedback):** train a *reward model* on human preference comparisons (which of these two outputs is better?), then optimize the policy against it. Powerful; complex; vulnerable to reward hacking (§22.2).
- **DPO (direct preference optimization):** skips the explicit reward model — optimizes directly on preference pairs. Simpler pipeline, similar intent.
- **RLAIF (RL from AI feedback):** the preference/critique signal comes from a model applying a written constitution/rubric instead of (or alongside) humans — scales feedback collection; inherits the rubric's blind spots.
- **RL against verifiable rewards:** where ground truth is checkable (tests pass, answer correct), train directly on task success. The cleanest signal when the domain permits it.

For most application teams the practical form of L5 is: *collect and curate trajectories from day one* (your traces are the dataset), and fine-tune small/mid models on your distilled data to cut cost and latency on the routine portions of your workload — while the frontier model handles the hard tail.

---

## Chapter 20: Feedback Signals — the Fuel of Learning

### 20.1 No signal, no learning

Every level of §19 is powered by the same underlying resource: a **signal that distinguishes better from worse.** The quality of your self-learning system is bounded by the quality of this signal — before designing any learning loop, design its signal. Taxonomy, from strongest to weakest:

1. **Verifiable outcomes:** tests pass, the build compiles, the answer equals ground truth, the booking exists. Objective, automatic, unhackable-ish. *Structure your tasks to maximize how much of the work is verifiable* — this single architectural choice does more for learning than any algorithm.
2. **Programmatic checks:** linters, schema validators, citation-exists checks, latency/cost measurements. Partial signal — necessary-not-sufficient conditions — but free and instant.
3. **Model-as-judge:** a model scores outputs against a written rubric. Scales infinitely; correlates decently with human judgment when the rubric is concrete ("cites a source for every factual claim: yes/no") and poorly when it's abstract ("is this insightful?"). Always calibrate judges against a sample of human labels, and audit periodically for drift and sycophancy (judges prefer confident-sounding text).
4. **Human feedback — explicit:** ratings, edits, approvals/rejections at HITL gates. Gold-quality, scarce. Spend it where cheaper signals disagree or don't reach.
5. **Human feedback — implicit:** the user retried, rephrased, abandoned, or (best) *edited the agent's output before using it*. Diffs between what the agent produced and what the human shipped are a superb, free training signal.

### 20.2 Evals: the institution that makes learning safe

An **eval suite** is a versioned set of tasks with scoring — the system's test suite for *behavior*. It serves as: regression protection (every prompt/tool/model change runs the suite), the optimization target for L3/L4, the curation filter for L5 data, and the arbiter of whether "learning" actually happened.

Building one that works:

- **Source cases from reality:** every interesting production failure becomes an eval case (the agent's equivalent of regression tests from bug reports).
- **Grade with the strongest available signal per case:** verifiable where possible, rubric-judge elsewhere, small human-labeled calibration set always.
- **Split:** development set (inspect freely) vs. held-out set (optimize-blind) — non-negotiable once any automated optimization exists.
- **Track the distribution, not the average:** a change that improves the mean while creating a new 5% catastrophic-failure mode is a regression.

### 20.3 Reward models and their care

When feedback must generalize beyond enumerable checks (L5, or large-scale L3), a **reward model** — trained on preference data to score arbitrary outputs — stands in for the human. The critical failure mode is **reward hacking / Goodharting**: the policy discovers outputs that score high without being good (verbose padding, confident hedging, exploiting judge biases, or in coding domains: deleting the failing tests). Defenses: keep the reward model fresh (retrain on new preferences as the policy shifts), regularize the policy toward its pre-training behavior, mix in verifiable signals the reward model can't overrule, and monitor for the signature symptom — eval scores rising while spot-checked human judgment doesn't.

---

## Chapter 21: Self-Learning Architectures

### 21.1 Experience replay (the minimal loop)

The simplest complete self-learning architecture — Parts 4 and 6 wired together:

```
      run tasks ──▶ traces ──▶ end-of-task encoding (outcome, lessons)
          ▲                                 │
          │                                 ▼
   retrieval at task start ◀── consolidation (nightly):
   (lessons, skills, warnings)   dedupe → extract lessons →
                                 promote facts → distill skills
```

Every production agent should have at least this. It is L1+L2, costs one nightly job, and compounds.

### 21.2 The skill-library architecture (Voyager pattern)

The landmark demonstration (Voyager, in Minecraft, 2023) generalizes far beyond games. Three interacting components:

1. **Automatic curriculum:** propose the next task at the frontier of current ability — hard enough to learn from, easy enough to have a chance. (In applied settings: the backlog, ordered by "adjacent to what the agent already does well.")
2. **Iterative-refinement executor:** attempt the task; use environment feedback (errors, test results) to refine over several rounds — a grounded reflection loop (§16.5).
3. **Skill library:** on *verified* success, distill the working procedure into a named, retrievable skill. Future tasks retrieve relevant skills, so ability *composes* — complex skills are built from calls to simpler ones.

The pattern's essence: **exploration + verification + distillation + retrieval = compounding capability without touching weights.** Its load-bearing wall is verification — the skill library is only as trustworthy as the success test that gates admission.

### 21.3 Self-refinement pipelines

For quality-critical outputs, a standing architecture rather than a per-task trick: generator → grounded critic (checks against rubric/tests/sources) → reviser, with (a) critiques *stored* and consolidated ("the generator repeatedly forgets edge-case X" → becomes a system-prompt line or skill note — L1 feeding L3), and (b) accepted final outputs archived as few-shot exemplars and SFT candidates. The pipeline that fixes today's output also, as a side effect, manufactures tomorrow's training signal.

### 21.4 Online vs. batch learning cadence

- **Within-task (online, instant):** failure records steering the loop (§17.2); in-context lessons. Zero risk — nothing persists without passing write-path gates.
- **Between-tasks (nightly/weekly, batch):** consolidation, skill distillation, prompt optimization runs, tool proposals — each gated by evals and (for L2–L4) human review.
- **Periodic (monthly+):** fine-tuning cycles on curated data; major harness revisions.

The gating discipline is the point: fast loops are low-risk and ungated; slow loops are high-impact and heavily gated. Never let a fast loop write to a slow loop's assets without passing through the gates.

---

## Chapter 22: Guardrails Against Drift and Degradation

### 22.1 Why self-improving systems need brakes

Any system that modifies itself can modify itself *badly* — and worse, gradually, so no single change trips an alarm. The failure taxonomy:

- **Objective drift:** successive optimizations each shift behavior slightly off the true goal (toward what the eval measures, what the judge prefers, what users click) until the system is excellent at the wrong thing.
- **Knowledge corruption:** poisoned memory (§13.5) or a wrong skill propagating through consolidation into everything downstream.
- **Capability regression:** an optimization improves the target metric while silently breaking untargeted behaviors (the ML analogue of a refactor with no test coverage).
- **Feedback collapse:** the system increasingly trains on its own outputs (its text in memory, its outputs rated by its judges), amplifying its own biases each cycle.

### 22.2 The guardrail set

1. **Immutable baseline + canary evals:** a frozen broad eval suite that no optimization is allowed to target, run on every change. Targetable evals measure progress; untargetable evals detect collateral damage.
2. **Human gates at persistence boundaries:** anything entering the durable layers — semantic facts (auto with verification), skills, prompts, tools (human-reviewed diffs), weights (full eval + staged rollout) — passes a gate proportional to its blast radius and half-life.
3. **Versioning and instant rollback for every learned asset:** prompts, skills, memory snapshots, model checkpoints. "Undo the last week of learning" should be one command.
4. **Provenance on everything learned:** every fact, lesson, and skill links to the episodes and traces that justify it. When something is wrong, provenance turns "purge and hope" into "trace and fix."
5. **Data hygiene against feedback collapse:** tag self-generated content; cap its fraction in any training/consolidation batch; never let judge models train on their own approvals.
6. **Drift monitoring:** longitudinal dashboards — eval distributions over time, behavioral fingerprints (tool-use rates, response lengths, refusal rates), disagreement rate between judge and human calibration labels. Drift announces itself in trends, not incidents.
7. **A kill-switch for learning:** the ability to freeze all persistence (run in "no-learn" mode) while investigating anomalies — the agent equivalent of halting deploys during an incident.

### 22.3 The maturity path

A sane adoption sequence, each stage earning the next:

1. **Static agent + traces** (you're collecting the dataset without knowing it yet).
2. **+ Memory & lessons** (L1) — the killer test of §14.2 passes.
3. **+ Reviewed skill distillation** (L2) — the library grows; per-skill evals exist.
4. **+ Eval suite → prompt/tool optimization** (L3–L4) — held-out splits, diff review, canaries.
5. **+ Fine-tuning on curated trajectories** (L5) — staged rollouts, immutable baselines.

Each stage's infrastructure (traces → memory → evals → curation) is the prerequisite of the next. Teams that jump straight to L5 without the eval and provenance layers are training a system they cannot see, steer, or roll back.

---

# PART 7 — PUTTING IT ALL TOGETHER

## Chapter 23: The Full Reference Architecture

### 23.1 The complete system

Everything from Parts 2–6, assembled:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          LEARNING PLANE (offline)                      │
│                                                                        │
│  TRACE STORE ──▶ CONSOLIDATION ──▶ lessons → EPISODIC/SEMANTIC MEMORY │
│      │                jobs      ──▶ skill drafts → [review] → SKILLS   │
│      │                          ──▶ failure analysis → prompt/tool     │
│      ▼                                proposals → [review] → merge     │
│  EVAL SUITE ◀── new cases from failures                                │
│  (dev + held-out + immutable canary)  gates every change ──────────┐   │
└────────────────────────────────────────────────────────────────────┼───┘
                                                                     │
┌────────────────────────────────────────────────────────────────────┼───┐
│                          RUNTIME PLANE (online)                    ▼   │
│                                                                        │
│   task in ──▶ MEMORY ROUTER ──▶ CONTEXT ASSEMBLER ◀── SKILL LIBRARY    │
│               (episodic ·        (§10.1: layered,                      │
│                semantic ·         budgeted, cached                     │
│                procedural)        prefix)                              │
│                                        │                               │
│                                        ▼                               │
│                    ┌──────────  AGENT LOOP  ──────────┐                │
│                    │  perceive → plan → act → observe │                │
│                    │       ↑        → reflect ↓       │                │
│                    │  LoopState · budgets · watchdogs │                │
│                    │  checkpoints · sub-agent spawns  │                │
│                    └───────────────┬──────────────────┘                │
│                                    │ tool calls                        │
│                                    ▼                                   │
│                    ┌──────────  HARNESS  ─────────────┐                │
│                    │ dispatcher → policy/gates →      │                │
│                    │ executors → sandbox → result     │                │
│                    │ processing → provenance tags     │                │
│                    └───────────────┬──────────────────┘                │
│                                    │                                   │
│              every step ──▶ TRACE STORE (shared with learning plane)   │
│              end of task ──▶ episodic write (encode → verify → store)  │
└────────────────────────────────────────────────────────────────────────┘
```

Note the shape: **two planes sharing two assets.** The runtime plane executes tasks; the learning plane digests what happened and upgrades the runtime's components. The trace store is the artery from runtime to learning; memory + skills + prompts are the arteries back. Every improvement flowing back passes through eval gates.

### 23.2 The data contracts that hold it together

Five artifacts, defined once, used everywhere — get these schemas right early, because everything integrates through them:

1. **The trace** (per step): context hash, model output, tool calls + results, costs, timestamps. Consumed by: debugging, evals, consolidation, fine-tuning curation.
2. **The task frame:** goal, constraints, acceptance criteria, budgets. Consumed by: context assembler, reflect phase, termination checks, eval scoring.
3. **The episodic record** (§13.1): the encoded end-of-task summary with `lesson`, entities, provenance, confidence. Consumed by: retrieval, consolidation.
4. **The skill** (§19.3): name, trigger description, instructions, version, eval results. Consumed by: skill matching/loading, review workflow.
5. **The eval case:** input, scoring method (verifiable | rubric | human), split membership. Consumed by: every gate in the system.

---

## Chapter 24: The Build Roadmap

### 24.1 Stage 1 — MVP agent (weeks 1–2)

**Goal:** one task type, done reliably end-to-end.

- Model + ReAct loop (§16.3) with hard budgets and graceful budget-death.
- Five tools max (§6.3 tip 1), written like documentation, with structured errors and output caps.
- Sandbox from day one (scratch dir, no default network, creds server-side).
- Context: system prompt at the right altitude (§8.1) + task frame + history. No memory yet, no compaction (keep tasks short instead).
- **Tracing from the first run.** Non-negotiable — every later stage feeds on traces.
- 10–20 eval cases with the strongest scoring you can get (prefer verifiable).

*Exit criterion:* ≥ 80–90% pass on the eval set; you have read at least 20 full traces yourself.

### 24.2 Stage 2 — Production agent (weeks 3–8)

**Goal:** longer tasks, more task types, safe autonomy, operational maturity.

- Harness: policy layer with effect classes, HITL approve-by-class gates, idempotent writes, rollback (checkpoint-before-mutation).
- Context: assembler as a function (§10.1), compaction (§8.4), notes-file scratchpad (§8.6), sub-agents where exploration is deep (§8.5).
- Loop: plan-and-execute for long tasks (§16.4), grounded reflection (§16.5), degenerate-loop watchdogs (§17.2), checkpointing + resumption (§18).
- Memory: file-based first (§14.2 tip 1) — profile, project notes, authored skills. End-of-task episodic writes begin (into files or a simple table).
- Evals grow from production failures; run on every prompt/tool change.

*Exit criterion:* multi-hour tasks complete or fail *gracefully*; a new task type can be added in days; on-call can diagnose any failure from traces alone.

### 24.3 Stage 3 — Self-improving agent (months 2+)

**Goal:** the system gets better without proportional human effort.

- Memory: vector-indexed episodic store, consolidation jobs, retrieval at task start. Pass the killer test (§14.2 tip 5).
- Learning: L1 lessons flowing automatically; L2 skill distillation with human review; L3 prompt optimization against held-out evals; L4 tool proposals from failure analysis.
- Guardrails: immutable canary suite, versioned learned assets with rollback, provenance, drift dashboards, learning kill-switch (§22.2).
- Optionally L5: curate trajectories continuously; fine-tune a smaller model for the routine workload tail.

*Exit criterion:* month-over-month eval improvement with flat human input; every learned asset traceable and reversible.

---

## Chapter 25: Evaluation and Observability Strategy

The subsystems were covered in place (§5.6, §20.2); this is the unified strategy.

**Three layers of measurement, three audiences:**

| Layer | Question | Instruments | Audience |
|---|---|---|---|
| **Step** | Did this call/tool behave? | Traces, tool error rates, token/latency per step | Engineers debugging |
| **Task** | Did the work succeed, at what cost? | Eval pass rates, goal-test outcomes, cost per completed task, human-edit distance on outputs | Team steering the product |
| **System** | Is it getting better and staying safe? | Longitudinal eval distributions, drift fingerprints, canary suite, judge-vs-human calibration | Owners of the learning loops |

**The operating rhythm that makes it real:**

- *Per change:* eval suite green (dev + held-out + canary) before merge — for prompts, tools, skills, and model versions alike.
- *Daily:* cost and error-rate anomaly alerts; failed-task triage → each interesting failure becomes an eval case.
- *Weekly:* read raw traces (sampled + worst-of) as a team ritual. Nothing replaces this. Every discipline in this document was discoverable by someone reading a trace and asking "why did it do *that*?"
- *Monthly:* drift review — distributions, fingerprints, calibration; prune stale skills, memories, and eval cases.

**One metric to rule them:** *cost per successfully completed task, at a fixed quality bar* — it unifies reliability (failures raise it), efficiency (waste raises it), and learning (it should fall over time).

---

## Chapter 26: Common Pitfalls Checklist and Further Reading

### 26.1 The pitfalls checklist

**Architecture**
- ☐ Built an agent where a workflow would do (autonomy without need).
- ☐ Multi-agent complexity without context-isolation or permission-separation justification.
- ☐ State hidden inside the model's transcript instead of explicit `LoopState` + notes.

**Harness**
- ☐ Tool descriptions written for machines, not for a bright new hire.
- ☐ Unbounded tool outputs flooding context.
- ☐ Errors that say "error" (no cause, no suggestion).
- ☐ Prompt-level "safety" with no policy-layer enforcement behind it.
- ☐ No trace/replay — debugging by anecdote.

**Context**
- ☐ Raw dumps "to be safe"; retrieval top-k set high "for coverage."
- ☐ Compaction as truncation; old plans never superseded (clash).
- ☐ Instructions buried above long documents; cache-hostile mid-context edits.

**Memory**
- ☐ Store-everything capture; retrieve-always reads.
- ☐ Encoding deferred to read time (unresolvable pronouns, no provenance).
- ☐ No forgetting → landfill; no verification → poisoning.
- ☐ Memory invisible to users and developers.

**Loop**
- ☐ No goal test; termination by vibes.
- ☐ No watchdogs for retry/oscillation/stall/drift.
- ☐ No checkpointing — budget death loses hours of work.
- ☐ Heavyweight loop ceremony applied to trivial tasks.

**Learning**
- ☐ Optimizing on the eval set you inspect (no held-out split).
- ☐ Self-generated content untagged → feedback collapse.
- ☐ Learned assets unversioned → no rollback of beliefs.
- ☐ Jumping to fine-tuning before traces, memory, and evals exist.

### 26.2 Further reading

Search for these by name — each anchors one part of this document:

- **Anthropic engineering essays:** *Building Effective Agents*; *Effective Context Engineering for AI Agents*; *Writing Tools for Agents*; *Building Agents with the Claude Agent SDK* — the harness/context/pattern canon this document draws on heavily.
- **ReAct: Synergizing Reasoning and Acting in Language Models** (Yao et al.) — the foundational loop.
- **Reflexion** (Shinn et al.) — verbal reinforcement / reflection loops.
- **Voyager: An Open-Ended Embodied Agent with LLMs** (Wang et al.) — the skill-library architecture.
- **Generative Agents** (Park et al.) — the memory-stream + reflection + retrieval scoring (relevance × recency × importance) design.
- **MemGPT / Letta** — OS-style memory hierarchy (main context vs. external storage) for LLMs.
- **Lost in the Middle** (Liu et al.) — position effects in long contexts.
- **Constitutional AI / RLAIF** (Bai et al.) and **DPO** (Rafailov et al.) — the weight-level learning signal landscape.
- **DSPy** — programmatic prompt/pipeline optimization (L3 in practice).

### 26.3 Closing: the compounding system

One final synthesis. Each discipline, alone, is an optimization. Together, they form a flywheel:

> A good **harness** produces clean actions and honest results → good **context** turns those into sound per-step decisions → a good **loop** chains sound steps into completed tasks and arrests errors early → good **memory** ensures each task starts smarter than the last → **learning** turns accumulated memory and traces into better prompts, skills, and tools → which make the harness, context, and loop better still.

Systems built this way don't just work — they *compound*. And systems missing a discipline leak at exactly that layer: great model, no harness → impressive demos, no reliability; great loop, no memory → permanent amnesia; great learning, no guardrails → confident drift.

You now have the complete picture. Build stage 1, read your traces, and climb.

---

*End of document.*
