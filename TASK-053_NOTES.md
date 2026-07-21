# TASK-053 — Approval Command Execution

## What Changed

- Added a pure approval-decision task execution boundary in `weeklyTop10ApprovalTaskExecution`.
- Approved decisions now map to SEO OS task metadata and can write task execution fields back to the same `ApprovalDecision` record.
- Added first-day support for `needs_target_page` when an approved opportunity has no `targetUrl`.
- Extended `ApprovalDecision` records with task execution metadata:
  - `executionStatus`
  - `taskId`
  - `taskStatus`
  - `taskUrl`
  - `taskCreatedAt`
  - `taskUpdatedAt`
  - `taskTargetUrl`
  - `taskOpportunityType`
  - `executionError`
- Extended the TASK-055 MySQL exporter so it derives `seo_tasks` rows automatically from decision records when no separate tasks file is provided.
- Extended the `seo_tasks.status` enum with `needs_target_page`.
- Added Zaruku config for the guarded task execution boundary:
  - `SEO_APPROVAL_TASK_EXECUTION`
  - `NOTION_API_TOKEN`
  - Notion parent page id for the current SEO OS source-of-truth page.

## Live W29 Execution

Input decisions:

- `w481`: approved
- `w482`: approved
- `w483`: approved
- `w484`: approved
- `w485`: rejected
- `w486`: rejected

Created Notion task pages:

- `seo_task_2026_W29_w481`: `awaiting_medical_review`
- `seo_task_2026_W29_w482`: `awaiting_medical_review`
- `seo_task_2026_W29_w483`: `awaiting_medical_review`
- `seo_task_2026_W29_w484`: `awaiting_medical_review`

Reconciliation note (2026-07-13): `w484` is bound to `https://zaruku.ru/rak-lyogkogo/na-chto-imeet-pravo-onkopacient/`, an existing lung-cancer rights article with a dedicated disability section. `needs_target_page` remains supported for future approved decisions without a bound target. `w485` and `w486` produced zero task side effects.

## Live Artifacts

- `reports/task-053-zaruku-approval-task-execution-plan-2026-W29.json`
- `reports/task-053-zaruku-approval-task-execution-live-2026-W29.json`
- `reports/task-049-zaruku-global-report-2026-W29.json`
- `reports/task-055-zaruku-mysql-dashboard-export-2026-W29-live-after-task-053.json`
- `reports/task-055-zaruku-mysql-dashboard-export-2026-W29-live-after-task-053.sql`

## MySQL Export

TASK-055 was rerun live after task creation without passing a `--tasks` file. The exporter derived tasks from `layers.systemWork.decisions`.

Live MySQL result for `2026-W29`:

- `seo_tasks`: 4 rows
- `awaiting_medical_review`: 4 rows
- `needs_target_page`: 0 rows

## Intentionally Not Changed

- No CMS/page edits.
- No production WGD pipeline run.
- No Telegram sends.
- No scheduler changes.
- No opportunity scoring, clustering, binding or digest content changes.
- No rejected-decision side effects for `w485` and `w486`.
- No measurement job; that remains TASK-054.

## Verification

- Red/green TDD:
  - `npx vitest run src/features/seoAgent/weeklyTop10ApprovalTaskExecution.test.ts`
  - `npx vitest run src/features/seoAgent/mysqlDashboardExport.test.ts`
  - `npx vitest run src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.test.ts`
- Fresh verification on 2026-07-13:
  - Focused tests: 4 files passed, 11 tests passed.
  - Golden baseline: 1 file passed, 6 tests passed.
  - TypeScript build: passed.
  - Full suite: 59 files passed, 199 tests passed.
- Live checks:
  - 4 Notion pages created under SEO OS Source of Truth.
  - 4 approved W29 decision records contain task ids and task URLs.
  - `w485` and `w486` still have no task ids.
  - MySQL `seo_tasks` contains 4 rows for `2026-W29`.

## Recommended Next Task

TASK-060 — Digest Honesty Pack, because W29 exposed the missing target-page binding path that now lands safely as `needs_target_page`.
