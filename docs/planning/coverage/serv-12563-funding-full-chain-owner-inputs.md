# SERV-12563 Funding Full-Chain — Owner Inputs Required

**Owner:** QA engineering
**Status:** Blocked pending owner decisions
**Date:** 2026-09-09

## Purpose

The SERV-12563 manifest scopes one correlated UI → API → Oracle → cleanup chain for Funding
Coordinator assignment, plus a downstream Funding-to-Post-Funding handoff. The automation is
written and fails closed. It cannot execute a mutation because four product capabilities and one
data mapping are undefined, not because configuration is missing. This document states each
question, why it blocks execution, and which artifact it unblocks.

## Evidence boundary

Sources inspected for this document:

- application source `fhf-dashboards`: `src/routes/funding.routes.tsx`,
  `src/components/postFunding/**`, `src/constants/routes.js`, `src/constants/network.js`;
- backend automation `fhf-backend-automation`: `tests/example_env`, `tests/commons/db_schema.py`;
- Dev environment, read-only browser session on 2026-09-09: Funding Coordinator assignment queue
  and detail, Post Funding summary.

No mutation was executed in any environment. Claims below are limited to what these sources show.

## Findings that changed the planned design

### Post Funding is dealer-keyed, not application-keyed

The manifest flow `FL-PF-001` and rule `BR-PF-001` in
`Test-Case-Automation-Using-Claude-Agents/specs/modules/post-funding/post-funding.yaml` v1.1.0
assume a completed Funding application becomes visible in Post Funding under the same application
identity. The application source does not support that assumption.

`src/components/postFunding/summary/card/Card.jsx` renders one card per dealer from
`dealer_id`, `dealership_name`, `total_infractions`, `infractions_above_threshold`, `next_call`,
and `last_os_visit`, and links to `POST_FUNDING_DEALER_DETAIL` with `:id` replaced by `dealer_id`.
The application identity appears one level down, in
`src/components/postFunding/dealerDetail/infractions/InfractionRecord.jsx`, whose row fields are
`application_id`, `loan_number`, `vin`, `vehicle`, `funded_date`, `days_since_funding`,
`process_status`, and `idpost_funding_tracker`.

The consequence is that an application appears to surface in Post Funding only when it carries a
post-funding infraction such as a missing document, above some threshold. Funding completion alone
does not predict appearance. Until this is confirmed, the handoff flow as specified is not a
verifiable chain, and both post-funding specs and manifest entries need revision.

The API surface in `src/constants/network.js` matches the dealer-keyed model: `post-funding/summary`,
`post-funding/infractions/`, `post-funding/infraction-types`, `post-funding/status`, and the write
paths `post-funding/update-status`, `post-funding/add-note`, `post-funding/follow-up`. There is no
per-application dealer-detail API; the detail route composes the infractions and notes endpoints.

### No Funding contract exists in the backend environment registry

`fhf-backend-automation/tests/example_env` is the registry of every endpoint the suite can resolve.
It contains no entry matching `FUNDING`, `POST_FUNDING`, `SEED`, or `TEARDOWN`. The Funding and Post
Funding clients added for this task therefore cannot resolve a URL even for a read.

### Funding assignment has no inverse and is not contained

`PUT /v2/funding-coordinator/actions` carries the assigned funder's username, name, and email, and
the DL4 orchestration behind it can invoke InformedIQ and Docman processing. `ASSIGN_FUNDER` is the
only action found; no unassign or revert action exists. Nothing in the inspected Dev configuration
shows those downstream effects routed to test adapters or sinks.

### The Funding Oracle read model is unconfirmed

`tests/commons/db_schema.py` contains `UnifiViews.APPROVED_DEAL_INFO`, but under the Unifi module
and with no verified schema binding for Funding Coordinator use. No object, identity column, or
assigned-funder column has been confirmed for the Funding Coordinator queue, and no Post Funding
object exists in the registry at all. A provisional `FundingCoordinatorViews` entry asserting
otherwise was added during this task and has been removed; the tests now resolve these names from
owner-supplied configuration and fail closed with the missing variable named.

