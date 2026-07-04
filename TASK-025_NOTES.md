# TASK-025 — Guarded Local Approval Command Runner

Status: Completed.

## Objective

Add a guarded local runner for Weekly Top-10 human approval commands.

The runner must allow local planning without Firebase/Firestore and require explicit confirmation before any repository write path is loaded.

## Changed files

- `src/features/seoAgent/weeklyTop10HumanApprovalRunnerCli.ts`
- `src/features/seoAgent/weeklyTop10HumanApprovalRunnerCli.test.ts`
- `scripts/runWeeklyTop10ApprovalCommand.ts`
- `TASK-025_NOTES.md`

## What changed

- Added CLI parsing for approval commands.
- Added a local runner that plans by default.
- Added guarded execute mode behind:
  - `--execute`
  - `--confirm-execute APPROVE_WEEKLY_TOP10_COMMAND`
- Added a script entrypoint.
- Firebase and repository modules are loaded only when `--execute` is present.

## Plan mode

Default mode does not execute writes.

Example:

```bash
npx ts-node-dev --transpile-only --exit-child scripts/runWeeklyTop10ApprovalCommand.ts \
  --type approve_draft_task \
  --team-id <teamId> \
  --run-id <runId> \
  --draft-task-id <draftTaskId> \
  --actor-user-id <userId>
```

## Execute mode

Execute mode requires explicit confirmation:

```bash
npx ts-node-dev --transpile-only --exit-child scripts/runWeeklyTop10ApprovalCommand.ts \
  --type approve_draft_task \
  --team-id <teamId> \
  --run-id <runId> \
  --draft-task-id <draftTaskId> \
  --actor-user-id <userId> \
  --execute \
  --confirm-execute APPROVE_WEEKLY_TOP10_COMMAND
```

## Supported local execute actions

- `approve_draft_task`
- `reject_draft_task`
- `convert_to_agency_task`

`create_draft_task` is planned but not wired for execution in this local runner yet, because creating a valid SEO draft task requires the full task payload, not only a title.

## Side-effect contract

The runner does not:

- send Telegram notifications;
- persist Weekly Top-10 digests;
- run the production SEO pipeline;
- add routes;
- add a scheduler.

## Verification

Required checks:

- Runner CLI tests pass.
- Human approval command/executor tests pass.
- Full test suite passes.
- TypeScript check passes.

## Recommended next task

Proceed to TASK-026: run the approval command runner in plan mode against a real draft task ID, inspect the planned write, and only then decide whether to execute an approval command.
