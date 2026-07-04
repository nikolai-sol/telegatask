# TASK-022 — Persistence Decision + Approval Boundary

Status: Completed.

## Objective

Decide whether Weekly Top-10 output should be persisted now and define the approval boundary before adding any write path.

## Changed files

- `src/features/seoAgent/weeklyTop10PersistenceDecision.ts`
- `src/features/seoAgent/weeklyTop10PersistenceDecision.test.ts`
- `TASK-022_NOTES.md`

## Decision

Weekly Top-10 digest persistence is deferred.

No new collection/table is added in this step.

Reason:

- Current reporting export already provides a stable read-only payload.
- There is no confirmed dashboard/API consumer that needs historical persisted digests yet.
- Approval state already exists through `seoDraftTasks.status`.
- Implementation state already exists through `seoDraftTasks.realTaskId -> agency_tasks.id`.

## Approval boundary

Current state sources:

- approval state: `seoDraftTasks`
- implementation state: `agency_tasks`

Allowed future write commands:

- `create_draft_task`
- `approve_draft_task`
- `reject_draft_task`
- `convert_to_agency_task`

All write commands require a human actor and must be separate from:

- dry-run service;
- reporting export;
- scheduler;
- Telegram delivery;
- production pipeline.

## Disallowed automation

The current boundary explicitly disallows:

- auto-persisting Weekly Top-10 digest;
- auto-approving opportunities;
- auto-converting opportunities to agency tasks;
- sending Telegram notifications without approval;
- running the production SEO pipeline from the approval/export path.

## What changed

- Added a pure persistence decision contract.
- Added a pure helper to derive human approval candidates from Weekly Top-10 digest sections.
- Added tests for the contract and candidate mapping.

## What was not changed

- No Firestore writes.
- No storage schema changes.
- No API route.
- No Telegram flow.
- No scheduler.
- No production pipeline execution.
- No persistence repository for Weekly Top-10 digests.

## Verification

Required checks:

- Persistence decision tests pass.
- Full test suite passes.
- TypeScript check passes.

## Recommended next task

Proceed to TASK-023: fixture-only/offline reporting export entrypoint so dashboard contract validation can run without Firebase, Firestore credentials or network access.
