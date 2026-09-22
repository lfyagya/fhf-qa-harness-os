# FHF Repository Routing

Use this page to select the smallest source set for a QA task. It is a view of
`config/qa-control-plane.json` (`productTopology`, `sourceBundles`, and runners), not a second
catalog and not a permission grant.

## Configuration map

```mermaid
mindmap
  root((FHF QA harness))
    Context engineering
      approved product contract
      selected repository paths
      bounded task context
    Tool orchestration
      manifest-selected runners
      E2E and backend automation
      production Smoke isolation
    Verification loops
      exact assertions
      native artifacts
      bounded repair or block
    Execution envelope
      task wall-clock ceiling
      recorded tool-result ceiling
      retryable-failure ceiling
    Evidence and learning
      trace and JUnit artifacts
      evidence-bound verdict
      reviewed improvement only
```

The map uses a small, verifiable task map and real execution feedback instead of a large static
instruction set or an unbounded agent loop. FHF applies that approach through existing contracts,
manifests, native artifacts, and fail-closed guards.

## Configure in this order

```mermaid
flowchart TB
  C1["1. Product contract<br/>WHAT: approved rule and scenarios<br/>WHY: do not invent expected behavior<br/>HOW: validate the selected spec"]
  C2["2. Source route<br/>WHAT: smallest declared repository bundle<br/>WHY: relevant context without preload noise<br/>HOW: expand one evidenced hop only"]
  C3["3. Capability loop + task manifest<br/>WHAT: frozen paths, SHAs, tests, impact, budget, selected capabilities<br/>WHY: approval cannot silently drift or assume tool access<br/>HOW: probe each required capability; validate digest; human approves current plan"]
  C4["4. Automation design<br/>WHAT: frontend, API/Oracle, and/or Smoke coverage<br/>WHY: assertions trace to the contract<br/>HOW: select configured runner and exact test path"]
  C5["5. Execution gate<br/>WHAT: lane, environment, credentials, reachability<br/>WHY: setup failures are not product evidence<br/>HOW: preflight; block if unavailable"]
  C6["6. Native proof<br/>WHAT: runner artifact and evidence-bound verdict<br/>WHY: static checks do not prove runtime behavior<br/>HOW: bind artifact to path, SHA, environment, result"]
  C7["7. Improvement decision<br/>WHAT: repair, escalate, or complete<br/>WHY: avoid uncontrolled retries and false passes<br/>HOW: use bounded trace; review policy changes"]

  C1 --> C2 --> C3 --> C4 --> C5 --> C6 --> C7
  C1 -. contract not approved .-> Stop1([BLOCK: obtain product approval])
  C3 -. digest or source changed .-> Stop2([BLOCK: refresh human approval])
  C5 -. environment unavailable .-> Stop3([BLOCK: record setup evidence])
  C6 -. no valid artifact .-> Stop4([BLOCK: no pass claim])
```

| Configuration step | Canonical location |
|---|---|
| Product contract and scenarios | `Test-Case-Automation-Using-Claude-Agents/specs` |
| Repository graph and source bundles | `productTopology` in `config/qa-control-plane.json` |
| Task freeze, approval, and budget | `engineering.taskProtocol` + `.harness/task-protocol.mjs` |
| Runner choice and proof mode | `engineering.executionRunners` |
| Guardrails and bounded repair | `engineering.harness` + `engineering.loops` |
| Consumer projection and drift verification | `loader-templates.mjs`, `sync-loader-shims.mjs`, `check-loader-drift.mjs` |

## Capability loop

Each task selects only the capabilities it needs. Every selected capability is an explicit
`plan.capabilities` record with its subject and observed readiness evidence. A configured connector is
only a declaration—not proof that Jira, Figma, Cypress Cloud, or TestRail can be used.

```mermaid
flowchart TB
  T[Task intent + selected runner] --> S[Select only required capabilities]
  S --> P[Probe source, ticket, design, runner, environment, backend, reporting as applicable]
  P --> Q{Observed result?}
  Q -->|ready| R[Record readiness reference in task manifest]
  Q -->|auth / authorization / invalid input| A[Request the exact safe access or corrected reference]
  Q -->|unavailable| B{Retry budget left?}
  B -->|yes| P
  B -->|no| E[Escalate with recorded blocker]
  Q -->|approved fallback| F[Record fallback and its limitation]
  R --> G{All selected capabilities ready?}
  F --> G
  G -->|yes| H[Plan, approve, execute, collect native proof]
  G -->|no| I[BLOCK or UNKNOWN: no coverage/pass claim]
```

