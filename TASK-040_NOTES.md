# TASK-040 — SERP URL Evidence Quality Gate

## Scope

Added a read-only quality gate for SERP-derived query-to-URL evidence.

The gate evaluates whether TASK-039 evidence is ready for later automation. It does not create tasks, approve work, call APIs, or modify production behavior.

## Changed Files

- `src/features/seoAgent/yandexSerpUrlEvidenceQualityGate.ts`
  - Pure quality gate module.
  - Input:
    - SERP-enriched `SeoSearchPerformanceRecord[]`;
    - generated `SeoOpportunity[]`;
    - target domain and aliases;
    - optional gate config.
  - Output:
    - `YandexSerpUrlEvidenceQualityGateReport`.
  - Status values:
    - `ready`;
    - `review_required`;
    - `blocked`.
- `src/features/seoAgent/yandexSerpUrlEvidenceQualityGate.test.ts`
  - Fixture-based tests for quality gate output, mismatched-domain blocking, and explicit gate config.
- `src/features/seoAgent/fixtures/yandexSerpUrlEvidenceQualityGate/inputReview.json`
- `src/features/seoAgent/fixtures/yandexSerpUrlEvidenceQualityGate/expectedReport.json`
- `scripts/runYandexSerpUrlEvidenceQualityGate.ts`
  - Local script that reads a TASK-039 artifact and writes a TASK-040 quality gate artifact.
  - Does not call live APIs.
- `reports/task-040-zaruku-yandex-serp-url-evidence-quality-gate-2026-07-05.json`
  - Local review artifact.

## Gate Config

Default quality gate config:

- `minRecordUrlCoverageRatio: 0.5`
- `minOpportunityUrlCoverageRatio: 0.8`
- `maxMismatchedDomainRecords: 0`

These are quality-gate criteria only. Opportunity Engine thresholds were not changed.

## Local Review Run

Command:

```bash
node -r ts-node/register/transpile-only scripts/runYandexSerpUrlEvidenceQualityGate.ts \
  --serp-review reports/task-039-zaruku-yandex-serp-query-url-evidence-review-2026-07-05.json \
  --out reports/task-040-zaruku-yandex-serp-url-evidence-quality-gate-2026-07-05.json
```

Result:

- Gate status: `review_required`
- Eligible query records: 50
- Records with matched SERP URL: 8
- Record URL coverage: 0.16
- Opportunities: 10
- Opportunities with `targetUrl`: 2
- Opportunity URL coverage: 0.2
- Mismatched target-domain URLs: 0
- Page type counts:
  - homepage: 2
  - map_directory: 4
  - content_page: 2
  - other: 0
  - invalid_url: 0

Interpretation:

- Domain safety passes: all matched URLs belong to `zaruku.ru` or configured aliases.
- Automation readiness fails: URL coverage is too low for generated opportunities.
- Evidence quality needs manual review because most matched URLs are directory/homepage URLs, not content pages.

## Intentionally Not Changed

- No production pipeline integration.
- No Firestore writes.
- No storage schema changes.
- No event/outbox changes.
- No Telegram changes.
- No scheduler or auto-approval changes.
- No GSC, DataForSEO, Metrica or LLM changes.
- No Opportunity Engine threshold changes.
- No SERP collector changes.
- No new live API calls.
- No task creation or approval execution.
- No heuristic query-to-page branch resumed.

## Risks Found

- Current evidence is not ready for automated task generation.
- Only 2 of 10 opportunities have target URLs.
- Matched URL types suggest mixed intent:
  - location/provider directory pages;
  - homepage;
  - medical content pages.
- SERP position and Webmaster average position can differ materially because they are different measurements and must remain separate.

## Recommended TASK-041

Add a manual review shortlist/export for the `review_required` SERP evidence set:

- one row per opportunity;
- query metrics;
- target URL if present;
- page type;
- reason it failed the quality gate;
- manual decision field placeholder.

Keep it local/read-only and do not enable Telegram delivery or task creation yet.
