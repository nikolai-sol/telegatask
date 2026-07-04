# TASK-019 — Opt-In Weekly Top-10 Reporting Export Script

Status: Completed.

## Changed files

- `src/features/seoAgent/weeklyTop10ReportingExportCli.ts`
- `src/features/seoAgent/weeklyTop10ReportingExportCli.test.ts`
- `scripts/runWeeklyTop10ReportingExport.ts`
- `TASK-019_NOTES.md`

## What changed

- Added an opt-in local reporting export boundary.
- The boundary runs the existing Weekly Top-10 dry-run path and converts the result to `seo_os_reporting_dashboard_export_v1`.
- Added a local script that accepts the same flags as `runWeeklyTop10DryRun`:
  - `--team-id`
  - `--run-id`
  - `--opportunities`
  - optional Weekly Top-10 config flags.
- Script output is JSON dashboard/reporting payload.

## Side-effect contract

- No Firestore writes.
- No storage schema changes.
- No Telegram sends.
- No API route.
- No scheduler.
- No production SEO pipeline execution.

## Notes

- The script can perform live Firestore reads when executed with real IDs, because it reuses the existing read-only snapshot repository wiring.
- `package.json` was intentionally not changed, so nothing runs automatically.
- Existing dry-run script output remains unchanged.

## Recommended next task

Proceed to TASK-020: define a read-only API/dashboard route contract for `seo_os_reporting_dashboard_export_v1`, without enabling persistence, scheduling or Telegram delivery.
