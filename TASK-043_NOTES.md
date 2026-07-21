# TASK-043 - QueryCluster v1

Date: 2026-07-07

## What Changed

- Added a pure QueryCluster v1 module:
  - `src/features/seoAgent/yandexQueryClusterReview.ts`
- Added a local review script:
  - `scripts/runYandexQueryClusterReview.ts`
- Added a fixture for the melanoma deduplication case:
  - `src/features/seoAgent/fixtures/yandexQueryClusterReview/inputRecords.json`
- Added direct tests:
  - `src/features/seoAgent/yandexQueryClusterReview.test.ts`
- Added Zaruku QueryCluster config:
  - `zarukuSeoProductionConfig.queryCluster`

## QueryCluster Rules

- Normalization is config-driven:
  - lowercase
  - `ё` to `е`
  - punctuation to whitespace
  - whitespace collapse
- Query matching is deterministic:
  - token-set Jaccard threshold: `0.6`
  - shared head token count: `2`
- No lemmatization.
- No transliteration.
- No LLM.
- No production writes.

## Artifact

Generated:

`reports/task-043-zaruku-yandex-query-cluster-review-2026-07-07.json`

Command:

```bash
node -r ts-node/register/transpile-only scripts/runYandexQueryClusterReview.ts \
  --serp-refresh reports/task-042-zaruku-target-class-serp-evidence-refresh-2026-07-06.json \
  --out reports/task-043-zaruku-yandex-query-cluster-review-2026-07-07.json
```

Summary:

- input records: `15`
- clusters: `12`
- clustered records: `12`
- clusters with URL evidence: `6`
- mixed-class clusters: `0`
- opportunities: `2`
- opportunities with target URL: `2`

## Gate Result

Gate config was not changed.

- status: `ready`
- record URL coverage: `0.5`
- opportunity URL coverage: `1.0`
- mismatched domain records: `0`

This fixes the TASK-042 failure direction without lowering thresholds:

- opportunity URL coverage moved from `0.5` to `1.0`
- required threshold remained `0.8`

## Melanoma Cluster

The melanoma variants now form one cluster:

- `подногтевая меланома фото`
- `подногтевая меланома на большом пальце ноги фото`
- `подногтевая меланома фото на руке`

Shared target URL:

`https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/`

URL evidence origin:

`подногтевая меланома на большом пальце ноги фото`

## Mixed-Class Handling

Runtime TASK-043 artifact has `0` mixed-class clusters.

Direct unit coverage verifies that mixed-class clusters are flagged and resolved by the existing TASK-041 semantic intent priority order. Example covered in tests:

- `гемотест рак лечение`
- `рак лечение`

Resolved class:

`competitor_brand`

## Tests

Passed:

```bash
npx vitest run src/features/seoAgent/yandexQueryClusterReview.test.ts src/features/seoAgent/semanticIntentClassifier.test.ts src/features/seoAgent/yandexSerpUrlEvidenceQualityGate.test.ts src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.test.ts
npx tsc --noEmit --pretty false
```

## Intentionally Not Changed

- Firestore writes.
- Storage schema.
- Telegram delivery.
- Scheduler behavior.
- Production pipeline.
- GSC, DataForSEO, Metrica, Yandex provider behavior.
- LLM behavior.
- Existing gate thresholds.
- Existing opportunity engine thresholds.
- Existing report format.
- Heuristic query-to-page branch.

## Recommended Next Task

Proceed to TASK-044 - First Live Weekly Digest (Dev Mode).
