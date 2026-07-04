# TASK-018 — SEO OS Reporting / Dashboard Export Contract

## What Changed

- Added pure export contract module `src/features/seoAgent/seoOsReportingExportContract.ts`.
- Added tests in `src/features/seoAgent/seoOsReportingExportContract.test.ts`.
- Defined `seo_os_reporting_dashboard_export_v1`.
- Added a pure adapter from `WeeklyTop10DryRunResult` to a stable reporting/dashboard export payload.

## Export Contract

- Source type:
  - `weekly_top10_dry_run`
- Intended consumers:
  - dashboard
  - reporting
- Output:
  - schema version
  - generated timestamp from digest
  - team/run identity
  - dashboard cards
  - Weekly Top-10 sections
  - state summary
  - snapshot counts
  - dry-run side-effect flags

## Intentionally Not Changed

- Firestore was not touched.
- Storage schema was not changed.
- Existing repositories were not modified.
- API routes were not changed.
- HTML reports were not changed.
- Event/outbox behavior was not introduced.
- Telegram was not touched.
- Production pipeline was not changed.
- GSC/Yandex providers were not changed.
- LLM behavior was not introduced or changed.
- Weekly digest was not persisted, scheduled, or sent.
- The opt-in dry-run script was not executed.
- Production pipeline was not run.

## Verification

- `npx vitest run src/features/seoAgent/seoOsReportingExportContract.test.ts`
- `npx vitest run src/features/seoAgent/weeklyTop10DryRunService.test.ts src/features/seoAgent/weeklyTop10DryRunCli.test.ts`
- `npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`
- `npm test -- --run`
- `npx tsc --noEmit --pretty false`

## Recommended Next Task

Add an opt-in local export script that composes the dry-run script result into the reporting/dashboard export contract and prints JSON, without adding API routes or persistence.
