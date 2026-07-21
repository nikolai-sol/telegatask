# TASK-071_NOTES

> Superseded for W31 by rewritten TASK-073 (2026-07-21): Hermes now runs asynchronously from the Mac through `seo_advisory_jobs`, and Notion task creation is outside the exam critical path. The production-secret prerequisites and remaining-items list below are historical evidence, not current blockers. See `TASK-073_NOTES.md`.

## Scope

Pre-exam fixes for the SEO OS weekly rhythm before W31:

- dashboard export invocation hardening;
- weekly run telemetry export;
- `seo_tasks.section` backfill path;
- `seo_weekly_runs.run_week_key` contract;
- guarded approval task execution from Telegram approve callbacks;
- production readiness check for Hermes/Notion env.

## What Changed

- `scripts/runWeeklySeoRhythm.ts`
  - Added missing `readJsonFile` helper used by the in-chain dashboard export step.
  - This prevents the post-chain export from crashing after the child export process writes its artifact.

- `src/features/seoAgent/globalReportAssembler.ts`
  - Global report now carries `runWeekKey`, `dataWeekKey`, `startedAt`, `stages`, `sourceWeeklyArtifact`, and `advisoryEnrichment`.
  - This gives the MySQL exporter real counters/stages/timestamps instead of empty telemetry.

- `src/features/seoAgent/mysqlDashboardExport.ts`
  - `seo_weekly_runs` export now writes both `week_key` (data week) and `run_week_key` (scheduler/run week).
  - Telemetry now uses weekly artifact counters/stages and advisory token totals when present.
  - `runMysqlDashboardExport` accepts optional task input consistently with `buildMysqlDashboardExportPlan`.

- `010_seo_os_v1.sql`
  - Added `seo_weekly_runs.run_week_key`.
  - Existing rows are backfilled with `run_week_key = week_key`.
  - `uq_run` now keys the run row by `(analytics_account_id, run_week_key)`.
  - `week_key` remains the data week and has a secondary index for dashboard filtering.

- `src/features/seoAgent/weeklyTop10TelegramApprovalDevRegistration.ts`
  - Approve callbacks still persist decisions first.
  - When `SEO_APPROVAL_TASK_EXECUTION=1`, approved decisions now call the guarded task execution boundary.
  - If execution is disabled or cannot create a Notion task, the handler degrades to decision-only behavior instead of blocking Telegram callbacks.

- `.env.example`
  - Added `SEO_DIGEST_LLM_ENRICHMENT=0`.

## Verification

- `npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts src/features/seoAgent/globalReportAssembler.test.ts src/features/seoAgent/mysqlDashboardExport.test.ts src/features/seoAgent/weeklySeoRhythm.test.ts src/features/seoAgent/weeklyTop10TelegramApprovalDevRegistration.test.ts src/features/seoAgent/weeklyTop10ApprovalTaskExecution.test.ts src/bot/weeklyTop10TelegramApprovalBotIntegration.test.ts`
- `npx tsc --noEmit`
- `npm test -- --run`
- Dry-run export:
  - `npx ts-node scripts/runSeoMysqlDashboardExport.ts --global-report reports/task-049-zaruku-global-report-2026-W29.json --out reports/task-071-zaruku-mysql-dashboard-export-2026-W29-dry-run.json --sql-out reports/task-071-zaruku-mysql-dashboard-export-2026-W29-dry-run.sql`

## Production Env Findings

Fresh Beget check:

- `HERMES_DIGEST_MODEL=grok-4.5` exists.
- `HERMES_CLI_PATH=/Users/nafanya/.local/bin/hermes` points to a Mac-only path and is not valid on Beget.
- `ANTHROPIC_API_KEY` exists on Beget.
- `GEMINI_API_KEY` is not set on Beget.
- `NOTION_API_TOKEN` is not set on Beget.
- `SEO_DIGEST_LLM_ENRICHMENT` is not set on Beget.
- `SEO_APPROVAL_TASK_EXECUTION` is not set on Beget.

Current code fallback for missing Hermes CLI uses `LLMService`, which reads `GEMINI_API_KEY`, not `ANTHROPIC_API_KEY`. Therefore Hermes live advisory cannot be honestly verified on Beget until either a working Hermes CLI is installed there or a supported LLM key/path is provided.

Approval task execution also cannot be live-verified on Beget until `NOTION_API_TOKEN` is present.

## Beget Deployment / Live Export

- Changed TASK-071 files were synced to `/opt/telegatask`.
- `npx tsc --noEmit` passed on Beget.
- Beget Vitest was not runnable under the current Node runtime:
  - Node is `v20.11.1`;
  - Vitest/Rolldown requires `node:util.styleText`, which is absent there.
- The `seo_weekly_runs.run_week_key` DDL was applied once with the Beget admin MySQL user because the limited `telegatask_seo` writer does not have `ALTER` privileges.
- A live W29 dashboard export was rerun after DDL:
  - `status=exported`;
  - `positions=26`;
  - `opportunities=3`;
  - `tasks=4`;
  - `weeklyRuns=1`.
- W29 task section backfill is verified in MySQL:
  - `seo_task_2026_W29_w481` -> `/rak-molochnoj-zhelezy/`;
  - `seo_task_2026_W29_w482` -> `/melanoma/`;
  - `seo_task_2026_W29_w483` -> `/rak-molochnoj-zhelezy/`;
  - `seo_task_2026_W29_w484` -> `/rak-lyogkogo/`.
- Historical W29 run telemetry remains mostly zero because the source W29 global report was produced before TASK-071 started exporting `sourceWeeklyArtifact`. Fresh runs from the updated chain will carry real counters/stages/timestamps.

## What Intentionally Did Not Change

- No ReportingDash code was changed.
- No canonical collectors were changed.
- No GSC/Yandex provider logic was changed.
- No Telegram production daemon was started on Beget.
- No legacy writer cleanup was done; that belongs to TASK-072.

## Remaining Before W31 Exam

1. Install/configure a working Hermes runtime on Beget or provide the key expected by the fallback path.
2. Add `NOTION_API_TOKEN` to Beget before enabling `SEO_APPROVAL_TASK_EXECUTION=1`.
3. Enable `SEO_DIGEST_LLM_ENRICHMENT=1` only after Hermes can run on Beget.
4. Enable `SEO_APPROVAL_TASK_EXECUTION=1` only after `NOTION_API_TOKEN` exists.
5. Run one live weekly chain with a fresh run week and confirm:
   - Hermes advisory is present;
   - dashboard export status is `exported`;
   - `seo_weekly_runs` has non-zero telemetry and a separate `run_week_key`.
6. Run one approve callback and confirm:
   - Notion task is created with `awaiting_medical_review`;
   - task id/url fields are written back to `seoWeeklyTop10ApprovalDecisions`.
