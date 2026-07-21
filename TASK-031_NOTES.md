# TASK-031 — Dev-Only Bot Startup Integration Point

## What Changed

- Added startup integration helper `src/bot/weeklyTop10TelegramApprovalBotIntegration.ts`.
- Added tests in `src/bot/weeklyTop10TelegramApprovalBotIntegration.test.ts`.
- Wired the guarded Weekly Top-10 Telegram approval dev handler into `src/bot/telegataskBot.ts`.
- The integration is disabled by default and uses the existing feature flag:
  - `SEO_WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_HANDLER=1`

## Insertion Point

- Registration happens immediately after the real `Telegraf` bot instance is created.
- The integration uses an internal bot-like bridge instead of registering a second real `bot.on("callback_query")` middleware.
- The existing `callback_query` handler dispatches `seo10:` callbacks into that bridge after access checks and before existing skill/media/task callbacks.

This keeps the existing Telegraf callback chain stable while making the dev handler reachable from the real bot startup path.

## Flag Behaviour

- Flag absent or not equal to `1`:
  - registration function is not called;
  - no dev handler is stored;
  - callback handling returns `false`;
  - startup behaviour remains unchanged.
- Flag `=1`:
  - dev handler is registered exactly once;
  - repeated registration attempts do not add duplicate handlers;
  - registration errors are caught and logged.

## Intentionally Not Changed

- Default production delivery was not enabled.
- Telegram messages are not scheduled or sent by default.
- Approval command execution was not added.
- Firestore write behaviour was not changed.
- Weekly Top-10 digest persistence was not added.
- Scheduler was not changed.
- Production pipeline was not run.
- HTML reports, GSC/Yandex providers and LLM were not changed.
- TASK-026–030 callback, response and adapter internals were not changed.

## Verification

- `npx vitest run src/bot/weeklyTop10TelegramApprovalBotIntegration.test.ts src/features/seoAgent/weeklyTop10TelegramApprovalDevRegistration.test.ts`
- `npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`
- `npm test -- --run`
- `npx tsc --noEmit --pretty false`

## Recommended Next Task

TASK-032 — controlled dev-mode end-to-end check: manually send one Weekly Top-10 digest message with buttons to a dev chat under the flag, tap each button, verify callback answers and generated command plans in plan-mode only, with no writes.
