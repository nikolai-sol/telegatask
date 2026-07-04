# TASK-023 — Human Approval Command Contract

Status: Completed.

## Objective

Define the command contract for human approval actions before wiring any write execution path.

## Changed files

- `src/features/seoAgent/weeklyTop10HumanApprovalCommand.ts`
- `src/features/seoAgent/weeklyTop10HumanApprovalCommand.test.ts`
- `TASK-023_NOTES.md`

## What changed

- Added a pure human approval command contract.
- Added a planner/validator for approval commands.
- Added tests for approve, reject and convert command planning.

## Supported commands

- `create_draft_task`
- `approve_draft_task`
- `reject_draft_task`
- `convert_to_agency_task`

## Command boundary

Every command requires:

- `teamId`
- `runId`
- explicit human `actor`

Accepted actor roles:

- `owner`
- `admin`
- `seo_manager`

Command-specific requirements:

- `create_draft_task`: `opportunityTitle`
- `approve_draft_task`: `draftTaskId`
- `reject_draft_task`: `draftTaskId`, `reason`
- `convert_to_agency_task`: `draftTaskId`, `realTaskId`

## Repository mapping

Planned repository methods:

- `create_draft_task` → `createSeoDraftTasks`
- `approve_draft_task` → `updateSeoDraftTaskStatus` with `approved`
- `reject_draft_task` → `updateSeoDraftTaskStatus` with `rejected`
- `convert_to_agency_task` → `markSeoDraftTaskConverted`

## Side-effect contract

This task does not execute writes.

The command contract explicitly keeps these outside the approval command boundary:

- production pipeline execution;
- Telegram send;
- Weekly Top-10 digest persistence.

## What was not changed

- No Firestore writes.
- No API route.
- No Telegram flow.
- No scheduler.
- No production pipeline execution.
- No repository execution wrapper.
- No dashboard UI.

## Verification

Required checks:

- Human approval command tests pass.
- Full test suite passes.
- TypeScript check passes.

## Recommended next task

Proceed to TASK-024: implement a fixture-only/offline reporting export entrypoint so dashboard contract validation can run without Firebase, Firestore credentials or network access.
