# Pull Request — Frontend Automation

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

### Routes / Modules (optional)

## Jira ticket

Link to the FirstHelp ticket (SERV, GEARS, LOS, or SDX).

## Checklist before requesting a review

- [ ] Self-review completed
- [ ] Labels and assignees set
- [ ] Screenshots or recordings attached if applicable

## QA Gate Checklist

- [ ] Command-first architecture preserved (Config → Commands → Tests)
- [ ] No new `*.actions.js` or page-object wrappers
- [ ] No hard waits (`cy.wait(ms)`)
- [ ] All selectors and endpoints use config constants
- [ ] `cypress-gate` verdict: PASS or PASS_WITH_ACTIONS

## Evidence

Paste Cypress Cloud run URL or local run summary.

## Post-deployment tasks (optional)

N/A

## Notes for reviewer

N/A
