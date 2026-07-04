# TASK-006 — Runner Orchestration Boundary

## What Changed

- Extracted the Zaruku production pipeline from `scripts/runWgdZarukuCancerPortal.ts` into `src/features/seoAgent/production/zaruku/zarukuWgdProductionPipeline.ts`.
- Kept `scripts/runWgdZarukuCancerPortal.ts` as the production entrypoint.
- The script now only loads `dotenv`, invokes `runZarukuWgdProductionPipeline`, prints the same JSON summary shape, handles errors, and preserves the delayed `process.exit` behavior.
- The production pipeline module owns the current pipeline assembly: Firestore seed writes, SEO config upsert, collector execution, `runSeoAnalysis`, draft task loading, JSON report writing, and HTML report writing.

## Output Contract Preserved

- JSON report payload still contains:
  - `run`
  - `draftTasks`
  - `page`
  - `sitemap`
  - `lighthouse`
  - `yandexQueries`
  - `aiProbes`
- HTML report rendering is unchanged.
- CLI stdout summary still contains:
  - `runId`
  - `draftTaskCount`
  - `jsonPath`
  - `htmlPath`

## Hardcoded Values That Remain

- Zaruku scenario constants remain centralized in `zarukuSeoProductionConfig.ts`.
- Report copy and HTML template remain inside the Zaruku production pipeline because TASK-006 only creates the runner boundary, not a report-renderer extraction.
- Yandex Webmaster popular query collection remains inside the pipeline module because TASK-006 does not extract a new collector.

## Intentionally Not Changed

- GSC was not activated.
- Storage schema was not changed.
- Event/outbox behavior was not introduced.
- Firestore write behavior was not changed.
- `seoAgentService.ts` was not refactored.
- Provider classes were not moved.
- Existing collectors were not changed.
- Draft task generation and recommendations were not changed.
- Report schema and field names were not changed.
- Production pipeline was not run to avoid Firestore writes and live service/API calls.

## Verification

- `npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`
- `npx vitest run src/features/seoAgent/production/zaruku/zarukuWgdRunnerHelpers.test.ts src/features/seoAgent/production/zaruku/collectors/homepageSnapshotCollector.test.ts src/features/seoAgent/production/zaruku/collectors/sitemapSummaryCollector.test.ts src/features/seoAgent/production/zaruku/collectors/localLighthouseCollector.test.ts src/features/seoAgent/production/zaruku/collectors/yandexGenSearchProbeCollector.test.ts`
- `npm test -- --run`
- `npx tsc --noEmit --pretty false`

## Recommended TASK-007

Extract Yandex Webmaster popular queries into a collector-style module behind the existing `yandexQueries` output contract.
