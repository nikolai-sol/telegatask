# TASK-015 — Read-Only Repository Adapter Boundary

## What Changed

- Added read-only boundary module `src/features/seoAgent/weeklyTop10SnapshotRepository.ts`.
- Added tests in `src/features/seoAgent/weeklyTop10SnapshotRepository.test.ts`.
- Defined a repository adapter contract for loading Weekly Top-10 assembly snapshots.
- Kept storage access injectable through readers instead of importing Firestore directly.

## Repository Boundary

- Opportunities:
  - caller-provided for now;
  - no Weekly Top-10 opportunity storage table was introduced.
- Draft tasks:
  - source collection: `seoDraftTasks`;
  - read method: `listSeoDraftTasksByRun`;
  - required filters: `teamId`, `runId`.
- Implementation tasks:
  - source collection: `agency_tasks`;
  - read method: `getAgencyTaskById`;
  - link: `seoDraftTasks.realTaskId -> agency_tasks.id`.
- Writes: none.

## Adapter Behavior

- Loads draft tasks by `teamId` and `runId`.
- Extracts unique non-empty `realTaskId` values from draft tasks.
- Loads only linked implementation tasks.
- Returns a snapshot compatible with `assembleWeeklyTop10Digest`.

## Intentionally Not Changed

- Firestore was not touched.
- Storage schema was not changed.
- Existing repositories were not modified.
- Event/outbox behavior was not introduced.
- Telegram was not touched.
- HTML reports were not changed.
- Production pipeline was not changed.
- GSC/Yandex providers were not changed.
- LLM behavior was not introduced or changed.
- Weekly digest was not persisted, scheduled, or sent.
- Production pipeline was not run to avoid Firestore writes and live service/API calls.

## Verification

- `npx vitest run src/features/seoAgent/weeklyTop10SnapshotRepository.test.ts`
- `npx vitest run src/features/seoAgent/weeklyTop10Assembly.test.ts src/features/seoAgent/weeklyTop10ImplementationStateSource.test.ts src/features/seoAgent/weeklyTop10ApprovalStateSource.test.ts src/features/seoAgent/weeklyTop10Generator.test.ts`
- `npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`
- `npm test -- --run`
- `npx tsc --noEmit --pretty false`

## Recommended Next Task

Create an explicit dry-run Weekly Top-10 command or service boundary that uses injected readers and prints/returns a digest without persistence, Telegram delivery, or production pipeline changes.
