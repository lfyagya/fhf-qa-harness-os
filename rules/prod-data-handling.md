---
paths:
  - "**/CypressFHF/fhf-dashboards/cypress/tests/fhf-dashboard/smoke/**"
  - "**/fhf-backend-automation/tests/smoke/**"
  - "docs/evidence/**"
---
# Production Data Handling — Artifacts Are Layout Evidence, Not Data Sources

The smoke lane runs against **live production**. Every failure screenshot, mochawesome
report, and downloaded file therefore contains real customer records: names, VINs, loan
numbers, invoice numbers, dealer names, balances. The existing "no PII" line in the smoke
`CLAUDE.md` governs test **inputs** (never hardcode PII into a spec). It says nothing about
**outputs**, and outputs are where the real exposure is.

## Rule

1. **Default deny.** Production artifacts are not read by an agent unless the owner
   explicitly opts in for that session. Enforced by `.claude/hooks/protect-prod-data.mjs`
   (`PreToolUse:Read|Bash`, exit 2).
2. **Opt-in is the owner's, via environment variable** — `FHF_ALLOW_PROD_DATA=1`, set when
   launching the session. Shell state does not persist between agent `Bash` calls, so an
   agent cannot grant itself access. That asymmetry is deliberate: a guard the agent can
   switch off is not a guard.
3. **Images are for UI, not for data.** When access *is* granted, a screenshot is evidence
   about layout and component state — is the panel open, is the control disabled, which
   month is the calendar on. Never read, transcribe, quote, tabulate, or summarise the
   customer records visible in it. Describe the widget, not the row.
4. **Never carry data into durable output.** No customer values in commit messages, PR
   descriptions, Jira comments, ADRs, `docs/`, memory files, or scratchpad triage notes.
   Cite the artifact path and the component; never the record.
5. **Prefer the data-free evidence source.** Most triage never needs the artifact at all:
   - `reports/junit/*.xml` — test names and timings only (explicitly allowed by the hook).
   - Cypress Cloud MCP or CLI run/spec/test metadata — error messages and stack traces, no row data.
   - The terminal run log.
   Reach for a screenshot only when the question is genuinely visual, and say why.
6. **Asserting on data is already forbidden** — smoke asserts structure and availability,
   never specific values. A test that needs a customer's name to pass is the wrong test.
7. **Backend smoke is production too.** `fhf-backend-automation/tests/smoke/` runs against the
   production API and Oracle, so every rule above applies unchanged to its evidence: a query
   result set, an API response body, and an Allure attachment are production data in exactly
   the way a screenshot is. Assert row counts, status codes, schema shape and column presence —
   never the values in a row. Do not paste a result set into a ticket, a docstring, a fixture,
   or `data_files/`.

   Two asymmetries to know about, because neither is enforced yet and both are easy to trip:
   - There is **no mutation guard on backend smoke.** `validate-backend-automation.mjs` checks
     raw asserts, `os.getenv` and direct HTTP, and says nothing about method. A `POST` written
     into `tests/smoke/` passes every gate, while the Cypress equivalent is blocked by
     `SMOKE_MUTATION_RE`. Verified 2026-09-16: all 110 files are clean, so the convention holds
     by discipline. Keep it that way — GET only.
   - `protect-prod-data.mjs` guards Cypress artifacts and Cloud CLI calls by path and command.
     It does not recognise pytest or Allure output, so nothing stops a backend run from writing
     production rows into `allure-results/`. Treat that directory as production data by hand.

The same guard blocks Cloud CLI `replay info`, `replay timeline`, and `test get --screenshot` in
smoke/root sessions. Replay downloads a local database containing DOM, network, and console data;
the screenshot contains the production frame. E2E remains full-read: prefix
`FHF_LANE=e2e` on the CLI command from the consumer root, or run from the E2E package cwd.
`--help` and `--schema` are safe because they do not fetch Cloud data.

## Live prod browsing — same rule, and mask BEFORE you screenshot

The hook covers artifacts on disk. It does **not** gate the browser MCP tools, which put the same
customer records into context just as directly. Treat live browsing of production as needing the
same explicit owner opt-in, and mask before any screenshot.

**Mask semantically by `data-cy` substring, in CSS — not by blurring regions.** Blurring a whole
`tbody` destroys exactly what you are inspecting: empty-vs-populated cells, badges, disabled
controls, alignment, row counts. Verified live 2026-07-27 — a whole-region blur yielded a
screenshot with no readable structure at all, while the ruleset below masked 859 sensitive
elements and left 60 header elements plus every status badge, state code and `-` empty marker
legible.

