# Cypress Task

Your goal is to identify the type of task the user wishes to perform with Cypress. Some of this information may have already been supplied in the conversation. Depending on the type of task you will need to acquire different supplemental information.

## FHF Repos — Stop, Do Not Continue This Skill

Before anything else, check whether this task targets either FHF Cypress repo — including a
generic-sounding request ("write a test for the servicing dashboard") if project context makes
clear it's one of these two:

|Signal|Repo|
|---|---|
|"smoke", "production", "prod", availability/auth/structure check|`ProdSmokeExecution\front-end-automation`|
|"E2E", "functional", "regression", dev/QA environment|`AG Frontend Automation\front-end-automation`|

If it targets either repo: **stop here.** Tell the user: "This is FHF Cypress work — use the
`cypress-generator` agent instead of Cypress Author. It knows this repo's command-first
architecture, runs a reuse/duplication check first, gathers selector evidence from
`fhf-dashboards`, and hands off to `cypress-gate` before merge — none of which this generic
skill does." Do not proceed to `author.md`. Do not write, edit, or suggest test code.

If it's a different repo/project entirely, this note doesn't apply — continue below as normal.

## Inputs

You will be supplied preceding conversation and context and will need to analyze, infer, and when necessary request information to determine the user's intended task and parameters of that task.

## Supported Tasks

- Fix or improve existing tests: `FIX`
- Update existing test to add/remove/modify behavior: `UPDATE`
- Create new test(s): `CREATE`

## Acquire Information

You need to acquire the following information to help inform your task. Some of this information may have been supplied in the conversation and other pieces may be evident from context and location.

- `spec`: The spec filepath
- `test`: A path to a specific test in that spec file (using the names of `describe` and `it` blocks) or a line number (optional)
- `type`: Whether the target is an E2E or Component Test
- `instructions`: The task to accomplish

### Testing Type

Cypress features two different types of tests - knowing the targeted type will inform how to understand and write the needed test. Review the conversation and look for explicit references to:

- "E2E", "End to End": `E2E`
- "CT", "Component", "Angular", "React", "Vue": `CT`

If no type has been explicitly identified then attempt to infer from the spec filepath and project configuration. Check `cypress.config.js` or `cypress.config.ts` for configured e2e/component paths via a `specPattern`, and infer from common layout (e.g. `cypress/e2e/` → E2E, `cypress/component/` or `.cy.{jsx,tsx}` → CT). If the type is still ambiguous then stop and prompt the user to supply it. If they are unsure or ask for more information provide a summary of what each type is meant for.

|Type|Location|When to use|
|---|---|---|
|**E2E**|`cypress/e2e/**/*.cy.ts`|Critical user journeys, validating multiple functional areas, testing URL behavior, testing reload or browser history behavior, visiting URLs or cross-origin navigation, testing via natural language, testing auth or wanting to cache and restore cookies, localStorage, or sessionStorage|
|**Component**|`cypress/component/**/*.cy.{jsx,tsx}`|Isolated UI behaviors based on state within an identified UI Component (React, Vue.js, or Angular), testing mounting components, testing design system components, no network communication or routing|

## Handoff to author

Only reached when the FHF stop-check above didn't apply. When moving to [author.md](./author.md),
pass a single coherent payload:

|Field|Description|
|---|---|
|`task`|`FIX`, `UPDATE`, or `CREATE`|
|`spec`|Spec filepath (or suggested path for new specs)|
|`test`|Optional: `describe` / `it` path or line|
|`type`|`E2E` or `CT` (required to be settled before authoring; infer per **Testing Type** above or ask)|
|`instructions`|What to fix, change, or build|

Example (illustrative):

```json
{
  "task": "UPDATE",
  "spec": "cypress/e2e/checkout/complaints.cy.ts",
  "test": "Complaints / should show validation errors",
  "type": "E2E",
  "instructions": "Assert the new error message copy for empty status field."
}
```

## Act

After determining the task being performed ensure the needed information has been provided. If the request is ambiguous (e.g. "fix my tests", "update the spec") ask which spec file or what problem to address before proceeding. If needed information has not been provided and cannot be reliably inferred from the conversation, stop and ask the user to supply it.
