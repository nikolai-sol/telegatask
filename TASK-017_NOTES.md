# TASK-017 — Opt-In Local Weekly Top-10 Dry-Run Script

## What Changed

- Added opt-in local script `scripts/runWeeklyTop10DryRun.ts`.
- Added CLI helper module `src/features/seoAgent/weeklyTop10DryRunCli.ts`.
- Added tests in `src/features/seoAgent/weeklyTop10DryRunCli.test.ts`.
- The script wires existing read repositories into `runWeeklyTop10DryRun`:
  - `listSeoDraftTasksByRun`
  - `getAgencyTaskById`

## How To Run

Example:

```bash
npx ts-node-dev --transpile-only scripts/runWeeklyTop10DryRun.ts \
  --team-id <teamId> \
  --run-id <runId> \
  --opportunities src/features/seoAgent/fixtures/searchPerformanceOpportunityEngine/expectedOpportunities.json \
  --now 2026-07-03T10:00:00.000Z
```

This is intentionally opt-in and local. It reads existing storage through the injected read repositories and prints the dry-run JSON result.

## Script Inputs

- `--team-id`
- `--run-id`
- `--opportunities`
- optional Weekly Top-10 generator config:
  - `--now`
  - `--max-items`
  - `--max-watchlist-items`
  - `--min-confidence-score`
  - `--stale-approved-days`

## Intentionally Not Changed

- Firestore schema was not changed.
- Storage writes were not added.
- Existing repositories were not modified.
- Event/outbox behavior was not introduced.
- Telegram was not touched.
- HTML reports were not changed.
- Production pipeline was not changed.
- GSC/Yandex providers were not changed.
- LLM behavior was not introduced or changed.
- Weekly digest was not persisted, scheduled, or sent.
- No package.json script was added, so nothing runs automatically.
- The dry-run script was not executed during verification to avoid live Firestore reads.
- Production pipeline was not run.

## Verification

- `npx vitest run src/features/seoAgent/weeklyTop10DryRunCli.test.ts src/features/seoAgent/weeklyTop10DryRunService.test.ts`
- `npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`
- `npm test -- --run`
- `npx tsc --noEmit --pretty false`

## Recommended Next Task

Add a guarded read-only repository wiring test or documentation for the exact Firestore credentials/environment required to run the local dry-run script safely.
