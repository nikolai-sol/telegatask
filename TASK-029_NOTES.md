# TASK-029 — Thin Telegraf Adapter Boundary

Status: Completed.

## Objective

Add a thin adapter boundary that maps minimal Telegraf callback context into the pure Weekly Top-10 callback handler and Telegram response model.

## Changed files

- `src/features/seoAgent/weeklyTop10TelegramApprovalTelegrafAdapter.ts`
- `src/features/seoAgent/weeklyTop10TelegramApprovalTelegrafAdapter.test.ts`
- `TASK-029_NOTES.md`

## What changed

- Added a thin adapter planner for Telegram callback context.
- Maps callback data and actor identity into the pure callback handler.
- Converts handler response into adapter instructions:
  - callback answer text;
  - reply message payloads;
  - edit-message flag;
  - adapter actions.
- Added tests for approve, default actor role, missing actor identity and unrelated callbacks.

## Boundary decisions

- Does not register `bot.on("callback_query")`.
- Does not mutate `telegataskBot.ts`.
- Does not call `answerCbQuery`, `reply` or `editMessageText`.
- Does not execute approval commands.
- Does not send Telegram messages.
- Does not write to Firestore.
- Does not run the production SEO pipeline.

## Actor mapping

The adapter requires:

- `callbackData`
- `telegramUserId`
- internal `userId`

If role is omitted, it defaults to `seo_manager`.

## Adapter instructions

The adapter returns instructions for a future integration layer:

- `answerCallbackQuery`
- `replyMessages`
- `editMessage`
- `actions`

All side-effect flags remain false.

## Verification

Required checks:

- Telegraf adapter tests pass.
- Telegram response/handler tests pass.
- Full test suite passes.
- TypeScript check passes.

## Recommended next task

Proceed to TASK-030: register a disabled-by-default Telegraf callback route behind an explicit feature flag, still without executing approval writes.
