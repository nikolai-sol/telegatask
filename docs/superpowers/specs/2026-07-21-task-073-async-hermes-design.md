# TASK-073: Async Hermes advisory design

## Goal

Keep the Monday SEO chain deterministic and independent from Hermes and Notion. The Beget chain must finish after collecting facts, building opportunities, sending the template digest, and exporting the dashboard. Hermes enriches the already-sent digest later from the Mac Mini.

## Decisions

- MySQL is the shared queue and durable advisory state.
- A dedicated `seo_advisory_jobs` table owns the enrichment lifecycle; `seo_opportunities` remains a dashboard read model.
- States are `advisory_pending`, `advisory_ready`, and `advisory_skipped`.
- The weekly exporter creates pending jobs idempotently after Telegram message IDs exist. Its upsert never resets a terminal or ready state.
- The Mac worker persists `advisory_ready` before calling Telegram. A failed edit is therefore retried without another Hermes call.
- Jobs older than `SEO_ASYNC_HERMES_MAX_AGE_DAYS` (default 2) are marked skipped and never block the weekly chain.
- Notion task creation remains implemented but disabled. Neither `NOTION_API_TOKEN` nor `SEO_APPROVAL_TASK_EXECUTION` is a W31 prerequisite.

## Data flow

1. Monday 09:10 Beget runs the deterministic weekly chain.
2. The chain sends the template Telegram messages and records their IDs.
3. The MySQL export upserts SEO read models and one pending advisory job per digest item.
4. When the Mac Mini is awake, the async worker selects current-week pending jobs.
5. Hermes generates advisory text. Existing Russian-language and drug-compliance checks run before persistence.
6. A valid advisory is stored with token usage, then the worker calls `editMessageText` for the original message while preserving its buttons.
7. The edit timestamp makes later runs no-ops. A Telegram failure leaves the row ready and unedited so only the edit is retried.

## Failure and idempotency model

- Weekly exporter rerun: same `(analytics_account_id, run_week_key, opportunity_id)` key; no duplicate and no state reset.
- Hermes/transient failure: increment attempt telemetry, keep pending until stale.
- Language/compliance rejection: mark skipped with a stable reason.
- Telegram failure after persistence: keep ready; next run skips Hermes and retries Telegram.
- Completed edit or skipped job: never selected again.
- No eligible rows: successful no-op.

## Operations

The worker is available as an on-demand CLI and through an independent opt-in Mac scheduler flag. It uses the existing MySQL CLI credentials, Hermes CLI configuration, and Telegram bot token. Token counts live on each advisory job so they remain observable without making the weekly run depend on the Mac.

## Verification

- Unit fixtures cover lifecycle transitions, idempotency, stale skipping, persistence-before-edit, edit retry, Russian-only output, and drug-compliance rejection.
- Export tests prove the new table DDL, pending-row creation, and state-preserving upsert.
- CLI/scheduler tests prove Hermes is absent from the Beget chain and the Mac worker is independently gated.
