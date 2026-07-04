# TASK-030 — Guarded Telegraf Handler Registration Plan / Dev-Only Wiring

Status: Completed.

## Objective

Add a disabled-by-default dev wiring boundary for Weekly Top-10 Telegram approval callbacks.

The wiring must be explicit, feature-flagged and must not execute approval writes.

## Changed files

- `src/features/seoAgent/weeklyTop10TelegramApprovalDevRegistration.ts`
- `src/features/seoAgent/weeklyTop10TelegramApprovalDevRegistration.test.ts`
- `TASK-030_NOTES.md`

## What changed

- Added a bot-like registration boundary that does not import Telegraf directly.
- Added feature flag guard:
  - `SEO_WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_HANDLER=1`
- Added dev callback handling that uses the pure Telegraf adapter plan.
- Added tests for disabled registration, enabled registration, handled callbacks and ignored callbacks.

## Boundary decisions

- `telegataskBot.ts` was not changed.
- No handler is registered unless future code explicitly calls this module.
- No approval command is executed.
- No Firestore writes occur.
- No Weekly Top-10 digest persistence occurs.
- No production pipeline is run.

## Dev behavior

When enabled and wired by future code:

- handled callbacks may call `answerCbQuery`;
- handled callbacks may reply with guidance text;
- approval execution is still not performed;
- callback actions remain instructions only.

## Feature flag

```plain text
SEO_WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_HANDLER=1
```

Any other value leaves registration disabled.

## Verification

Required checks:

- Dev registration tests pass.
- Telegraf adapter tests pass.
- Full test suite passes.
- TypeScript check passes.

## Recommended next task

Proceed to TASK-031: explicitly wire the dev registration into `telegataskBot.ts` behind the feature flag, still without executing approval writes.