| Capability | Selected when | Ready proof | If not ready |
|---|---|---|---|
| `source-grounding` | Every coverage claim | Approved contract and exact source at frozen revision | Block; do not infer behavior |
| `jira-ticket-read` | Ticket-grounded work | Active client reads selected ticket | OAuth/permission request or sanitized export |
| `figma-design-read` | Visual/design acceptance | Selected Figma reference or approved versioned export | Block visual assertion as UNKNOWN |
| `cypress-cli` | E2E or Smoke execution | Profile, runtime, and base-URL preflight | Repair local setup; no browser-pass claim |
| `cypress-cloud-diagnostics` | Cloud replay/triage | Read-only run metadata | Use JUnit/Mochawesome only when Cloud is not task-required |
| `execution-environment` | Any executable runner | Runner-specific preflight | Request permitted access or record setup block |
| `backend-api-oracle` | API/Oracle proof | Manifest-bound Dev/QA backend preflight | Mark backend evidence UNKNOWN |
| `testrail-read-report` | Case lookup or requested reporting | Selected TestRail target read | Use native artifacts only if TestRail is not task-required; uploads need approval |

## Ticket walkthrough: `SERV-11887`

This is a dry-run example only. The ticket body has not been read, no manifest is created, and no
source, automation, Jira, or environment is changed.

```mermaid
flowchart LR
  Start[Ticket key] --> Probe[Live Jira read probe]
  Probe -->|readable| Ready[READY: retrieve selected fields and ground manifest]
  Probe -->|authentication required| Auth[Connect or reauthenticate OAuth]
  Probe -->|authorization required| Perm[Request Jira Browse/Read]
  Probe -->|ticket not found| Key[Confirm key or supply sanitized export]
  Probe -->|transport unavailable| Retry{Retry budget left?}
  Retry -->|yes, max 2| Probe
  Retry -->|no| Escalate[ESCALATE: owner support or sanitized export]
  Auth --> Probe
  Perm --> Probe
  Key --> Probe
```

The access doctor records only the outcome category, attempt count, and timestamp in ignored local
runtime state. It never stores a ticket body, credentials, cookies, token, or OAuth code. A configured
connector is still `BLOCKED` until a live read is recorded; the loop determines the next required input.

```mermaid
flowchart TB
  Start["Input: SERV-11887 link"] --> Jira{Jira connection\nand ticket fields available?}
  Jira -- no --> JiraBlock["JIRA ACCESS REQUIRED\nAsk active AI client for OAuth Jira Browse/Read\nor provide a sanitized ticket export\nDo not guess summary, acceptance criteria, links, or owner"]
  Jira -- yes --> Ground["Read selected fields only\nkey, summary, acceptance criteria, links, module"]
  Ground --> Contract{Approved product\ncontract mapped?}
  Contract -- no --> ContractBlock["BLOCK\nPropose or obtain contract approval\nDo not generate a correctness claim"]
  Contract -- yes --> Route["Select one source bundle\ncontracts + only the required repositories"]
  Route --> Source{Exact source path,\nendpoint, or Oracle object found?}
  Source -- no --> SourceBlock["BLOCK / UNKNOWN\nRecord missing traceability\nDo not invent a test target"]
  Source -- yes --> Manifest["Create task manifest\nfreeze ticket digest, paths, SHAs, impact, runner, budget"]
  Manifest --> Approval{Human approval\ncurrent?}
  Approval -- no --> ApprovalBlock["BLOCK\nAwait or refresh approval"]
  Approval -- yes --> Coverage["Plan exact coverage\nunit/service, API/Oracle, E2E, Smoke as applicable"]
  Coverage --> Ready{Selected lane\nready?}
  Ready -- no --> ReadyBlock["BLOCK\nRecord auth, dependency, branch, base-URL, or data prerequisite"]
  Ready -- yes --> Execute["Run only selected tests\nE2E Dev/QA; Smoke Production GET-only"]
  Execute --> Artifact{Native artifact\nbound to plan?}
  Artifact -- no --> EvidenceBlock["BLOCK\nNo pass or coverage claim"]
  Artifact -- yes --> Verdict["Evidence-bound verdict\ncomplete, repair within budget, or escalate"]
```

### What happens at each yes path

