# TASK-037 - Page Inventory Evidence Boundary

Date: 2026-07-05

## Objective

Add a local page-inventory evidence boundary for Yandex query-to-page review. The boundary uses sitemap/page inventory URLs to review candidate URL coverage without fuzzy matching, production writes, threshold tuning, or production pipeline changes.

## Changed Files

- `src/features/seoAgent/yandexPageInventoryEvidenceReview.ts`
- `src/features/seoAgent/yandexPageInventoryEvidenceReview.test.ts`
- `src/features/seoAgent/fixtures/yandexPageInventoryEvidenceReview/inputInventoryUrls.json`
- `src/features/seoAgent/fixtures/yandexPageInventoryEvidenceReview/expectedReview.json`
- `TASK-037_NOTES.md`

## What Changed

- Added pure review function:
  - `reviewYandexPageInventoryEvidence`
- Input:
  - `SeoSearchPerformanceRecord[]`
  - page inventory URLs
- Output schema:
  - `seo_os_yandex_page_inventory_evidence_review_v1`
- Matching rule:
  - Decode inventory URL.
  - Normalize URL and query by lowercasing and replacing separators with spaces.
  - Candidate URL is emitted only when the decoded URL contains the exact normalized query phrase.
- Confidence:
  - Exact inventory URL phrase match -> `medium`
  - No exact match -> `none`

## Fixture Coverage

Fixtures cover:

- exact Cyrillic query phrase in encoded inventory URL;
- deduped inventory count;
- ignored non-Yandex/non-query records;
- transliterated URL not treated as evidence for a Cyrillic query;
- no lemmatization, transliteration, fuzzy matching, or section inference.

## Local Review Against Current Zaruku Artifacts

One local in-memory review was run against:

- SearchPerformance records from `reports/task-034-zaruku-yandex-opportunity-review-2026-07-05.json`
- Sitemap sampled URLs from `reports/wgd-zaruku-cancer-portal-2026-07-05.json`

Result:

- Inventory URLs reviewed: 40
- Unique inventory URLs: 40
- Yandex query records reviewed: 50
- Candidate URLs: 0
- Medium confidence: 0
- No candidate: 50

Interpretation:

- Current sitemap sample is mostly `/map/` URLs and does not contain exact popular-query phrases.
- The boundary correctly refuses transliteration/fuzzy inference.
- A broader page inventory would be needed before this boundary can improve query-to-page coverage.

## What Was Intentionally Not Changed

- TASK-034 local script was not changed.
- TASK-036 artifact shape was not changed.
- Production Zaruku pipeline was not changed.
- Production pipeline was not run.
- Firestore reads/writes were not added.
- Storage schema was not changed.
- HTML/production report format was not changed.
- Telegram delivery, scheduler, and auto-approval were not changed.
- GSC/DataForSEO/Metrica were not activated.
- Opportunity Engine thresholds were not changed.
- Query lemmatization, transliteration, fuzzy matching, and section inference were not added.

## Recommended TASK-038

Add an opt-in local integration that appends page-inventory evidence to the local Yandex review artifact, behind the existing `runYandexOpportunityReview` script path. Keep it local-only and do not modify production pipeline, Firestore, Telegram, scheduler, or thresholds.
