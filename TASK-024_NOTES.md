# TASK-024 — Repository Executor Boundary

Status: Completed.

## Objective

Add an executor boundary for human approval commands that can call repository/service writers only through injected functions.

## Changed files

- `src/features/seoAgent/weeklyTop10HumanApprovalExecutor.ts`
- `src/features/seoAgent/weeklyTop10HumanApprovalExecutor.test.ts`
- `TASK-024_NOTES.md`

## What changed

- Added an executor boundary for `WeeklyTop10HumanApprovalCommand`.
- The executor validates commands with `planWeeklyTop10HumanApprovalCommand` before executing.
- Invalid command plans do not call writer functions.
- Writer functions are injected, so the module has no direct Firestore dependency.

## Supported executor actions

- `create_draft_task` → injected `createDraftTask`
- `approve_draft_task` → injected `updateDraftTaskStatus` with `approved`
- `reject_draft_task` → injected `updateDraftTaskStatus` with `rejected`
- `convert_to_agency_task` → injected `markDraftTaskConverted`

## Boundary decision

The executor does not import repository modules directly.

Reason:

- keeps tests offline;
- keeps Firebase/Firestore out of the command core;
- makes real writes opt-in through a separate adapter;
- prevents dry-run/reporting export from accidentally gaining write capabilities.

## Side-effect contract

The executor always reports:

- `productionPipelineRun: false`
- `sent: false`
- `weeklyDigestPersisted: false`

It does not:

- send Telegram messages;
- persist Weekly Top-10 digests;
- run the production SEO pipeline;
- create API routes;
- schedule jobs.

## Conversion note

`convert_to_agency_task` currently links a draft task to an existing `realTaskId` through the injected conversion writer.

Creating the real agency task itself remains outside this executor boundary and should be handled by a future explicit adapter/service step.

## Verification

Required checks:

- Repository executor tests pass.
- Full test suite passes.
- TypeScript check passes.

## Recommended next task

Proceed to TASK-025: add a local command-planning CLI for human approval commands, still without executing writes by default.
