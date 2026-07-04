# TASK-007 — Extract Yandex Webmaster Popular Queries Collector

## What Changed

- Extracted Yandex Webmaster popular query collection from `zarukuWgdProductionPipeline.ts` into `src/features/seoAgent/production/zaruku/collectors/yandexPopularQueriesCollector.ts`.
- The production pipeline now delegates `yandexQueries` collection to `collectYandexPopularQueries`.
- Added direct unit tests for the collector with injected `env`, `fetchImpl`, and `now` dependencies.

## Output Contract Preserved

- `yandexQueries` remains an array of:
  - `query`
  - `impressions`
  - `clicks`
  - `ctr`
  - `averagePosition`
- Missing Webmaster credentials still return an empty array.
- Existing OAuth token, refresh token, host discovery, query indicator, date range, CTR, and empty-query filtering behavior is preserved.

## Intentionally Not Changed

- GSC was not activated.
- Storage schema was not changed.
- Event/outbox behavior was not introduced.
- Firestore write behavior was not changed.
- `seoAgentService.ts` was not refactored.
- Provider classes were not moved.
- Report schema and field names were not changed.
- Existing homepage, sitemap, Lighthouse, and AI probe collectors were not changed.
- Production pipeline was not run to avoid Firestore writes and live service/API calls.

## Verification

- `npx vitest run src/features/seoAgent/production/zaruku/collectors/yandexPopularQueriesCollector.test.ts`
- `npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`
- `npx vitest run src/features/seoAgent/production/zaruku/zarukuWgdRunnerHelpers.test.ts src/features/seoAgent/production/zaruku/collectors/homepageSnapshotCollector.test.ts src/features/seoAgent/production/zaruku/collectors/sitemapSummaryCollector.test.ts src/features/seoAgent/production/zaruku/collectors/localLighthouseCollector.test.ts src/features/seoAgent/production/zaruku/collectors/yandexGenSearchProbeCollector.test.ts src/features/seoAgent/production/zaruku/collectors/yandexPopularQueriesCollector.test.ts`
- `npm test -- --run`
- `npx tsc --noEmit --pretty false`

## Recommended TASK-008

Extract Zaruku HTML report rendering from the production pipeline into a renderer module while preserving the existing HTML output structure.
