# TASK-008 — Safe GSC Activation Path for Zaruku

## What Changed

- Enabled the Zaruku Google Search Console property in production config:
  - `gscSiteUrl: "sc-domain:zaruku.ru"`
  - `selectedSources` now includes `gsc`
- Changed selected-but-not-configured GSC execution from `failed` to `skipped`.
- Added tests for:
  - Zaruku production config GSC activation path.
  - `runSeoAnalysis` behavior when `gsc` is selected but Google credentials are missing.

## Behavior Preserved

- Missing GSC credentials do not crash the run when other selected sources produce usable data.
- Missing GSC credentials produce:
  - `source: "gsc"`
  - `status: "skipped"`
  - `errorCode: "GSC_NOT_CONFIGURED"`
- Successful GSC provider behavior is unchanged.
- Provider errors after configuration still remain `failed`.

## Intentionally Not Changed

- No storage schema changes.
- No event/outbox behavior was introduced.
- Firestore write behavior was not changed.
- GSC OAuth flow was not modified.
- GSC provider API/query logic was not changed.
- `seoAgentService.ts` was not refactored beyond the minimal GSC not-configured status change.
- Report schema and field names were not changed.
- HTML report renderer/copy was not changed.
- Existing Zaruku collectors were not changed.
- Production pipeline was not run to avoid Firestore writes and live service/API calls.

## Verification

- `npx vitest run src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.test.ts src/features/seoAgent/seoAgentService.gsc.test.ts`
- `npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`
- `npx vitest run src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.test.ts src/features/seoAgent/seoAgentService.gsc.test.ts src/features/seoAgent/production/zaruku/zarukuWgdRunnerHelpers.test.ts src/features/seoAgent/production/zaruku/collectors/homepageSnapshotCollector.test.ts src/features/seoAgent/production/zaruku/collectors/sitemapSummaryCollector.test.ts src/features/seoAgent/production/zaruku/collectors/localLighthouseCollector.test.ts src/features/seoAgent/production/zaruku/collectors/yandexGenSearchProbeCollector.test.ts src/features/seoAgent/production/zaruku/collectors/yandexPopularQueriesCollector.test.ts`
- `npm test -- --run`
- `npx tsc --noEmit --pretty false`

## Recommended Next Task

Extract Zaruku HTML report rendering from the production pipeline into a renderer module while preserving the existing HTML output structure.
