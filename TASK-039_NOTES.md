# TASK-039 — SERP-Based Query-to-URL Evidence

## Scope

Implemented a local, opt-in SERP evidence boundary that maps exact `yandex_serp_rank` matched URLs back onto Yandex Webmaster query records.

No production pipeline defaults were changed.

## Changed Files

- `src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.ts`
  - Added config-owned SERP query-to-URL evidence controls:
    - `yandexSerpQueryUrlEvidenceEnabled: false`
    - `yandexSerpQueryUrlEvidenceTopN: 30`
    - `yandexSerpQueryUrlEvidenceEstimatedCostPerRequestRub: null`
- `src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.test.ts`
  - Protects the config defaults.
- `src/features/seoAgent/yandexSerpQueryUrlEvidenceMapper.ts`
  - Pure mapper from `SeoSearchPerformanceRecord[] + YandexRankCheck[]` to records with SERP URL evidence.
  - Populates `record.page` only when an exact query SERP rank check has `found: true` and `matchedUrl`.
  - Keeps SERP position in `serpUrlEvidence.serpPosition`.
  - Does not overwrite or merge `averagePosition`.
- `src/features/seoAgent/yandexSerpQueryUrlEvidenceMapper.test.ts`
  - Fixture-based golden tests for URL mapping and non-Yandex isolation.
- `src/features/seoAgent/fixtures/yandexSerpQueryUrlEvidence/inputRankChecks.json`
- `src/features/seoAgent/fixtures/yandexSerpQueryUrlEvidence/expectedReview.json`
- `scripts/runYandexSerpQueryUrlEvidenceReview.ts`
  - Local opt-in review script.
  - Reads TASK-038 Yandex 28d query history review artifact.
  - Expands base tracking keywords with top-N popular queries from config.
  - Runs existing `YandexSerpRankSource`.
  - Writes a local JSON review artifact only.
- `reports/task-039-zaruku-yandex-serp-query-url-evidence-review-2026-07-05.json`
  - Local run artifact.

## Local Review Run

Command:

```bash
node -r ts-node/register/transpile-only scripts/runYandexSerpQueryUrlEvidenceReview.ts \
  --history-review reports/task-038-zaruku-yandex-28d-query-history-review-2026-07-05.json \
  --out reports/task-039-zaruku-yandex-serp-query-url-evidence-review-2026-07-05.json \
  --enable-serp-query-url-evidence
```

Result:

- Base tracking keywords: 12
- Top popular queries requested by config: 30
- Expanded keyword count after dedupe: 41
- Yandex Search API request count: 41
- SERP rank checks returned: 41
- Found target domain checks: 10
- SearchPerformance records with matched SERP URL: 8 of 50
- Opportunity count after URL evidence: 10
- Opportunities with `targetUrl`: 2 of 10
- Side effects:
  - persisted: false
  - sent: false
  - productionPipelineRun: false

Cost:

- Request count is documented as 41.
- `yandexSerpQueryUrlEvidenceEstimatedCostPerRequestRub` is `null`, so estimated cost is intentionally not calculated in code.

## Evidence Contract

- Input:
  - `SeoSearchPerformanceRecord[]`
  - `YandexRankCheck[]`
- Output:
  - `YandexSerpQueryUrlEvidenceReview`
  - `records[]` remain SearchPerformance-compatible.
  - SERP URL evidence is attached as optional `serpUrlEvidence`.

SERP-derived position is explicitly not merged with Yandex Webmaster `averagePosition`.

## Intentionally Not Changed

- No Firestore writes.
- No storage schema changes.
- No event/outbox changes.
- No Telegram changes.
- No scheduler or auto-approval changes.
- No GSC, DataForSEO, Metrica or LLM changes.
- No production runner integration.
- No threshold changes.
- No heuristic query-to-page branch resumed.
- No lemmatization.
- No HTML report changes.

## Risk Notes

- The local script makes one Yandex Search API request per expanded keyword. Keep top-N config conservative while quota/cost is still manually managed.
- URL coverage improved only where SERP found the target domain in the checked result window. Missing URLs are preserved as `null`.
- Current matched URLs show that some popular queries map to directory/location pages, which should be reviewed before turning this into any automated task source.

## Recommended TASK-040

Create a read-only SERP evidence evaluation report that compares:

- Yandex Webmaster query metrics;
- SERP matched URL;
- opportunity target URL coverage;
- query intent/page type categories;

without creating tasks or changing thresholds.