```js
// Paste into the page console / javascript_tool before screenshotting production.
(() => {
  const ID = 'qa-privacy-mask';
  document.getElementById(ID)?.remove();
  const SENSITIVE = [
    'app-id', 'application-id', 'loan-number', 'cyberridge', 'vin',
    'client', 'customer', 'name', 'borrower',
    'dob', 'date-of-birth', 'birth',
    'phone', 'email', 'ssn', 'social',
    'address', 'city', 'zip', 'postal',
    'balance', 'amount', 'delinquent', 'payment', 'payoff', 'income',
  ];
  // :not([data-cy*="head"]) keeps COLUMN HEADERS readable — without it you lose the structure
  // the screenshot exists to show.
  const selector = SENSITIVE.map((t) => `[data-cy*="${t}"]:not([data-cy*="head"])`).join(',');
  const s = document.createElement('style');
  s.id = ID;
  s.textContent = `${selector} { filter: blur(6px) !important; }`;
  document.head.appendChild(s);
  return document.querySelectorAll(selector).length + ' elements masked';
})()
```

Why each choice, so it is not "improved" back into uselessness:

- **Substring match, not an exact column list.** One ruleset then covers dashboards, detail panels
  and modals, and keeps working when a new column ships following the naming convention. An exact
  list goes stale — the same failure mode as the pinned master-data contracts in
  `failure-classification.md`.
- **CSS, not a JS walk.** A stylesheet automatically applies to nodes rendered later, so sort,
  filter and pagination re-renders stay covered. A one-shot JS pass silently stops protecting new
  rows — the most dangerous possible failure for a privacy control.
- **Blur, not solid redaction.** Blur preserves presence-vs-empty and text length, both of which
  are diagnostic signal; a solid block throws them away.

**Known limitation, state it rather than trust it:** this relies on `data-cy` naming discipline. A
field with no hook, or an off-convention name, is **not** masked and would leak silently. On any
page whose hooks have not been checked, either add a regex sweep for email/phone/SSN shapes
(accepting that it does not auto-cover re-renders) or do not screenshot at all.

**Open calibration questions** (owner's call, not the agent's): employee usernames such as the
Collector column are personal data but not customer PII and are often needed for diagnosis;
per-account timestamps like Last Call Attempt are behavioural; `Days Delinquent` is currently
caught by the `delinquent` token and may be worth loosening when verifying delinquency logic.

## What this rule does NOT cover — egress is still open

This rule closes **ingest** (an agent reading prod artifacts). It does not close **egress**,
which is the larger exposure and was verified open on 2026-07-27:

| Path | Where | Status |
|---|---|---|
| Failure screenshots base64-inlined into HTML reports | `cypress.config.js` `embeddedScreenshots: true`, `inlineAssets: true` | **OPEN** |
| Screenshots + reports uploaded as CI artifacts (→ S3) | `buildspec.yml` `artifacts:` block | **OPEN** |
| Reports emailed post-build | `buildspec.yml` post_build (SES/nodemailer) | **OPEN** |
| Full prod DOM snapshots sent to Cypress Cloud Test Replay | every `cy:run:record*` script | **OPEN** |
| Screenshots/reports committed to git | `.gitignore` `**/screenshots`, `**/reports` | closed |
| Video capture | `cypress.config.js` `video: false` | closed |

So one smoke failure still fans real customer data into an S3 artifact, an inlined HTML
report, an email, and a third-party service. Those four are a deliberate, separate decision
by the owner — do not treat this rule as evidence they are handled.

Candidate fixes when that work is picked up: `embeddedScreenshots: false` +
`inlineAssets: false`; drop `cypress/screenshots/**` from the `artifacts:` list; blackout
data regions via `cy.screenshot({ blackout: [...] })` using the existing `COMMON_UI`
table/detail selectors so future captures show layout without records.

## Evidence this rule exists

2026-07-27, during SERV-11786 post-refactor triage: a Loss Mitigation Auction Invoice
failure screenshot was read to determine whether a filter panel was open (it was closed —
which is what root-caused `closeFilterIfVisible`'s `offsetParent` bug). The diagnosis was
correct and the image was the right evidence, but the frame also carried ~25 rows of live
customer names, VINs, loan numbers and invoice numbers straight into model context. Nothing
prevented it: `settings.json` gated only `Edit|Write`, `Bash` and `Task`, leaving `Read`
entirely ungated, and no rule anywhere in `.claude/rules/` mentioned masking or redaction —
the only `mask` matches were the word used unrelatedly about aggregate metrics.

The owner caught it by asking what the harness actually enforced, rather than assuming the
"no PII" line covered it.
