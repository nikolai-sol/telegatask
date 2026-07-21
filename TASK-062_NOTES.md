# TASK-062 - GSC Weekly Pipeline Inclusion

## Changed

- Added an optional `search_performance` stage to the weekly SEO rhythm core.
- Wired the Zaruku weekly rhythm CLI to collect Google Search Console through the existing `GoogleSearchConsoleSeoSource`.
- Normalized the GSC snapshot into existing `SeoSearchPerformanceRecord[]`.
- Added the GSC search performance artifact to the weekly rhythm artifact.
- Added `layers.searchPerformance` to the Global Report assembly.

## Current Live GSC Smoke

Read-only provider smoke succeeded on 2026-07-17:

- Property: `https://zaruku.ru/`
- Window: `2026-06-17` to `2026-07-14`
- Clicks: `264`
- Impressions: `16730`
- CTR: `1.5780035863717874`
- Average position: `2.920322773460849`
- Normalized records: `34`
- Generated opportunities: `0`

`generatedOpportunities` is currently `0` because the existing GSC snapshot contract stores query/page dimension values as ordered lists, not row-level metrics. The next safe extraction is to preserve GSC row metrics in the search-performance contract.

## Intentionally Not Changed

- No Telegram approval behavior changes.
- No rank-gap scoring changes.
- No Firestore schema changes.
- No MySQL dashboard schema changes.
- No production WGD pipeline run.
- No Yandex provider changes.

## Verification

- `npx vitest run src/features/seoAgent/weeklySeoRhythm.test.ts src/features/seoAgent/globalReportAssembler.test.ts`
- `npm run build`
- `npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`
- `npm test -- --run`
- Read-only GSC provider smoke via `GoogleSearchConsoleSeoSource`

## Recommended Next Task

TASK-063 - Preserve GSC row-level query/page metrics so the existing search-performance opportunity engine can create Google CTR/ranking opportunities from real per-query evidence.