| Decision | If yes | If no |
|---|---|---|
| Jira ticket readable | Freeze only relevant ticket facts and links | Run `node .harness/capability-doctor.mjs --capability jira-ticket-read --subject SERV-11887`; connect OAuth Jira Browse/Read in the active AI client or provide a sanitized export. Never provide a credential to the harness. |
| Approved contract mapped | Use its rules as the expected behavior | Stop before test design; contract approval is missing |
| Source trace found | Select exact implementation and automation paths | Record a traceability gap; do not create a speculative test |
| Current human approval | Permit planned automation work only | Manifest is blocked or requires refreshed approval |
| Lane preflight passes | Run the exact selected test command | Record environment/setup evidence, not a product failure |
| Native artifact validates | Attach it to the manifest and issue verdict | No pass, coverage, or release-confidence claim |

In the recipe analogy: the ticket is the order, the approved product contract is the recipe, source
paths are the ingredients, the manifest is the measured prep list, runners are the kitchens, and a
native artifact is the finished dish inspection. If any required ingredient is missing, FHF stops and
labels the result `BLOCKED` or `UNKNOWN`; it does not substitute a guess.

### What this configuration can do

```mermaid
flowchart LR
  Ticket[Grounded ticket or question] --> Kind{Intent}
  Kind --> PQ[Product question]
  Kind --> FE[Frontend change]
  Kind --> BE[Backend/API or Oracle change]
  Kind --> FS[Full-stack change]
  Kind --> SM[Production health question]

  PQ --> PQOut[Source-grounded answer\ncontract + UI, no execution claim]
  FE --> FEOut[Plan UI/unit + Dev/QA E2E\nassess Smoke impact]
  BE --> BEOut[Plan API/Oracle coverage\nwith selected backend automation]
  FS --> FSOut[One manifest across contract, UI, API, E2E\nthen add only evidenced dependencies]
  SM --> SMOut[GET-only Smoke diagnosis\nnative production artifacts]
```

The configuration routes and guards the work. It does not create product requirements, fabricate
source mappings, supply credentials, make a lane reachable, approve the plan, or turn a setup
failure into application-quality evidence.

```mermaid
flowchart LR
  Contract[Product contracts\nTest-Case-Automation-Using-Claude-Agents] --> UI[Browser UI\nfhf-dashboards]
  UI --> Internal[API entry\nfhf-rest-internal]
  Internal --> Service[Business service\nfhf-rest-service]
  Internal --> External[External integration\nfhf-rest-external]
  Service --> External
  Service --> Oracle[Oracle / ORDS source\nfhf_documents]

  E2E[E2E: Dev/QA\nfront-end-automation-e2e] -. native Cypress evidence .-> UI
  Smoke[Smoke: Production GET-only\nfront-end-automation-smoke] -. native Cypress evidence .-> UI
  APIQA[API + Oracle QA
fhf-backend-automation] -. native API / DB evidence .-> Internal
```

Cypress owns the browser behavior of `fhf-dashboards`: the screen, its route, and the UI call that screen makes. Pytest owns the REST, service, Oracle, and Python workflow gap that the Cypress spec for the sprint task does not already assert. `qualityAssurance.coverageBoundary` is that split. The sprint task picks the path. A missing manifest asks for the SERV ticket, module, and the remainder. A backend write or pytest waits until the task records the selected non-production path.

## Selection rule

```mermaid
flowchart TD
  Task[Ticket or product question] --> Bundle[Choose one source bundle]
  Bundle --> Seeds[Read its seed repositories]
  Seeds --> Evidence{Exact call, endpoint, Oracle\nobject, link, or QA impact?}
  Evidence -- yes --> Expand[Add one declared topology hop\nand record why]
  Evidence -- no --> Plan[Freeze selected paths and SHAs]
  Expand --> Plan
  Plan --> Proof[Choose the native runner and evidence]
```

Never preload the catalog, expand solely because a repository looks related, or treat the catalog
as authority for product behavior. Product contracts, source, and native artifacts remain the
authority for intent, implementation, and execution respectively.

## Source bundles

| Task type | Start with | Expand only for |
|---|---|---|
| Product question | Contracts, dashboard UI | matched route, endpoint, Oracle object |
| Frontend change | Contracts, UI, E2E | API call, regression, Smoke impact |
| Backend/API change | Internal API, service, backend QA | third-party call, Oracle contract, UI consumer |
| Full-stack change | Contracts, UI, internal API, E2E | service call, backend coverage, Smoke impact |
| Oracle change | Service, Oracle source, backend QA | API entry or UI consumer |
| Letters workflow | Letters, Python utilities, backend QA | API entry or Oracle contract |
| Repossession workflow | Repossession, Python utilities, backend QA | integration, Oracle contract, UI consumer |
| Agent workflow | Service agents, LLM proof of concept | ORDS contract; template only for structure |

