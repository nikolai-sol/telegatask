# TASK-073 NOTES — Async Hermes enrichment

Status: completed on 2026-07-21.

This implements the rewritten Notion task. The earlier production-secrets gate is superseded: Notion is not part of the W31 critical path, and Hermes runs asynchronously on the Mac rather than inside the Beget weekly chain.

## Implemented contract

- Beget sends the deterministic template digest and completes MySQL/dashboard export without any LLM call.
- The weekly exporter creates one `advisory_pending` job per sent digest item in `seo_advisory_jobs`.
- The Mac worker reads the current run week, runs local Hermes, applies the existing Russian-only and drug-compliance checks, and persists advisory plus token usage.
- Persistence happens before Telegram `editMessageText`. A failed edit is retried from `advisory_ready` without calling Hermes again.
- `advisory_ready` with `telegram_edited_at`, and all `advisory_skipped` rows, are no-ops on later runs.
- Pending rows older than `SEO_ASYNC_HERMES_MAX_AGE_DAYS` (default 2) become `advisory_skipped` and never hold the week open.

## Data model

Added `seo_advisory_jobs` in `010_seo_os_v1.sql`.

Business key:

```text
(analytics_account_id, run_week_key, opportunity_id)
```

The weekly exporter may refresh deterministic source payloads and Telegram identifiers on a duplicate key, but deliberately does not overwrite status, advisory, token telemetry, requested time, or edit time.

Stored operational fields include:

- run/data week;
- opportunity and original Telegram message JSON;
- Telegram chat/message IDs;
- advisory status/content;
- input/output/total tokens;
- attempts and last error;
- ready/skipped/edited timestamps.

## Runtime split

### Beget

- `scripts/runWeeklySeoRhythm.ts` contains no `LLMService`, Hermes client, `SEO_DIGEST_LLM_ENRICHMENT`, or enrichment call.
- Global report carries the real digest chat ID and sent message IDs so the exporter can create pending jobs.
- Dry-run Telegram IDs never create jobs because dry-run suppresses `digestChatId`.
- Production schema was applied to `report_bd`.
- `telegatask_seo@localhost` received `SELECT, INSERT, UPDATE, DELETE` on `seo_advisory_jobs`.
- Code was synced to `/opt/telegatask`; remote `npx tsc --noEmit --pretty false` passed.

### Mac Mini

- On-demand command:

```bash
npm run seo:hermes-advisory
```

- Safe inspection:

```bash
npm run seo:hermes-advisory -- --list-only --run-week 2026-W30
```

- Scheduler flag: `SEO_ASYNC_HERMES_ENRICHMENT=1`.
- Schedule: every 30 minutes, with a process overlap guard and an immediate startup attempt.
- MySQL transport: existing `beget` SSH alias plus remote `/opt/telegatask/.env`; no production database password was copied to the Mac.
- Local weekly scheduler remains off: `SEO_WEEKLY_RHYTHM_CRON=0`.
- Notion execution is explicitly off: `SEO_APPROVAL_TASK_EXECUTION=0`.
- Local PM2 `telegatask` was rebuilt/restarted and reports 7 scheduler jobs (the previous baseline was 6).

## Verification

Targeted suite:

```text
7 test files / 33 tests passed
```

Full suite:

```text
70 test files / 251 tests passed
```

Additional checks:

- `npx tsc --noEmit` passed locally.
- `npm run build` passed locally.
- Production grep returned `in_chain_hermes_absent`.
- Production schema check confirmed the three advisory states and token/edit columns.
- Production table count is currently `0`, expected because the W30 export happened before TASK-073 existed.
- Remote list-only and Mac-over-SSH list-only both returned `selected=0`.
- A full Mac worker invocation returned `selected=0`, `failed=0` (successful no-op).

Fixtures/tests cover:

- pending → ready → Telegram edit → edited;
- persistence before edit;
- ready-row edit retry without a second Hermes call;
- staleness skip;
- drug-compliance rejection (the same enrichment boundary also owns RU-only rejection tests);
- transient failure remains retryable;
- idempotent message text merge;
- state-preserving exporter upsert;
- independent Mac scheduler gate;
- zero in-chain Hermes references.

## W31 interpretation

The W31 pass criteria are now the deterministic Beget run, sent digest, in-chain exported dashboard data, non-zero run telemetry with `run_week_key`, and persisted click decisions. Hermes arriving later is bonus evidence. Notion task creation is intentionally outside the exam.

The first real `advisory_pending` rows and Telegram edits can only appear after the next fresh weekly chain exports messages under this schema. An empty queue before that run is not an error.
