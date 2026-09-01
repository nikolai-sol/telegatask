# TASK-076 Notes

## Changed

- Empty weekly digests now send one Telegram life-sign when `noNewOpportunities=true` and no candidate messages exist. The message includes the run week, watchlist count, and watchlist queries.
- The Zaruku rank-tracking config now includes seed clusters for `/limfoma/` and `/medialib/`.
- Region-aware SERP tracking from TASK-075 is deployed to the Beget weekly runner. Facility queries use the configured city-to-Yandex-`lr` map; unresolved cities retain the explicit `225` fallback and remain marked in the tracking snapshot.
- The MySQL export includes `region` in `seo_positions_weekly` rows and the tracking-set fields in `seo_weekly_runs`.
- The missing Beget schema change was applied idempotently: `seo_positions_weekly.region` is nullable and `uq_position` is keyed by `(analytics_account_id, week_key, cluster_id, region)`.
- The previously missing `tracking_set_*` columns on Beget `seo_weekly_runs` were also applied idempotently so the existing weekly exporter contract is executable on the next run.
- The Mac scheduler now starts child SEO scripts with a repository-root `cwd` derived from `__dirname`, removing the `process.cwd()` failure point for the async Hermes worker.

## Verification

- Local build passed: `npm run build`.
- Beget build passed: `ssh beget 'cd /opt/telegatask && npm run build'`.
- Hermes worker CLI completed for W31 with `selected=0`, `ready=0`, `edited=0`, `skipped=0`, `failed=0`; no LLM call was made because the queue is empty.
- The Mac PM2 `telegatask` process was restarted after the build. Fresh startup logs show seven scheduler jobs and a successful W31 Hermes run with all counters at zero; no new `EPERM` occurred.
- Focused Vitest tests passed for the life-sign, Zaruku config, MySQL export, and scheduler contracts.
- Golden baseline passed: 1 file, 6 tests.
- Full suite passed: 70 files, 254 tests.

## Intentionally Not Changed

- No Firestore schema or repository behavior.
- No Telegram approval/reject callback behavior.
- No GSC, Yandex provider, Lighthouse, HTML report, or storage architecture changes.
- No live weekly production pipeline was started manually; the Beget cron remains the existing isolated entrypoint.
- No Hermes jobs were manufactured for W31; the database correctly contains no advisory work for that run.
