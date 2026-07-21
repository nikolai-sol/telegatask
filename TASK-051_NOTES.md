# TASK-051 - Gap-Opportunity Clustering + Target Page Binding

## Scope Completed

- Updated `section_ranking_gap` assembly to group nearby RankHistory query variants inside the same section for target-page binding.
- Added target URL inheritance from deterministic SERP evidence:
  - `target_url_binding`
  - `target_url_binding_serp_position`
- Added cluster-level dedupe: one binding group produces one gap opportunity.
- Added digest v2 distinction:
  - `Тип gap: доработать существующую страницу`
  - `Тип gap: страницы нет - кандидат на новый контент`
- Added config field:
  - `sectionRankTracking.targetUrlBindingMinSharedTokens = 2`
- Updated weekly/local review scripts to pass binding evidence into the digest renderer.

## W28 Melanoma Result

Before TASK-051, W28 produced separate melanoma items:

- `меланома на ногте фото`
- `подногтевая меланома фото`

Both shipped with `targetUrl: null`.

After TASK-051, the local W28 review artifact produces one melanoma opportunity:

```text
Закрыть ranking gap: меланома на ногте фото не найден в Яндекс SERP
```

Bound target URL:

```text
https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/
```

URL binding evidence:

```text
Target URL inherited from query variant "меланома ногтя фото" at Yandex SERP position 19.
```

Cluster keywords:

- `меланома на ногте фото`
- `меланома ногтя фото`
- `подногтевая меланома фото`

## Local Artifact

Generated:

- `reports/task-051-zaruku-gap-binding-review-2026-W28.json`

Summary:

- generated opportunities: `5`
- digest messages: `3`
- by section:
  - `/rak-molochnoj-zhelezy/`: `1`
  - `/melanoma/`: `1`
  - `/map/`: `1`
  - `/obraz_zhizni_pri_onkologii/`: `1`
  - `/content/`: `1`

Side effects:

- Firestore writes: `false`
- Telegram messages sent: `false`
- approval command executed: `false`
- production pipeline run: `false`
- live SERP calls: `false`

## Tests

Focused + golden:

```bash
npx vitest run \
  src/features/seoAgent/sectionRankingGapOpportunityEngine.test.ts \
  src/features/seoAgent/weeklyTop10TelegramApprovalMessageV2.test.ts \
  src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.test.ts \
  src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts
```

Result:

- `4` test files passed
- `15` tests passed

Build:

```bash
npm run build
```

Result: passed.

## Intentionally Not Changed

- No clustering threshold changes.
- No semantic classifier changes.
- No approval execution.
- No LLM enrichment.
- No rhythm-chain structure changes.
- No Metrika/GSC/DataForSEO changes.
- No Firestore writes.
- No Telegram sends.
- No production WGD pipeline run.
- No live SERP/rank-tracking run.

## Recommended Next Task

TASK-052 - Hermes Advisory Enrichment for Digest.
