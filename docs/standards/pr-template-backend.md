# Pull Request — Backend Automation

## Overview

Briefly describe the purpose and scope of this PR.

## Type (check all applicable)

- [ ] New Test Script
- [ ] Bug Fix
- [ ] Refactor
- [ ] Optimization
- [ ] Documentation Update

## Changes

Detail the changes made in this PR.

### Endpoints / Oracle tables (optional)

## Jira ticket

Link to the SERV ticket.

## Checklist before requesting a review

- [ ] Self-review completed
- [ ] Labels and assignees set
- [ ] pytest output attached

## QA Gate Checklist

- [ ] Tests run against Dev/QA only — no production writes
- [ ] No hardcoded credentials or real PII in fixtures or payloads
- [ ] Active task manifest (`FHF_ACTIVE_TASK`) used for all writes and pytest runs
- [ ] Financial/monetary fields asserted with exact value matching
- [ ] `qa-automation-gate` verdict: PASS or PASS_WITH_ACTIONS

## Evidence

Paste pytest summary or CI run link.

## Post-deployment tasks (optional)

N/A

## Notes for reviewer

N/A
