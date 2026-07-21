# TASK-059 — Live Telegram Callback Persistence Wiring

## What Changed

- Wired the guarded weekly Top-10 Telegram dev callback handler to the TASK-045 `ApprovalDecision` persistence boundary.
- Approve callbacks now persist an `approved` decision when `SEO_WEEKLY_TOP10_APPROVAL_DECISION_WRITES=1`.
- Reject callbacks now create a pending rejection and persist the `rejected` decision only after the reviewer sends a reason as the next message.
- Added callback transcript fields to approval decisions:
  - `updateId`
  - `callbackQueryId`
  - `messageId`
  - `chatId`
- Added explicit decision source values:
  - `telegram_dev_callback`
  - `manual_backfill`
- Updated the Telegram bot integration bridge so it forwards callback and message contexts into the guarded dev handler.

## W29 Backfill

The existing W29 manual decisions were kept as the source of truth and updated with `source: manual_backfill`.

Current W29 decision state:

- #1 `w481`: approved
- #2 `w482`: approved
- #3 `w483`: approved
- #4 `w484`: approved
- #5 `w485`: rejected
- #6 `w486`: rejected

W29 callback transcript backfill uses the original Telegram digest message ids `3041` through `3046`. The backfill records have no live Telegram `updateId` or `callbackQueryId`, so those transcript fields are intentionally `null`.

## Idempotency

Idempotency remains owned by `persistWeeklyTop10ApprovalDecision`.

If a reviewer clicks approve/reject again for an already decided opportunity, the handler returns the existing decision confirmation and does not create a second record.

## Intentionally Not Changed

- No approval command execution.
- No draft-task mutation.
- No scheduler change.
- No production delivery/content change.
- No Weekly Top-10 selection logic change.
- No HTML report change.
- No storage schema/table/collection rename.
- No GSC, Yandex provider or LLM change.

## Verification

Focused tests:

- `npx vitest run src/features/seoAgent/weeklyTop10TelegramApprovalDevRegistration.test.ts src/bot/weeklyTop10TelegramApprovalBotIntegration.test.ts`
- `npx vitest run src/features/seoAgent/weeklyTop10ApprovalDecision.test.ts src/features/seoAgent/weeklyTop10TelegramApprovalResponse.test.ts src/features/seoAgent/weeklyTop10TelegramApprovalTelegrafAdapter.test.ts src/features/seoAgent/weeklyTop10TelegramApprovalCallbackHandler.test.ts src/features/seoAgent/weeklyTop10TelegramApprovalMessage.test.ts`

Required regression/build checks:

- `npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`
- `npm run build`
- `npm test -- --run`

Fresh results on 2026-07-13:

- Focused approval tests: 7 files passed, 37 tests passed.
- Golden baseline: 1 file passed, 6 tests passed.
- Build: `tsc` passed.
- Full test suite: 58 files passed, 195 tests passed.
- Controlled live-path smoke against W29 existing decisions:
  - approve callback for `w481` returned `Уже решено: одобрено.`
  - reject callback for `w485` collected a reason and returned `Уже решено: отклонено.`
  - no new decision was expected because both paths used already-decided W29 records.
- PM2 process `telegatask` restarted with `--update-env` and came back `online`.

## Recommended Next Task

TASK-053 remains the next execution boundary: turn persisted approved decisions into actual approval command execution under an explicit guard.
