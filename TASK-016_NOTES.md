# TASK-016 — Dry-Run Weekly Top-10 Service Boundary

## What Changed

- Added dry-run service boundary `src/features/seoAgent/weeklyTop10DryRunService.ts`.
- Added tests in `src/features/seoAgent/weeklyTop10DryRunService.test.ts`.
- The service composes:
  - read-only snapshot loading through injected readers;
  - Weekly Top-10 assembly;
  - digest return payload.

## Dry-Run Contract

- Mode: `dry_run`.
- Requires injected readers.
- Returns:
  - assembled inputs;
  - Weekly Top-10 digest;
  - snapshot counts;
  - explicit side-effect flags.
- Writes: none.
- Notifications: none.
- Production pipeline execution: none.

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
- No live command was added.
- Production pipeline was not run to avoid Firestore writes and live service/API calls.

## Verification

- `npx vitest run src/features/seoAgent/weeklyTop10DryRunService.test.ts`
- `npx vitest run src/features/seoAgent/weeklyTop10SnapshotRepository.test.ts src/features/seoAgent/weeklyTop10Assembly.test.ts src/features/seoAgent/weeklyTop10ImplementationStateSource.test.ts src/features/seoAgent/weeklyTop10ApprovalStateSource.test.ts src/features/seoAgent/weeklyTop10Generator.test.ts`
- `npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`
- `npm test -- --run`
- `npx tsc --noEmit --pretty false`

## Recommended Next Task

Add an opt-in local dry-run script that wires existing read repositories into the dry-run service, guarded so it never sends notifications or writes digest records.