## Catalog

| Repository | Route when the task concerns | First source paths | Evidence / boundary |
|---|---|---|---|
| `Test-Case-Automation-Using-Claude-Agents` | approved product behavior and scenarios | `specs`, `governance`, `scripts/validate-specs.js` | approved spec + validation |
| `fhf-dashboards` | browser UI, routes, UI API calls | `src`, `src/constants/routes.js` | live source; application source read-only |
| `fhf-rest-internal` | authenticated API entry or request routing | `src/main`, `src/test`, `pom.xml` | Java source and tests |
| `fhf-rest-service` | business API, persistence, callbacks | `src/main`, `src/test`, `pom.xml` | Java source and tests |
| `fhf-rest-external` | third-party gateway or external contracts | `src/main`, `src/test`, `pom.xml` | Java source and tests |
| `fhf_documents` | Oracle schemas, ORDS, SQL contracts | `git:HEAD:oracle_firsthelp`, `git:HEAD:tsp` | Git-object inspection on Windows; never execute DDL/DML |
| `fhf-letters` | letter generation or delivery | `main.py`, `generation`, `delivery`, `tests` | Python source and tests |
| `fhf-reposession` | repossession, remarketing, SCRA | `main.py`, `autoims`, `rdn`, `recon`, `scra`, `tests` | Python source and tests |
| `fhf-python-utils` | shared Python domain/data utilities | `commons`, `dao`, `db`, `handler`, `tests` | Python source and tests |
| `fhf-summer-2016` | legacy behavior | `READFIRST.md`, `Django`, `Java`, `Jersey`, `Python` | select an exact subdirectory first |
| `fhf-llm-poc` | legacy AI/document workflow | `agents`, `feature`, `llm`, `processors`, `services`, `tests` | source and tests |
| `fhf-serv-agents` | agent orchestration, features, ORDS adapter | `orchestrator`, `agents`, `features`, `ords`, `tests` | Python source and tests |
| `fhf-serv-template` | agent-service structure only | `TEMPLATE_NEW_FEATURE.md`, `AGENTS_STRUCTURE.md`, `tests` | reference only; not a default runtime dependency |
| `oracle-instantclient-dependencies` | Oracle client build dependency | RPM inventory | infrastructure-only; no application behavior route |
| `fhf-backend-automation` | API, Oracle, backend regression verification | `api`, `db`, `tests`, `pytest.ini` | task-scoped only; native pytest/JUnit/Allure/API/DB evidence |
| `front-end-automation-e2e` | Dev/QA functional, regression, cross-layer UI proof | `CypressFHF/fhf-dashboards/cypress/tests/fhf-dashboard/e2e` | synthetic data, cleanup, native Cypress artifacts |
| `front-end-automation-smoke` | production availability, auth, structure | `CypressFHF/fhf-dashboards/cypress/tests/fhf-dashboard/smoke` | GET-only; native Cypress artifacts; no mutations |

`claude-obsidian` may exist in a local FHF checkout, but it is derived-only retrieval support. It is
outside the product topology, task manifests, runner selection, and execution evidence chain.

## Proof selection

```mermaid
flowchart LR
  Intent[Approved contract] --> Source[Selected implementation source]
  Source --> Automation[Selected automation path]
  Automation --> Native[Native runner artifact]
  Native --> Verdict[Evidence-bound verdict]

  Unit[Hermetic unit/service test] --> UnitProof[RED/GREEN or same-test baseline]
  Cypress[Cypress E2E or Smoke] --> CypressProof[External run artifacts]
  API[API / Oracle integration] --> APIProof[External API / DB artifacts]
```

E2E runs only in Dev/QA and may mutate synthetic owned data with cleanup. Smoke runs against
Production and is GET-only. Backend automation requires a current, approved `FHF_ACTIVE_TASK`
manifest and selected paths; it is not enabled by catalog membership alone.

## Design basis

- [OpenAI: Harness engineering](https://openai.com/index/harness-engineering/) — structured
  repository knowledge, agent legibility, and executable feedback loops.
- [Martin Fowler: Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html)
  — feedforward, feedback, and behavior-oriented harnesses.

These sources inform the harness shape. FHF product contracts, repository source, and native run
artifacts remain the authority for FHF-specific behavior and quality claims.
