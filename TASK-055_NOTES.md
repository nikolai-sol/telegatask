# TASK-055 — MySQL Dashboard Export

## What Changed

- Added the ReportingDash MySQL read-model migration contract in `010_seo_os_v1.sql`.
- Added a pure dashboard export planner in `src/features/seoAgent/mysqlDashboardExport.ts`.
- Added an opt-in local exporter script: `scripts/runSeoMysqlDashboardExport.ts`.
- Added Zaruku MySQL export config under `zarukuSeoProductionConfig.mysqlDashboardExport`.
- Added env documentation for the opt-in MySQL export path in `.env.example`.

## Tables

The migration creates the SEO OS dashboard read model:

- `seo_section_patterns`
- `seo_positions_weekly`
- `seo_opportunities`
- `seo_tasks`
- `seo_weekly_runs`

All tables follow the ReportingDash convention with `source_key`, `analytics_account_id` and `ingestion_run_id` where applicable. Zaruku uses analytics account `66624469`.

## Live Export Result

Source artifact:

- `reports/task-049-zaruku-global-report-2026-W28.json`

Generated artifacts:

- `reports/task-055-zaruku-mysql-dashboard-export-2026-W28-dry-run.json`
- `reports/task-055-zaruku-mysql-dashboard-export-2026-W28.sql`
- `reports/task-055-zaruku-mysql-dashboard-export-2026-W28-live.json`
- `reports/task-055-zaruku-mysql-dashboard-export-2026-W28-live.sql`
- `reports/task-055-zaruku-mysql-dashboard-export-2026-W28-live-repeat.json`

Live MySQL counts after repeat export:

- `seo_positions_weekly`: 13 rows for `2026-W28`
- `seo_opportunities`: 5 rows for `2026-W28`
- `seo_tasks`: 0 rows for `2026-W28`
- `seo_weekly_runs`: 1 row for `2026-W28`
- `seo_section_patterns`: 12 rows

Repeat export produced the same counts, proving idempotent upsert behavior for W28.

## Failure Isolation

The first live export attempt returned `export_pending` because MySQL rejected ISO timestamps for `DATETIME`. The exporter now converts ISO timestamps to MySQL `YYYY-MM-DD HH:mm:ss`.

The second live attempt returned `export_pending` because `serp_requests` and `llm_tokens` were `NULL` while the DDL requires non-null counters. The exporter now defaults missing weekly counters to `0`.

Both failures were isolated to the MySQL export artifact. No production pipeline, Telegram, Firestore writes or SEO OS decision logic were affected.

## Intentionally Not Changed

- No dashboard/Python code changes.
- No Metrika traffic duplication.
- No reads from MySQL back into SEO OS logic.
- No rhythm chain behavior changes.
- No TASK-053 approval execution.
- No production WGD pipeline run.

## Verification

- `npx vitest run src/features/seoAgent/mysqlDashboardExport.test.ts`
- `npx vitest run src/features/seoAgent/mysqlDashboardExport.test.ts src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.test.ts`
- `npm run build`

Additional verification continued after notes creation:

- golden baseline
- full test suite

## Recommended Next Task

TASK-053 remains the next main-line task: approval command execution. After TASK-053 produces draft tasks, re-run TASK-055 export so `seo_tasks` is populated.
