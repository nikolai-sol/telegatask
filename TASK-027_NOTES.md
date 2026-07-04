# TASK-027 — Telegram Callback Handler Boundary

Status: Completed.

## Objective

Add a pure Telegram callback handler boundary for Weekly Top-10 approval callbacks without registering a Telegraf handler, executing approval commands, sending messages or writing to storage.

## Changed files

- `src/features/seoAgent/weeklyTop10TelegramApprovalCallbackHandler.ts`
- `src/features/seoAgent/weeklyTop10TelegramApprovalCallbackHandler.test.ts`
- `TASK-027_NOTES.md`

## What changed

- Added a pure callback handler for `seo10:*` payloads.
- Added structured next-step results for each supported callback action.
- Added tests for approve, reject, convert, open and ignored callback data.

## Action handling

- `approve` → builds an `approve_draft_task` command plan.
- `reject` → requests a rejection reason; no command is produced yet.
- `convert` → requests/selects/creates a real task before conversion; no command is produced yet.
- `open` → returns an open-details next step.

## Boundary decisions

- The handler does not import Telegraf.
- The handler does not call `answerCbQuery`.
- The handler does not execute approval commands.
- The handler does not send Telegram messages.
- The handler does not run the production SEO pipeline.
- The handler does not persist Weekly Top-10 digests.

## Side-effect contract

Every handler result includes:

- `approvalCommandExecuted: false`
- `telegramMessageSent: false`
- `productionPipelineRun: false`
- `weeklyDigestPersisted: false`

## What was not changed

- No bot registration.
- No callback routing in `telegataskBot.ts`.
- No Firestore writes.
- No approval execution.
- No API route.
- No scheduler.

## Verification

Required checks:

- Telegram callback handler tests pass.
- Telegram approval message tests pass.
- Full test suite passes.
- TypeScript check passes.

## Recommended next task

Proceed to TASK-028: Telegraf adapter contract for translating real callback queries into this pure handler result, still without executing writes by default.
