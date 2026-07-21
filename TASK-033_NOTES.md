# TASK-033 - Yandex Popular Queries SearchPerformance Mapping Boundary

Date: 2026-07-05

## Objective

Define a read-only review/mapping boundary for metric-rich `yandexQueries` rows into official `SeoSearchPerformanceRecord` query records, using fixtures first and without changing thresholds or production writes.

## Changed Files

- `src/features/seoAgent/yandexPopularQueriesSearchPerformanceMapper.ts`
- `src/features/seoAgent/yandexPopularQueriesSearchPerformanceMapper.test.ts`
- `src/features/seoAgent/fixtures/yandexPopularQueriesSearchPerformance/inputYandexQueries.json`
- `src/features/seoAgent/fixtures/yandexPopularQueriesSearchPerformance/expectedRecords.json`
- `src/features/seoAgent/fixtures/yandexPopularQueriesSearchPerformance/expectedReview.json`
- `src/features/seoAgent/fixtures/yandexPopularQueriesSearchPerformance/expectedOpportunities.json`
- `TASK-033_NOTES.md`

## What Changed

- Added pure mapper `mapYandexPopularQueriesToSearchPerformanceRecords`.
- Input: existing metric-rich Yandex popular query rows:
  - `query`
  - `impressions`
  - `clicks`
  - `ctr`
  - `averagePosition`
- Output: `SeoSearchPerformanceRecord[]` with:
  - `source: "yandex_webmaster"`
  - `searchEngine: "yandex"`
  - `dimension: "query"`
  - per-query impressions/clicks/CTR/average position preserved.
- Blank query rows are skipped.
- Source rank is assigned after filtering, using the retained Yandex row order.
- Added `reviewYandexPopularQueriesSearchPerformanceMapping` for read-only review stats:
  - input rows;
  - mapped rows;
  - skipped rows;
  - metric-rich rows;
  - max impressions;
  - count at or above the current default Opportunity Engine minimum evidence impressions.

## Fixture-Based Golden Coverage

Fixtures protect:

- exact mapping from Yandex query rows to `SeoSearchPerformanceRecord`;
- review summary shape and counts;
- compatibility with the existing Opportunity Engine default thresholds.

The Opportunity Engine compatibility test proves that mapped records can produce an opportunity when a metric-rich query crosses the current default evidence threshold, without changing production thresholds.

## What Was Intentionally Not Changed

- Production Zaruku pipeline was not connected to this mapper.
- `scripts/runWgdZarukuCancerPortal.ts` was not changed.
- Yandex Webmaster collector logic was not changed.
- Firestore/storage schema was not changed.
- No new repository or table was added.
- No event/outbox work was added.
- No Telegram production behaviour was changed.
- No scheduler or auto-approval was added.
- No GSC/DataForSEO/Metrica activation was added.
- Opportunity Engine thresholds were not changed.
- HTML report structure was not changed.
- Production pipeline was not run.

## Risk Notes

- The current real TASK-032 run still legitimately produced zero opportunities because its raw Yandex popular-query max impressions was 99, below the default `minEvidenceImpressions` of 100.
- This task only proves the safe data contract. It does not decide whether `yandexQueries` should become an official SearchPerformance source in production.
- Query rows do not include target URLs, so mapped records set `page` and opportunity `targetUrl` to `null`.

## Recommended TASK-034

Add a non-invasive local review script that reads a WGD JSON report, maps `yandexQueries` through this boundary, runs the current Opportunity Engine in dry-run mode, and writes a local review artifact only. Do not connect it to production pipeline, Firestore, reports, Telegram, scheduler or threshold tuning yet.
