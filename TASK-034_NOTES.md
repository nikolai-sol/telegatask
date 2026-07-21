# TASK-034 - Local Yandex Opportunity Review Script

Date: 2026-07-05

## Objective

Add a non-invasive local review script that reads a WGD JSON report, maps metric-rich `yandexQueries` through the TASK-033 SearchPerformance boundary, runs the current Opportunity Engine in dry-run mode, and writes a local review artifact only.

## Changed Files

- `scripts/runYandexOpportunityReview.ts`
- `src/features/seoAgent/yandexOpportunityReviewCli.ts`
- `src/features/seoAgent/yandexOpportunityReviewCli.test.ts`
- `src/features/seoAgent/fixtures/yandexOpportunityReview/wgdReport.json`
- `reports/task-034-zaruku-yandex-opportunity-review-2026-07-05.json`
- `TASK-034_NOTES.md`

## What Changed

- Added local opt-in script:
  - `scripts/runYandexOpportunityReview.ts`
- Added testable helper boundary:
  - `parseYandexOpportunityReviewCliOptions`
  - `buildYandexOpportunityReviewArtifact`
- Script input:
  - `--report <wgd-report.json>`
  - `--out <review.json>`
  - optional `--now <iso>`
  - optional `--market <market>`
  - optional `--language <language>`
- Script output schema:
  - `seo_os_yandex_opportunity_review_v1`
- Artifact includes:
  - source report path;
  - run/domain identity;
  - Yandex Webmaster metadata;
  - mapped SearchPerformance query records;
  - TASK-033 mapping review summary;
  - Opportunity Engine output;
  - explicit side-effect flags.

## Local Review Run

Command:

```bash
node -r ts-node/register/transpile-only scripts/runYandexOpportunityReview.ts \
  --report reports/wgd-zaruku-cancer-portal-2026-07-05.json \
  --out reports/task-034-zaruku-yandex-opportunity-review-2026-07-05.json \
  --now 2026-07-05T12:00:00.000Z \
  --market RU \
  --language ru
```

Result:

- Output: `reports/task-034-zaruku-yandex-opportunity-review-2026-07-05.json`
- Run ID: `yvt9fCTw2T9okKnb5EBZ`
- Domain: `zaruku.ru`
- Input `yandexQueries`: 50
- Mapped SearchPerformance records: 50
- Metric-rich records: 50
- Max impressions: 99
- Default Opportunity Engine `minEvidenceImpressions`: 100
- Records at or above default evidence threshold: 0
- Opportunities: 0
- Side effects:
  - `persisted: false`
  - `sent: false`
  - `productionPipelineRun: false`

## What Was Intentionally Not Changed

- Production Zaruku pipeline was not changed.
- Production pipeline was not run.
- Firestore/storage schema was not changed.
- No Firestore reads or writes were added.
- No report HTML/JSON production format was changed.
- No Telegram delivery, scheduler or auto-approval was added.
- No GSC, DataForSEO or Metrica activation was added.
- No Opportunity Engine threshold tuning was added.
- No LLM recommendation changes were added.
- `package.json` was not changed, so the script remains opt-in only.

## Risk Notes

- The review script can produce opportunities if a future WGD report contains Yandex popular-query rows above current default thresholds. That remains local-only until a later task explicitly wires the data source into production.
- Mapped records still do not contain target URLs. Opportunity `targetUrl` remains `null` unless a future query-to-page mapping boundary is added.
- Current Zaruku Yandex data is high quality enough for review, but still too thin for opportunity generation under default thresholds.

## Recommended TASK-035

Add a query-to-page evidence review boundary for Yandex data. It should remain local and fixture-first, using existing SERP/rank/page evidence to propose likely target URLs for mapped Yandex query records without creating production tasks or changing Opportunity Engine thresholds.
