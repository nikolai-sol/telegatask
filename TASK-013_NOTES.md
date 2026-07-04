# TASK-013 — Explicit Implementation-State Source

## What Changed

- Added pure module `src/features/seoAgent/weeklyTop10ImplementationStateSource.ts`.
- Added tests in `src/features/seoAgent/weeklyTop10ImplementationStateSource.test.ts`.
- Exported the existing Weekly Top-10 draft-task matcher from `weeklyTop10ApprovalStateSource.ts` so implementation-state matching uses the same opportunity-to-draft contract.
- Defined a read-only implementation-state storage contract over existing `agency_tasks`.

## Current Implementation-State Source

- Source collection: `agency_tasks`.
- Link:
  - `seoDraftTasks.realTaskId`
  - `agency_tasks.id`
- Read-only fields:
  - `id`
  - `teamId`
  - `companyId`
  - `status`
  - `completedAt`
  - `updatedAt`
- Writes: none.

## State Mapping

- Matching SEO draft task without `realTaskId` -> keep existing Weekly Top-10 state.
- Matching SEO draft task with `realTaskId`, but no matching `agency_tasks` record -> keep existing Weekly Top-10 state.
- Matching `agency_tasks` record with `status: done` -> `implemented`.
- `implementedAt` comes from `completedAt`, falling back to `updatedAt`.
- `convertedAt` alone still does not prove implementation.

## Intentionally Not Changed

- Firestore was not touched.
- Storage schema was not changed.
- Event/outbox behavior was not introduced.
- Telegram was not touched.
- HTML reports were not changed.
- Production pipeline was not changed.
- GSC/Yandex providers were not changed.
- LLM behavior was not introduced or changed.
- Weekly digest was not persisted, scheduled, or sent.
- No repository reads/writes were added.
- Production pipeline was not run to avoid Firestore writes and live service/API calls.

## Verification

- `npx vitest run src/features/seoAgent/weeklyTop10ImplementationStateSource.test.ts`
- `npx vitest run src/features/seoAgent/weeklyTop10ApprovalStateSource.test.ts`
- `npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`
- `npm test -- --run`
- `npx tsc --noEmit --pretty false`

## Recommended Next Task

Create a non-invasive Weekly Top-10 assembly function that composes opportunities, approval state, and implementation state in memory without persistence or delivery.
