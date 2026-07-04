# TASK-012 — Approval-State Source / Storage Contract

## What Changed

- Added pure module `src/features/seoAgent/weeklyTop10ApprovalStateSource.ts`.
- Added tests in `src/features/seoAgent/weeklyTop10ApprovalStateSource.test.ts`.
- Defined the current read-only storage contract for Weekly Top-10 approval state over existing `seoDraftTasks` fields.
- Added a pure adapter from `SeoOpportunity[] + SeoDraftTask[]` to `WeeklyTop10OpportunityInput[]`.

## Current Approval-State Source

- Source collection: `seoDraftTasks`.
- Read-only fields:
  - `id`
  - `sourceId`
  - `sourceFindingId`
  - `title`
  - `status`
  - `targetKeywords`
  - `evidence`
  - `realTaskId`
  - `convertedAt`
  - `createdAt`
  - `updatedAt`
- Writes: none.

## State Mapping

- No matching draft task -> `new`.
- Matching draft task with `status: draft` -> `carried_over`.
- Matching draft task with `status: approved` -> `approved`.
- Matching draft task with `status: rejected` -> `rejected`.
- `implemented` is not emitted by this source because current storage does not prove implementation.

## Important Limitation

- `convertedAt` only means a real task was created. It does not prove the SEO change was implemented.
- A future implementation-state source is required before Weekly Top-10 can reliably emit `implemented`.

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
- Production pipeline was not run to avoid Firestore writes and live service/API calls.

## Verification

- `npx vitest run src/features/seoAgent/weeklyTop10ApprovalStateSource.test.ts`
- `npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`
- `npm test -- --run`
- `npx tsc --noEmit --pretty false`

## Recommended Next Task

Decide the implementation-state source for approved/converted SEO tasks before wiring Weekly Top-10 into persistence or delivery.