## Requests

### Product owner — Funding lifecycle and Post-Funding eligibility

1. What is the terminal Funding state that represents completion, and what supported transition
   moves an application into it? The Funding Coordinator screen only assigns a funder. No completion
   transition was found in the application source.
2. What is the exact rule that places a funded application into Post Funding? Specifically: is a
   post-funding infraction or missing document required, and what is the
   `infractions_above_threshold` / `days_since_funding` threshold that governs visibility?
3. If Post Funding is infraction-driven, should SERV-12563 keep the Funding-to-Post-Funding handoff
   in scope, or should the chain terminate at verified Funding completion?

### Backend and API — seed, teardown, and endpoint registration

4. Is there a supported seed contract that creates a synthetic eligible Funding application in
   Dev/QA, comparable to the SERV-12524 seed-mode pattern? If not, should one be requested as its
   own ticket before SERV-12563 can execute a mutation?
5. Is there a supported teardown contract that deletes or restores such a record? Because
   `ASSIGN_FUNDER` has no inverse, cleanup cannot currently be verified.
6. Please confirm the exact paths for registration in `tests/example_env`: the Funding Coordinator
   actions endpoint, the seed and teardown endpoints, `POST_FUNDING_SUMMARY_ENDPOINT`, and
   `POST_FUNDING_INFRACTIONS_ENDPOINT` with its dealer filter parameter name.
7. What is the documented duplicate or idempotency outcome for a repeated identical `ASSIGN_FUNDER`
   request, and the documented status for an invalid or ineligible `LosAppId`?

### Platform and environment — egress containment

8. In Dev/QA, are funder notification email, InformedIQ, Docman, and S3 delivery routed to verified
   non-egress adapters or sinks? Please identify the mechanism, so it can be asserted rather than
   assumed.
9. Is there a supported fault-injection path for the dependency-failure scenario `NG-FC-003`, and
   what is the expected response contract when it fires?

### Data and Oracle — read-model mapping

10. Which Oracle object backs the Funding Coordinator queue, and what are its application-identity,
    assigned-funder, and funding-status column names?
11. Which Oracle object backs Post Funding? The UI field `idpost_funding_tracker` suggests a
    post-funding tracker table, but this has not been confirmed and is not in the registry.
12. What is the field-level mapping between the Post Funding API responses and those columns?

## Suspected application defect

`src/components/postFunding/cards/DealerCard.jsx` builds its link as
`routes.POST_FUNDING_SUMMARY.replace(':id', dealer_id)`. `POST_FUNDING_SUMMARY` is
`/post-funding/summary` and contains no `:id` token, so the replacement is a no-op and the link
resolves back to the summary page rather than the dealer detail. The parallel component
`summary/card/Card.jsx` correctly uses `POST_FUNDING_DEALER_DETAIL`. Which component the summary
route renders was not confirmed, so this is reported as suspected rather than reproduced.

## Blocked artifacts

| Artifact | Blocked by |
| --- | --- |
| `funding-coordinator-assignment-full-chain.cy.js` mutation path | Requests 4, 5, 6, 8 |
| `test_funding_coordinator_assignment.py` assignment and no-write scenarios | Requests 4, 5, 6, 7, 9, 10 |
| `funding-to-post-funding-full-chain.cy.js` | Requests 1, 2, 3 |
| `test_funding_post_funding_handoff.py` handoff scenarios | Requests 1, 2, 3, 11, 12 |
| `post-funding/post-funding.yaml` `BR-PF-001`, `FL-PF-001` | Requests 2, 3 |
| Any backend execution in this worktree | Unrelated SERV-12270 changes staged outside the task plan |

## Unblocked without owner input

The read-only Post Funding contract checks in `TestPostFundingReadModel` verify the dealer-keyed
summary shape and the application-level infraction shape. They require only endpoint registration
from request 6 and a Dev dealer with infraction rows. Isolating the unrelated SERV-12270 changes in
`fhf-backend-automation` allows those reads to run.
