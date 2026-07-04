# TASK-028 — Telegram Response / Action Model

Status: Completed.

## Objective

Define a pure Telegram response/action model for Weekly Top-10 approval callback results.

This model prepares what a future Telegraf adapter should do without importing Telegraf, sending messages, executing approval commands or writing to storage.

## Changed files

- `src/features/seoAgent/weeklyTop10TelegramApprovalResponse.ts`
- `src/features/seoAgent/weeklyTop10TelegramApprovalResponse.test.ts`
- `TASK-028_NOTES.md`

## What changed

- Added a pure response model for callback handler results.
- Added response actions for:
  - approval execution intent;
  - rejection reason collection;
  - real task collection;
  - open details;
  - noop.
- Added tests for approve, reject, convert, open and ignored callback responses.

## Response shape

The model returns:

- `callbackAnswer` for a future adapter to pass to `answerCbQuery`;
- `messages` for a future adapter to reply/edit;
- `buttons` for future inline keyboards;
- `actions` for future adapter-level behavior;
- side-effect flags.

## Boundary decisions

- No Telegraf import.
- No Telegram API calls.
- No approval execution.
- No Firestore writes.
- No Weekly Top-10 digest persistence.
- No production pipeline execution.

## Action mapping

- `execute_approval_command` means the adapter may call the guarded approval runner later.
- `collect_rejection_reason` means the adapter should ask the user for a reason.
- `collect_real_task` means the adapter should ask the user to choose/create a real agency task.
- `open_details` means the adapter should navigate/open a details view later.
- ignored callbacks return no callback answer and no actions.

## Verification

Required checks:

- Telegram response model tests pass.
- Callback handler tests pass.
- Full test suite passes.
- TypeScript check passes.

## Recommended next task

Proceed to TASK-029: Telegraf adapter planning layer that maps real `callback_query` context to actor identity and this response model, still without executing writes by default.
