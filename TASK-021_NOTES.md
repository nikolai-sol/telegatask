# TASK-021 — Controlled Local Reporting Export Dry-Run

Status: Completed.

## Objective

Perform one controlled local reporting export dry-run using a reviewed opportunities fixture and record the observed output summary without adding persistence or delivery.

## Changed files

- `scripts/runWeeklyTop10DryRun.ts`
- `scripts/runWeeklyTop10ReportingExport.ts`
- `TASK-021_NOTES.md`

## Preflight

Reviewed fixture:

- `src/features/seoAgent/fixtures/searchPerformanceOpportunityEngine/expectedOpportunities.json`

Verification before the live read:

- `npm test`
- `npm run build`

## Command

```bash
npx ts-node-dev --transpile-only --exit-child scripts/runWeeklyTop10ReportingExport.ts \
  --team-id team-1 \
  --run-id run-1 \
  --opportunities src/features/seoAgent/fixtures/searchPerformanceOpportunityEngine/expectedOpportunities.json \
  --now 2026-07-03T12:00:00.000Z
```

## Execution notes

- First local attempt exposed a Firebase initialization ordering issue:
  - `firestore.service.ts` calls `getFirestore()` at module load time.
  - The weekly scripts imported `firestore.service.ts` before any explicit Firebase app initialization.
- Fixed both weekly entrypoints by importing `../src/config/firebase` before Firestore-backed services:
  - `scripts/runWeeklyTop10DryRun.ts`
  - `scripts/runWeeklyTop10ReportingExport.ts`
- Second sandboxed attempt reached Firestore but failed DNS resolution for `firestore.googleapis.com`.
- The same read-only dry-run was rerun with approved network access.

## Observed output summary

Output schema:

- `schemaVersion`: `seo_os_reporting_dashboard_export_v1`
- `source.type`: `weekly_top10_dry_run`
- `source.mode`: `dry_run`
- `teamId`: `team-1`
- `runId`: `run-1`
- `generatedAt`: `2026-07-03T12:00:00.000Z`

Weekly Top-10 summary:

- `totalCandidates`: 3
- `includedCount`: 3
- `watchlistCount`: 0
- `carriedOverCount`: 0
- `approvedStaleCount`: 0
- `noNewOpportunities`: false

State summary:

- `new`: 3
- `carried_over`: 0
- `approved`: 0
- `implemented`: 0
- `rejected`: 0

Snapshot counts:

- `opportunities`: 3
- `draftTasks`: 0
- `implementationTasks`: 0

Included items:

1. `Improve GSC CTR for "за руку"` — priority `high`, confidence score `89`.
2. `Improve GSC rankings for "рак лечение"` — priority `high`, confidence score `89`.
3. `Improve Yandex Webmaster rankings for "рак лечение"` — priority `medium`, confidence score `60`.

## Side-effect validation

Observed side-effect flags:

- `persisted`: false
- `sent`: false
- `productionPipelineRun`: false

No API route, scheduler, Telegram delivery, storage schema change or production SEO pipeline execution was added.

## Notes

- The run used fixture IDs `team-1` / `run-1`, so zero draft tasks and implementation tasks is expected.
- This validates the reporting export contract and live read-only path shape, not real Zaruku state.
- Existing raw dry-run script output contract remains unchanged.

## Recommended next task

Proceed to TASK-022: choose a real SEO run identifier for Zaruku and repeat the controlled reporting export dry-run to validate draft-task and implementation-state matching against real data.
