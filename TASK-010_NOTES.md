# TASK-010 — SearchPerformance Normalizer Boundary

## Numbering Note

The Notion plan listed this as TASK-009 after safe GSC activation. Local TASK-009 was already used for the Zaruku HTML renderer extraction, so this implementation is recorded as TASK-010.

## What Changed

- Added `src/features/seoAgent/searchPerformanceNormalizer.ts`.
- Added a pure normalized record model for existing `SeoSearchConsoleSnapshot` data from:
  - `gsc`
  - `yandex_webmaster`
- Added tests covering:
  - source/search-engine markers
  - date range preservation
  - summary records
  - query/page/country/device dimension records
  - empty snapshot handling
  - keeping Google and Yandex records separate for the same query

## Output Contract Preserved

- Production runner output was not changed.
- `SeoAnalysisRun` persisted schema was not changed.
- JSON/HTML report schema was not changed.
- No new storage table or collection was introduced.

## Intentionally Not Changed

- The normalizer is not wired into persistence yet.
- Opportunity logic was not changed.
- GSC provider logic was not changed.
- Yandex Webmaster provider logic was not changed.
- Firestore write behavior was not changed.
- Event/outbox behavior was not introduced.
- Production pipeline was not run to avoid Firestore writes and live service/API calls.

## Verification

- `npx vitest run src/features/seoAgent/searchPerformanceNormalizer.test.ts`
- `npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`
- `npm test -- --run`
- `npx tsc --noEmit --pretty false`

## Recommended Next Task

Wire normalized SearchPerformance records into a non-invasive consumer or storage boundary only after deciding the persistence contract.
