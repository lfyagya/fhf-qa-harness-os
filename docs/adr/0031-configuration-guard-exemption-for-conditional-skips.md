# ADR-0031 — Configuration-Guard Exemption for Conditional Skips

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-15 |
| **Amends** | ADR-0027 decision 2 |

## Context

ADR-0027 decision 2 wired `checkFalseGreen()` to reject six false-green shapes, `this.skip()` among
them, under the single `qualityAssurance.falseGreen.fallbackMarkersAccepted` boolean. The reasoning
holds for five of them: an empty `catch`, `cy.on('fail')`, `.skip`, `xit` and `.only` have no
legitimate use in a spec that is meant to run.

A sweep of the E2E lane found seven `this.skip()` occurrences and separated them into two kinds.

Six guarded **absent data**. Each selected an existing invoice and skipped the whole context when
the environment had none, so Invoice Filters, Invoice Detail, Transaction Error and Regression
reported green having asserted nothing. That is precisely the shape ADR-0027 names, and none of the
six needed an exemption:

- Five are now seeded. `lmEnsureInvoiceRow` already existed in `loss-mitigation.commands.js` —
  a full seeder that creates an invoice, rotates loan candidates on a 422 and throws rather than
  skips — and had no callers. `cy.lmRequireInvoice(type)` wires it behind a select-first fast path.
- One could not be seeded. Transaction-failed invoices originate from a failed NLS transaction and
  have no dashboard create path. It now asserts that the Transaction Error tab is *disabled* when no
  failed invoices exist, which is the application's actual contract for that state. Both environment
  states are covered by an assertion; neither passes silently.

The seventh is a different kind. `cypress/tests/fhf-dashboard/e2e/auth/login.cy.js` skips its MFA
Security Question context when `mfaUsername` / `mfaPassword` / `oktaSecurityAnswer` are absent from
`cypress.env.json`. Nothing is missing from the application — the *test environment* lacks a
credential, and there is no seed path, because credentials are provisioned, not created.

The three ways to resolve it without a mechanism are all worse than the problem:

- Assert the credentials exist. Every machine and CI job that legitimately has no MFA credentials
  goes red, which trains people to ignore a red gate.
- Flip `fallbackMarkersAccepted` to `true`. That also disables the empty-`catch` and `cy.on('fail')`
  checks across every lane, to excuse one line.
- Delete the guard. Same red-everywhere cost as the first, and it discards the diagnostic message
  that tells a reader which env keys to set.

## Decision

`checkFalseGreen()` exempts a `this.skip()` occurrence that carries a reason in a comment on its own
line or the line immediately above:

```js
// harness-allow this.skip: <reason>
```

The exemption applies to `this.skip()` only. The other five shapes stay unconditionally rejected —
they have no configuration-guard analogue, so there is nothing to excuse.

The marker is a comment next to the code rather than a path list in configuration. A path list drifts
away from the file it excuses and is invisible at the point where someone is deciding whether to add
another skip; a comment cannot drift, and every use of it appears in the spec's own diff where review
already looks. It deliberately does not reach `config/qa-control-plane.json`, so granting an
exemption is not a protected-path edit and does not need `FHF_ALLOW_HARNESS_EDIT=1` — only changing
the *mechanism* does.

A bare `// harness-allow this.skip:` with no reason after the colon does not match. The regex
requires a non-space character, so the escape hatch cannot be used without saying why.

The lookback is exactly one line, so the marker must be the **last** comment line before
`this.skip()`. Any prose goes above it, not below. This is deliberate — a marker allowed to sit
several lines up can drift away from the skip it excuses, or end up excusing a different one — but
it is a sharp edge, and it drew blood on the first real use: a three-line justification put the
marker three lines up and the gate correctly rejected it. If it misfires repeatedly in practice, the
fix is to scan upward through *contiguous* comment lines (preserving the "must be attached" property)
rather than to widen the window by a fixed count.

## Consequences

The gate no longer blocks on `login.cy.js`, which is annotated with the env keys it guards.

This is an escape hatch, and escape hatches get used. The control is visibility rather than
prevention: each use costs a reason string in a reviewed diff, and `git grep "harness-allow
this.skip"` enumerates every one. If that count grows past a handful, the right response is to
audit them, not to widen the hatch.

No new configuration boolean. ADR-0027's pattern is policy declared in config and enforced in code,
and a `fallbackMarkerExemptionsAccepted` knob would fit it — but nothing has asked to revoke the
hatch wholesale, and a knob with one possible setting is dead weight. If revocation is ever wanted,
that boolean is the adjustment point.

What does not change: the other five false-green checks, `protectedPaths`, the assertion-count check,
and every gate outside `checkFalseGreen()`.
