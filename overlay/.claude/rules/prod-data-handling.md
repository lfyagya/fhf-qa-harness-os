---
paths:
  - "front-end-automation-smoke/**"
  - "fhf-backend-automation/tests/smoke/**"
---
# Production Data Handling — Artifacts Are Layout Evidence, Not Data Sources

The smoke lane runs against **live production**. Every failure screenshot, mochawesome report,
and downloaded file contains real customer records: names, VINs, loan numbers, invoice numbers,
dealer names, balances. "No PII" in test **inputs** says nothing about **outputs**, and outputs
are where the real exposure is.

Production artifact locations:

- `front-end-automation-smoke/CypressFHF/fhf-dashboards/cypress/{screenshots,videos,downloads}/`
- `front-end-automation-smoke/CypressFHF/fhf-dashboards/reports/`
- `front-end-automation-smoke/reports/`
- anything produced by `fhf-backend-automation/tests/smoke/` (Allure results, JUnit, logs, query
  results)

## Rule

1. **Default deny.** Read access to the artifact paths above is denied by `.claude/settings.json`
   permissions. The owner can grant it explicitly for one session. Never work around the deny
   (another tool, a shell `cat`, a copy to another path).
2. **Images are for UI, not for data.** When access *is* granted, a screenshot is evidence about
   layout and component state — is the panel open, is the control disabled, which month is the
   calendar on. Never read, transcribe, quote, tabulate, or summarise the customer records visible
   in it. Describe the widget, not the row.
3. **Never carry data into durable output.** No customer values in commit messages, PR
   descriptions, Jira comments, `.planning/` files, docs, memory files, or scratch notes. Cite the
   artifact path and the component; never the record.
4. **Prefer the data-free evidence source.** Most triage never needs the artifact:
   - `reports/junit/*.xml` — test names and timings only.
   - Cypress Cloud MCP or CLI run/spec/test metadata — error messages and stack traces, no row data.
   - The terminal run log.
   Reach for a screenshot only when the question is genuinely visual, and say why.
5. **Asserting on data is already forbidden** — smoke asserts structure and availability, never
   specific values. A test that needs a customer's name to pass is the wrong test.
6. **Backend smoke is production too.** `fhf-backend-automation/tests/smoke/` runs against the
   production API and Oracle, so every rule above applies to its evidence: a query result set, an
   API response body, and an Allure attachment are production data exactly as a screenshot is.
   Assert row counts, status codes, schema shape and column presence — never the values in a row.
   Do not paste a result set into a ticket, a docstring, a fixture, or `data_files/`. Backend smoke
   is GET-only by convention (no automated guard checks the method) — keep it that way. Treat
   `allure-results/` from a smoke run as production data.
7. **Cypress Cloud on smoke is metadata-only.** Do not run `cy-cloud replay info`,
   `replay timeline`, or `test get --screenshot` for smoke runs: replay downloads DOM, network, and
   console data; the screenshot is the production frame. `--help` and `--schema` are safe. E2E
   (Dev/QA) replays are fine.

## Live prod browsing — same rule, and mask BEFORE you screenshot

Browser tools put the same customer records into context as artifacts do. Treat live browsing of
production as needing the same explicit owner opt-in, and mask before any screenshot.

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

- **Substring match, not an exact column list.** One ruleset covers dashboards, detail panels and
  modals, and keeps working when a new column ships following the naming convention.
- **CSS, not a JS walk.** A stylesheet applies to nodes rendered later, so sort, filter and
  pagination re-renders stay covered. A one-shot JS pass silently stops protecting new rows.
- **Blur, not solid redaction.** Blur preserves presence-vs-empty and text length, both diagnostic.

**Known limitation:** this relies on `data-cy` naming discipline. A field with no hook, or an
off-convention name, is **not** masked and would leak silently. On any page whose hooks have not
been checked, add a regex sweep for email/phone/SSN shapes (accepting that it does not auto-cover
re-renders) or do not screenshot at all.

**Open calibration questions** (owner's call): employee usernames such as the Collector column are
personal data but not customer PII and are often needed for diagnosis; per-account timestamps like
Last Call Attempt are behavioural; `Days Delinquent` is caught by the `delinquent` token and may be
worth loosening when verifying delinquency logic.

## Egress is still open — do not treat this rule as covering it

This rule closes **ingest** (an agent reading prod artifacts). Egress, verified open 2026-07-27:

| Path | Where | Status |
|---|---|---|
| Failure screenshots base64-inlined into HTML reports | `cypress.config.js` `embeddedScreenshots: true`, `inlineAssets: true` | **OPEN** |
| Screenshots + reports uploaded as CI artifacts (→ S3) | `buildspec.yml` `artifacts:` block | **OPEN** |
| Reports emailed post-build | `buildspec.yml` post_build (SES/nodemailer) | **OPEN** |
| Full prod DOM snapshots sent to Cypress Cloud Test Replay | every `cy:run:record*` script | **OPEN** |
| Screenshots/reports committed to git | `.gitignore` `**/screenshots`, `**/reports` | closed |
| Video capture | `cypress.config.js` `video: false` | closed |

Those four are a separate owner decision. Candidate fixes when picked up:
`embeddedScreenshots: false` + `inlineAssets: false`; drop `cypress/screenshots/**` from the
`artifacts:` list; blackout data regions via `cy.screenshot({ blackout: [...] })` using the
existing `COMMON_UI` table/detail selectors.

## Evidence this rule exists

2026-07-27, SERV-11786 triage: a Loss Mitigation Auction Invoice failure screenshot was read to
determine whether a filter panel was open (it was closed — which root-caused
`closeFilterIfVisible`'s `offsetParent` bug). The diagnosis was correct and the image was the right
evidence, but the frame also carried ~25 rows of live customer names, VINs, loan numbers and
invoice numbers straight into model context. Nothing gated `Read`. The owner caught it by asking
what was actually enforced, rather than assuming the "no PII" line covered it.
