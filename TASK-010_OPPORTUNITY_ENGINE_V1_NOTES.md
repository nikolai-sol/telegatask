# TASK-010 — Opportunity Engine v1

## What Changed

- Added pure module `src/features/seoAgent/searchPerformanceOpportunityEngine.ts`.
- Added fixture-based golden tests in `src/features/seoAgent/searchPerformanceOpportunityEngine.test.ts`.
- Added fixtures:
  - `src/features/seoAgent/fixtures/searchPerformanceOpportunityEngine/inputRecords.json`
  - `src/features/seoAgent/fixtures/searchPerformanceOpportunityEngine/expectedOpportunities.json`

## Contract

- Input: `SeoSearchPerformanceRecord[]`.
- Output: `SeoOpportunity[]`.
- Thresholds are configured only through `SearchPerformanceOpportunityEngineConfig` and `DEFAULT_SEARCH_PERFORMANCE_OPPORTUNITY_CONFIG`.
- No lemmatization is used.
- GSC and Yandex Webmaster records remain source-separated.

## Rules Covered

- Ranking window opportunity:
  - query record
  - impressions above configured threshold
  - average position inside configured ranking window
- Low CTR opportunity:
  - query record
  - impressions above configured threshold
  - CTR below configured threshold
  - average position inside configured top-position window

## Intentionally Not Changed

- Firestore was not touched.
- Storage schema was not changed.
- Event/outbox behavior was not introduced.
- Telegram was not touched.
- HTML reports were not changed.
- Production pipeline was not changed.
- GSC/Yandex providers were not changed.
- LLM behavior was not introduced or changed.
- Existing `gscOpportunityEngine.ts` was not changed.
- Opportunity Engine v1 was not wired into `runSeoAnalysis`.
- Production pipeline was not run to avoid Firestore writes and live service/API calls.

## Verification

- `npx vitest run src/features/seoAgent/searchPerformanceOpportunityEngine.test.ts`
- `npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`
- `npm test -- --run`
- `npx tsc --noEmit --pretty false`

## Recommended Next Task

Define the non-invasive integration boundary for Opportunity Engine v1, including where generated `SeoOpportunity[]` should be consumed or persisted without changing storage schema accidentally.
