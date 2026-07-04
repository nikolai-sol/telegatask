# TASK-014 — Weekly Top-10 Assembly Function

## What Changed

- Added pure module `src/features/seoAgent/weeklyTop10Assembly.ts`.
- Added tests in `src/features/seoAgent/weeklyTop10Assembly.test.ts`.
- Composed the existing pure boundaries in memory:
  - `SeoOpportunity[] + SeoDraftTask[]` -> Weekly Top-10 approval inputs.
  - approval inputs + `agency_tasks` snapshot -> explicit implementation state.
  - final inputs -> Weekly Top-10 digest.

## Assembly Contract

- Input:
  - `opportunities`
  - `draftTasks`
  - `implementationTasks`
  - optional Weekly Top-10 generator config
- Output:
  - assembled `inputs`
  - generated `digest`

## Intentionally Not Changed

- Firestore was not touched.
- Storage schema was not changed.
- Repositories were not changed.
- Event/outbox behavior was not introduced.
- Telegram was not touched.
- HTML reports were not changed.
- Production pipeline was not changed.
- GSC/Yandex providers were not changed.
- LLM behavior was not introduced or changed.
- Weekly digest was not persisted, scheduled, or sent.
- Production pipeline was not run to avoid Firestore writes and live service/API calls.

## Verification

- `npx vitest run src/features/seoAgent/weeklyTop10Assembly.test.ts`
- `npx vitest run src/features/seoAgent/weeklyTop10ImplementationStateSource.test.ts src/features/seoAgent/weeklyTop10ApprovalStateSource.test.ts src/features/seoAgent/weeklyTop10Generator.test.ts`
- `npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`
- `npm test -- --run`
- `npx tsc --noEmit --pretty false`

## Recommended Next Task

Create a read-only Weekly Top-10 repository adapter plan or repository boundary test that documents how snapshots will be loaded, without enabling persistence or delivery yet.
