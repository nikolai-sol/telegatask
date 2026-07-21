# TASK-032 - First Real Zaruku Run (Yandex-only)

Date: 2026-07-05

## Scope

Executed the first controlled real SEO OS cycle for Zaruku using the existing production entrypoint and available Yandex-only data.

No code changes were made for TASK-032.

## Commands Run

Production pipeline, intentionally run for this task:

```bash
npx ts-node-dev --transpile-only scripts/runWgdZarukuCancerPortal.ts
```

Captured log:

- `logs/task-032-zaruku-run-20260705T111120Z.log`

Generated SearchPerformance and Opportunity Engine artifacts from the run report:

```bash
node -r ts-node/register/transpile-only
```

Generated read-only Weekly Top-10 reporting export:

```bash
node -r ts-node/register/transpile-only scripts/runWeeklyTop10ReportingExport.ts \
  --team-id qa-seo-team-1 \
  --run-id yvt9fCTw2T9okKnb5EBZ \
  --opportunities reports/task-032-zaruku-opportunities-2026-07-05.json \
  --now 2026-07-05T11:30:00.000Z
```

## Production Run Result

- Run ID: `yvt9fCTw2T9okKnb5EBZ`
- Domain: `zaruku.ru`
- Mode/status: `quick_audit` / `draft`
- Draft tasks created: `4`
- JSON report: `reports/wgd-zaruku-cancer-portal-2026-07-05.json`
- HTML report: `reports/wgd-zaruku-cancer-portal-2026-07-05.html`

## Source Statuses

| Source | Status | Notes |
| --- | --- | --- |
| `crawler` | `success` | Homepage 200, title/meta/H1/canonical present, robots and sitemap reachable, indexable. |
| `gsc` | `skipped` | `GSC_NOT_CONFIGURED`; service credential has no access to `sc-domain:zaruku.ru`. This did not block the run. |
| `yandex_webmaster` | `success` | 20,683 impressions, 877 clicks, CTR 4.240197263453077, average position 8.977179326016536 for 2026-06-26 to 2026-07-02. |
| `yandex_serp_rank` | `success` | 12 checked queries, 3 found, 9 missing. |
| `mock` | `skipped` | Not selected. |
| `sistrix` | `skipped` | Not selected. |
| `pagespeed` | `skipped` | Not selected in production source list. Local Lighthouse still ran as an extra collector. |
| `google_serp_rank` | `skipped` | Not selected. |

## Extra Collector Outputs

- Homepage snapshot: status 200, title and description present, H1 present, canonical present, 3,213 words.
- Sitemap: status 200, 4,637 URLs.
- Local Lighthouse: success; performance 64, accessibility 77, best practices 73, SEO 100; FCP 1456.798 ms, LCP 1745.343 ms, CLS 0.001133061883160318, TBT 354.973 ms.
- Yandex popular queries: 50 rows; max row impressions 99, 0 rows at or above 100 impressions.
- Yandex AI probes: 7 checked; target found/used in 1 branded probe, not found in 6 non-branded probes.

## SearchPerformance and Opportunity Engine

Artifacts:

- Normalized records: `reports/task-032-zaruku-search-performance-records-2026-07-05.json`
- Opportunity output: `reports/task-032-zaruku-opportunities-2026-07-05.json`

Result:

- Normalized SearchPerformance records: `12`
- Opportunity Engine opportunities: `0`

Manual review:

- Useful/questionable/noise: no generated opportunities to classify.
- Evidence quality: Yandex Webmaster aggregate evidence is useful, but normalized top-query records currently preserve ordered query names without per-query impressions/CTR/position.
- Additional raw `yandexQueries` has per-query metrics, but every row is below the default Opportunity Engine `minEvidenceImpressions` threshold of 100. Max observed row impressions: 99.
- Next action: keep zero-opportunity state as valid for this controlled run. Do not tune thresholds from one run.
- Should become draft task: no Opportunity Engine draft tasks should be created from this run.
- Missing data: per-query URL/page mapping and stable per-query performance rows in the SearchPerformance source would improve future opportunity quality.

