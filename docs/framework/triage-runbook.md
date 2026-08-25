# Cypress Cloud Triage Runbook

Owner: `documentation.owners.triage` in `fhf-harness-os/config/qa-control-plane.json`.

Use this when a Cloud run is red, flaky, or timed out. Goal: one root cause per error cluster,
evidence before fixes, smoke stays metadata-only.

## 0. Preflight

```bash
node scripts/execution/cloud-access-doctor.mjs --probe
```

Fix naming/auth findings first. Agents never run `cy-cloud login` or inline tokens.

## 1. Find what failed (Cloud UI or CLI)

**UI:** open the run → **Errors** tab (cluster by error type) → **Specs** tab (status filter).

**CLI:**

```bash
cy-cloud run get --projectId nptdoe --runNumber <n>          # E2E
cy-cloud run get --projectId r5k1ro --runNumber <n>          # Smoke
cy-cloud test list --projectId <id> --runNumber <n> --status failed --limit 100
```

Morning summary:

```bash
node scripts/execution/night-brief.mjs
```

## 2. Cluster, then pick exemplars

Group failures that share the same error message / stack shape. Fix once per cluster.
Do not open a fix loop per sibling test until the exemplar is understood.

## 3. Pull evidence by lane

| Lane | Project | Replay / screenshots |
|---|---|---|
| E2E | `nptdoe` | **Required** before classify/fix when `testId` exists |
| Smoke | `r5k1ro` | Metadata + JUnit only (unless owner sets `FHF_ALLOW_PROD_DATA=1`) |

E2E recipe (prefix required from FHF root):

```bash
FHF_LANE=e2e cy-cloud replay timeline --testId <id> --aroundFailure 5 --commands --network --logs
```

Spawn `cypress-debugger` with the run URL; it must fill **Error Cluster** + **Replay Timeline**
in its output format.

## 4. Classify → fix → regression → gate

Use debugger categories (`SELECTOR_STALE`, `API_ALIAS_MISMATCH`, …). Fix config/commands, not
masks. Write `[BUG-NNN]` regression. Hand to `cypress-gate`. Stop after
`engineering.loops.sameFailureLimit` (3) identical failures.

## 5. Re-run only what failed

1. **Cloud admin (once):** Smart Orchestration → **Run only failed specs** on `nptdoe` and `r5k1ro`.
2. **CI retry:** keep / pass `CYPRESS_RERUN_GROUP_ID` from the prior build; force full with
   `CYPRESS_RERUN_ALL_TESTS=true`.
3. **Manual narrow:**

```bash
cy-cloud test list --projectId nptdoe --runNumber <n> --status failed --limit 100 \
  | node scripts/execution/select-failed.mjs --from-json -
# dispatch that SPEC_PATTERN
```

PR scope still uses `select-impacted.mjs`. Re-run optimization is for retry-after-failure.

## 6. Studio AI

E2E scratch discovery only. Never against production smoke. See
`.claude/rules/studio-ai-policy.md`.
