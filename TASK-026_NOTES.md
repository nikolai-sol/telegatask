# TASK-026 — Telegram Approval Message Model + Callback Payload Contract

Status: Completed.

## Objective

Define the Telegram approval message model and callback payload contract for Weekly Top-10 approval actions without wiring Telegraf handlers or sending messages.

## Changed files

- `src/features/seoAgent/weeklyTop10TelegramApprovalMessage.ts`
- `src/features/seoAgent/weeklyTop10TelegramApprovalMessage.test.ts`
- `TASK-026_NOTES.md`

## What changed

- Added a pure Telegram approval message model.
- Added a versioned callback payload encoder/decoder.
- Added callback contract tests.
- Added message model tests for text and inline button rows.

## Callback contract

Callback prefix:

- `seo10`

Version:

- `v1`

Payload shape:

```plain text
seo10:v1:<actionCode>:<teamId>:<runId>:<draftTaskId>
```

Supported actions:

- `a` → approve intent → `approve_draft_task`
- `r` → reject intent → request rejection reason
- `c` → convert intent → `convert_to_agency_task`
- `o` → open details intent

## Boundary decisions

- Callback payloads identify intent only.
- Callback payloads do not execute approval commands by themselves.
- Reject does not include a reason in `callback_data`; it must request a reason in a follow-up step.
- Convert requires a separate real task creation or selection step before command execution.
- Message generation is pure and does not send Telegram messages.

## Telegram limits

- Callback data is capped at 64 bytes.
- Encoder throws if payload exceeds the limit.
- IDs in callback data must remain compact; if production IDs are too long, the next step should introduce a short callback token/session store.

## What was not changed

- No Telegraf handler.
- No Telegram send.
- No Firestore writes.
- No approval command execution.
- No API route.
- No scheduler.
- No production pipeline execution.

## Verification

Required checks:

- Telegram approval message tests pass.
- Full test suite passes.
- TypeScript check passes.

## Recommended next task

Proceed to TASK-027: callback session/token boundary if real `teamId`, `runId` or `draftTaskId` values exceed Telegram's 64-byte callback limit.
