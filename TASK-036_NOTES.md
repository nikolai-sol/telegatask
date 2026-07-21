# TASK-036 - Append Query-to-Page Evidence to Local Yandex Review

Date: 2026-07-05

## Objective

Append the TASK-035 query-to-page evidence review into the TASK-034 local Yandex opportunity review artifact. Keep the workflow opt-in and local-only, with no production pipeline, Firestore, Telegram, scheduler, or threshold changes.

## Changed Files

- `src/features/seoAgent/yandexOpportunityReviewCli.ts`
- `src/features/seoAgent/yandexOpportunityReviewCli.test.ts`
- `src/features/seoAgent/fixtures/yandexOpportunityReview/wgdReport.json`
- `scripts/runYandexOpportunityReview.ts`
- `reports/task-034-zaruku-yandex-opportunity-review-2026-07-05.json`
- `TASK-036_NOTES.md`

## What Changed

- Extended `seo_os_yandex_opportunity_review_v1` local artifact with:
  - `queryToPageEvidence`
- The new section is produced by `reviewYandexQueryToPageEvidence`.
- The section uses only data already present in the WGD JSON report:
  - mapped Yandex SearchPerformance records;
  - `run.rankTracking.yandex.checks`;
  - `page` snapshot.
- CLI stdout now includes:
  - `queryToPageCandidateUrls`

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

- Mapped SearchPerformance records: 50
- Query-to-page reviewed queries: 50
- Candidate URLs: 0
- High confidence: 0
- Medium confidence: 0
- Low confidence: 0
- No candidate: 50
- Opportunities: 0
- Side effects:
  - `persisted: false`
  - `sent: false`
  - `productionPipelineRun: false`

## Interpretation

- The local artifact now carries query-to-page evidence review next to the Yandex opportunity review.
- The current Zaruku run still has no safe candidate URLs because Yandex popular queries do not exactly overlap with rank-tracking checks and homepage exact text evidence is not enough.
- The review stays conservative and does not alter opportunity `targetUrl`.

## What Was Intentionally Not Changed

- Production Zaruku pipeline was not changed.
- Firestore reads/writes were not added.
- Storage schema was not changed.
- HTML/production report format was not changed.
- Telegram delivery, scheduler, and auto-approval were not changed.
- GSC/DataForSEO/Metrica were not activated.
- Opportunity Engine thresholds were not changed.
- Query lemmatization, fuzzy matching, and URL inference were not added.
- `package.json` was not changed.
- Production pipeline was not run.

## Recommended TASK-037

Add a local page-inventory evidence fixture/boundary for query-to-page review. It should use sitemap/page inventory data to review candidate URL coverage without fuzzy matching, production writes, threshold tuning, or production pipeline changes.
