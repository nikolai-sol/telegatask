# TASK-075 Notes — Region Contract + Tracking Set Versioning

## What Changed in TASK-075

### 1) Per-cluster region contract (config-driven)
- `src/features/seoAgent/sectionRankTracking.ts` now resolves region during list build with explicit contract:
  - `regionContract.regionByIntent`
  - `regionContract.facilityRegionMap`
  - `regionContract.facilityFallbackRegion`
- `src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.ts` now defines region contract for Zaruku:
  - medical/supportive/own-brand intents → `225`
  - facility intent → city map (СПб/Москва/Санкт-Петербург/Новосибирск/Екатеринбург/Краснодар/Нижний Новгород/Самара/Челябинск/Ростов-на-Дону/Владивосток/Петербург/Сахалинск) with fallback `225`.
- `resolveFacilityRegion()` picks the longest matching token and marks `regionFallback` on unknown cities.

### 2) Region persistence end-to-end
- `src/features/seoAgent/sectionRankTracking.ts`
  - Added `region` + provenance fields to `SeoSectionRankTrackingListItem`.
  - `buildSeoRankHistoryRecords()` persists `region` into `SeoRankHistoryRecord` (falling back to tracked region).
  - `buildSeoRankDashboardExport()` includes per-item `region`.
  - Delta grouping keys changed to `(clusterId, region)` to avoid cross-region comparisons.
- `src/features/seoAgent/mysqlDashboardExport.ts`
  - `seo_positions_weekly` insert now writes `region`.
  - Upsert updates `region`.
  - Added region to DDL in `010_seo_os_v1.sql` (`seo_positions_weekly.region`, unique key now `(analytics_account_id, week_key, cluster_id, region)`).

### 3) Tracking set versioning and persistence hooks
- `src/features/seoAgent/sectionRankTracking.ts` + `src/features/seoAgent/weeklySeoRhythm.ts` / `scripts/runSectionRankTracking.ts` / `scripts/runWeeklySeoRhythm.ts` now keep per-item `region`, `regionSource`, `regionFallback` and build a run-tracking snapshot.
- `src/features/seoAgent/mysqlDashboardExport.ts` writes to:
  - `seo_weekly_runs.tracking_set_checksum`
  - `seo_weekly_runs.tracking_set_item_count`
  - `seo_weekly_runs.tracking_set_seed_count`
  - `seo_weekly_runs.tracking_set_live_count`
  - `seo_weekly_runs.tracking_set_seed_fallback_count`
  - `seo_weekly_runs.tracking_set_snapshot`
- Added safe backward-compatible accessor in MySQL exporter so missing `trackingSetVersion` in historical reports does not crash.
- `010_seo_os_v1.sql` adds all above columns + idempotent alter blocks.

### 4) Region-aware SERP execution
- `scripts/runSectionRankTracking.ts` and `scripts/runWeeklySeoRhythm.ts` execute Yandex checks grouped by `region` and carry `regionSummaries` into snapshot.
- Check request count is preserved from tracked list size.

## 20→7 Seed Discrepancy Investigation

Observed from historical artifact `reports/task-048-zaruku-weekly-seo-rhythm-2026-W28.json`:
- `trackingListSize = 13`
- `seed-derived = 7`

This was not reproduced as an active runtime defect after current changes. Current config now contains 20 configured seeds and historical/production-like runs later in same report stream show higher seed-derived counts (for example W29 artifact has 23 entries total and 17 seed-derived).

Therefore we treat this as an **input snapshot issue in that historical run** (cluster review / config state at run time), not a code regression in current region-contract logic.

## What Was Intentionally Not Changed
- No canonical collector schemas beyond additive migration-compatible DDL updates.
- No changes to production pipeline orchestration order/flow.
- No Yandex provider contract changes.
- No Telegram/Notion approval/task execution logic.

## Verification

Executed:
- `npx vitest run src/features/seoAgent/sectionRankTracking.test.ts`
- `npx vitest run src/features/seoAgent/weeklySeoRhythm.test.ts`
- `npx vitest run src/features/seoAgent/mysqlDashboardExport.test.ts`
- `npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`
- `npm test -- --run`

Notes:
- Golden regression remains green.
- MySQL SQL generation tests were updated implicitly by the added `region` + tracking-set columns in exports.