## Weekly Top-10 and Reporting Export

Artifact:

- `reports/task-032-zaruku-reporting-export-2026-07-05.json`

Result:

- Schema: `seo_os_reporting_dashboard_export_v1`
- Included Weekly Top-10 items: `0`
- Watchlist items: `0`
- `noNewOpportunities`: `true`
- Snapshot counts: 0 opportunities, 4 draft tasks, 0 implementation tasks.
- Side effects: persisted `false`, sent `false`, productionPipelineRun `false`.

The export is useful as a dashboard zero-state contract: it confirms the read-only reporting boundary can represent a real run with draft tasks but no generated opportunities.

## Draft Task Manual Review

| Draft Task | Review | Evidence Quality | Next Action | Should Become Real Task |
| --- | --- | --- | --- | --- |
| `dbvIok5eC8HEtDRbiVWd` - Improve Yandex rankings for existing demand | Useful. The aggregate Yandex Webmaster signal is real and the average position is weak enough to justify investigation. | Medium. Good aggregate metrics, but no page-level mapping. | Manually map top Yandex queries to landing pages before implementation. | Yes, after page/query mapping. |
| `kf5lIYinJmSdeodjwhvH` - Connect Google Search Console for real query data | Useful tracking/integration task, but not a blocker for Yandex-only runs. | High for the failure state: `GSC_NOT_CONFIGURED`. | Fix access to `sc-domain:zaruku.ru` when GSC becomes in-scope. | Yes, but outside TASK-032. |
| `psr1QT09w3eKmOwo51lf` - Run PageSpeed audit for technical performance data | Questionable for this run because local Lighthouse succeeded, while production `pagespeed` source was simply not selected. | Medium. The skipped source status is true, but Lighthouse already gives technical performance data. | Decide later whether PageSpeed API is still required in addition to local Lighthouse. | Not yet. |
| `DJYfo3aE6HBtimSMdB1k` - Add a ranking source for visibility scoring | Questionable. Yandex SERP rank is connected, but visibility scoring still has null scores without a dedicated visibility provider. | Medium. The scoring gap is visible, but the recommendation still references a generic ranking source. | Revisit after deciding target visibility source. | Not yet. |

## Production Writes

The controlled production pipeline wrote through existing behavior only:

- Firestore `teams/qa-seo-team-1` via merge seed.
- Firestore `companies/qa-seo-company-zaruku` via merge seed.
- Firestore `seoCompanyConfigs` via `upsertSeoConfig`.
- Firestore `seoAnalysisRuns/yvt9fCTw2T9okKnb5EBZ`.
- Firestore `seoDraftTasks`:
  - `DJYfo3aE6HBtimSMdB1k`
  - `dbvIok5eC8HEtDRbiVWd`
  - `kf5lIYinJmSdeodjwhvH`
  - `psr1QT09w3eKmOwo51lf`
- Local report/log/artifact files listed above.

## Rollback or Cleanup

Safe to keep:

- Local report artifacts and log file.
- Firestore run and draft tasks as the first controlled QA production run for Zaruku.

Cleanup if needed:

- Delete `seoAnalysisRuns/yvt9fCTw2T9okKnb5EBZ`.
- Delete the four `seoDraftTasks` listed above.
- Review whether the seed `teams`, `companies`, and `seoCompanyConfigs` docs should remain. They are expected production runner seed state and were not introduced by TASK-032.

## Intentionally Not Changed

- No architecture changes.
- No Firestore schema changes.
- No storage/event/outbox changes.
- No Telegram production enablement.
- No scheduler.
- No auto-approval.
- No DataForSEO activation.
- No Metrica/MDP integration.
- No GSC dependency or activation.
- No threshold tuning based on this run.
- No LLM recommendation changes.
- No report schema changes.
- No production pipeline code changes.

## Recommended TASK-033

Add a read-only mapping/review boundary for Yandex metric-rich query rows into `SeoSearchPerformanceRecord` fixtures, without changing thresholds or production writes. The goal should be to decide whether `yandexQueries` should become an official SearchPerformance source before any opportunity-generation behavior changes.
