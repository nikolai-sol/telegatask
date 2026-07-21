# TASK-035 - Query-to-Page Evidence Review Boundary

Date: 2026-07-05

## Objective

Add a local, fixture-first query-to-page evidence review boundary for Yandex data. The boundary should propose likely target URLs only from existing SERP/rank/page evidence and must not create production tasks, change Opportunity Engine thresholds, or write to storage.

## Changed Files

- `src/features/seoAgent/yandexQueryToPageEvidenceReview.ts`
- `src/features/seoAgent/yandexQueryToPageEvidenceReview.test.ts`
- `src/features/seoAgent/fixtures/yandexQueryToPageEvidenceReview/inputRankChecks.json`
- `src/features/seoAgent/fixtures/yandexQueryToPageEvidenceReview/inputPage.json`
- `src/features/seoAgent/fixtures/yandexQueryToPageEvidenceReview/expectedReview.json`
- `TASK-035_NOTES.md`

## What Changed

- Added pure review function:
  - `reviewYandexQueryToPageEvidence`
- Input:
  - `SeoSearchPerformanceRecord[]`
  - optional Yandex SERP rank checks
  - optional homepage/page snapshot
- Output schema:
  - `seo_os_yandex_query_to_page_evidence_review_v1`
- Evidence rules:
  - Exact Yandex SERP rank match with `matchedUrl` -> high-confidence candidate URL.
  - Exact homepage `title`/`h1`/`description` match -> medium-confidence candidate URL.
  - Exact homepage `bodySample` match -> low-confidence candidate URL.
  - SERP not found -> negative evidence only, no candidate URL.
  - Missing exact rank/page evidence -> documented as missing evidence.

## Fixture Coverage

Fixtures cover:

- high-confidence URL from exact Yandex SERP `matchedUrl`;
- negative SERP evidence when target domain is not found;
- low-confidence homepage text hint;
- ignored non-Yandex/non-query records;
- no URL inference when evidence is missing.

## Local Review Against TASK-032/TASK-034 Data

One local review was run in-memory against:

- `reports/wgd-zaruku-cancer-portal-2026-07-05.json`
- `reports/task-034-zaruku-yandex-opportunity-review-2026-07-05.json`

Result:

- Reviewed query records: 50
- Candidate URLs: 0
- High confidence: 0
- Medium confidence: 0
- Low confidence: 0
- No candidate: 50

Interpretation:

- Current Yandex popular-query rows do not overlap exactly with current Yandex SERP rank tracking keywords.
- Homepage snapshot does not contain exact popular-query phrases.
- The boundary correctly refuses to infer URLs without evidence.

## What Was Intentionally Not Changed

- No production pipeline wiring.
- No local script was changed.
- No Firestore reads or writes.
- No storage schema changes.
- No report format changes.
- No Telegram delivery, scheduler or auto-approval.
- No GSC/DataForSEO/Metrica activation.
- No Opportunity Engine threshold tuning.
- No lemmatization or fuzzy URL inference.
- No production pipeline run.

## Risk Notes

- The boundary is conservative by design. It may return zero candidate URLs when rank tracking keywords and popular-query rows do not overlap.
- Query-to-page matching still needs richer page inventory or exact per-query landing-page data before it can safely improve production opportunities.
- `internalLinks` are intentionally not used for inference yet because current evidence lacks anchor text and page-level query relevance.

## Recommended TASK-036

Add a local report-mode integration that appends this query-to-page evidence review to the TASK-034 local Yandex opportunity review artifact. Keep it opt-in and local-only, with no production pipeline, Firestore, Telegram, scheduler or threshold changes.
