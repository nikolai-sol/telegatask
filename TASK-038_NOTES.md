# TASK-038 - Yandex 28d Query History Coverage

Date: 2026-07-05

## Objective

Align the Yandex query data window with the Opportunity Engine threshold window. Use a config-driven 28-day Yandex Webmaster read path and rerun the local review without changing thresholds, production pipeline wiring, storage, Telegram, or scheduler behavior.

## Changed Files

- `src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.ts`
- `src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.test.ts`
- `src/features/seoAgent/production/zaruku/collectors/yandexQueryHistoryCollector.ts`
- `src/features/seoAgent/production/zaruku/collectors/yandexQueryHistoryCollector.test.ts`
- `scripts/runYandexQueryHistoryReview.ts`
- `reports/task-038-zaruku-yandex-28d-query-history-review-2026-07-05.json`
- `reports/task-038-zaruku-yandex-28d-query-history-raw-2026-07-05.json`
- `TASK-038_NOTES.md`

## What Changed

- Added config value:
  - `yandexQueryHistoryWindowDays: 28`
- Added collector-style local read module:
  - `collectYandexQueryHistory`
- Added opt-in local script:
  - `scripts/runYandexQueryHistoryReview.ts`
- The local script writes:
  - raw Yandex 28d snapshot;
  - mapped SearchPerformance records;
  - current Opportunity Engine output;
  - explicit side-effect flags.

## Implementation Note

The read path calls both:

- `/search-queries/all/history`
- `/search-queries/popular`

The raw `/all/history` response is stored in the raw artifact. Per-query rows are built from the query-level response under the same 28-day date window, because the `/all/history` response shape observed in this run is indicator-history oriented rather than a query-row list.

No Opportunity Engine threshold was changed.

## Local Live Review Run

Command:

```bash
node -r ts-node/register/transpile-only scripts/runYandexQueryHistoryReview.ts \
  --out reports/task-038-zaruku-yandex-28d-query-history-review-2026-07-05.json \
  --raw-out reports/task-038-zaruku-yandex-28d-query-history-raw-2026-07-05.json \
  --now 2026-07-05T12:00:00.000Z
```

Result:

- Date range: 2026-06-05 to 2026-07-02
- Window: 28 days
- API requests: 4
- Endpoint paths:
  - `/user`
  - `/user/340625537/hosts`
  - `/user/340625537/hosts/https%3Azaruku.ru%3A443/search-queries/all/history`
  - `/user/340625537/hosts/https%3Azaruku.ru%3A443/search-queries/popular`
- Input rows: 50
- SearchPerformance records: 50
- Metric-rich records: 50
- Max impressions: 246
- Default minimum evidence impressions: 100
- Records at or above threshold: 10
- Local opportunities: 10
- Side effects:
  - `persisted: false`
  - `sent: false`
  - `productionPipelineRun: false`

## Opportunity Output Review

The 28-day window produced 10 local opportunities. All 10 are ranking-window opportunities with medium priority and `targetUrl: null`.

Top generated opportunities:

- `гемотест орел победа 1` - 246 impressions, average position 9.80
- `ситилаб углич` - 187 impressions, average position 9.17
- `подногтевая меланома фото` - 171 impressions, average position 9.79
- `гемотест югорск` - 161 impressions, average position 10.27
- `ситилаб южа` - 144 impressions, average position 9.74

Quality note:

- Evidence quality is stronger than TASK-032/TASK-034 because the window now matches the threshold.
- URL evidence is still missing. These should not become production draft tasks until TASK-039 supplies deterministic query-to-URL evidence.

## What Was Intentionally Not Changed

- Opportunity Engine thresholds were not changed.
- Opportunity Engine rules were not changed.
- Production Zaruku pipeline was not wired to this read path.
- Production pipeline was not run.
- Firestore reads/writes were not added.
- Storage schema was not changed.
- HTML/production report format was not changed.
- Telegram delivery, scheduler, and auto-approval were not changed.
- GSC/DataForSEO/Metrica were not activated.
- TASK-035/TASK-037 heuristic query-to-page branch was not extended.

## Verification

- Yandex 28d collector tests passed.
- Zaruku config test passed.
- Raw and review artifacts are valid JSON.
- Golden baseline passed.
- Full test suite passed.
- TypeScript check passed.

## Recommended TASK-039

Proceed to SERP-based query-to-URL evidence. The 28-day query data now produces real opportunity candidates, but `targetUrl` remains missing. TASK-039 should use live SERP matched URLs for top-N query records through an opt-in, config-driven path.
