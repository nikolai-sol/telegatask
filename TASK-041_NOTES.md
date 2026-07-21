# TASK-041 — Deterministic Intent Classifier

## Scope

Added a pure deterministic query intent classifier based on SEO OS Chapter 6 Semantic Profile.

The classifier is config-driven, token/pattern based, and used only in local review paths. It does not use LLMs, lemmatization, storage writes, Telegram, or production pipeline defaults.

## Changed Files

- `src/features/seoAgent/semanticIntentClassifier.ts`
  - Pure `query -> intentClass` classifier.
  - Output includes:
    - `intentClass`;
    - `matchedTokens`;
    - `isTarget`;
    - `rule`.
  - Conflict priority is explicit:
    - `drug_compliance > competitor_brand > own_brand > facility_navigational > medical_informational > supportive_trust > off_mission`.
- `src/features/seoAgent/semanticIntentClassifier.test.ts`
- `src/features/seoAgent/fixtures/semanticIntentClassifier/inputQueries.json`
- `src/features/seoAgent/fixtures/semanticIntentClassifier/expectedClassifications.json`
- `src/features/seoAgent/yandexIntentFilteredOpportunityReview.ts`
  - Local review boundary that classifies Yandex query records.
  - Filters target classes before Opportunity Engine.
  - Builds `competitor_brand`, `drug_compliance`, `own_brand`, and `off_mission` monitoring buckets.
  - Rebuilds SERP top-N query expansion from target classes only.
- `src/features/seoAgent/yandexIntentFilteredOpportunityReview.test.ts`
- `src/features/seoAgent/fixtures/yandexIntentFilteredOpportunityReview/inputRecords.json`
- `src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.ts`
  - Added Chapter 6 semantic config token lists.
- `src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.test.ts`
  - Protects semantic config defaults.
- `scripts/runYandexIntentFilteredOpportunityReview.ts`
  - Local TASK-041 review script reading TASK-038 artifact.
- `scripts/runYandexSerpQueryUrlEvidenceReview.ts`
  - Future opt-in SERP review now filters top-N query expansion and opportunity input records by target intent classes.
- `reports/task-041-zaruku-yandex-intent-filtered-opportunity-review-2026-07-06.json`
  - Local review artifact.

## Classifier Rules

Target classes:

- `medical_informational`
- `facility_navigational`
- `supportive_trust`

Excluded / non-opportunity classes:

- `drug_compliance`
- `competitor_brand`
- `own_brand`
- `off_mission`

Unmatched queries become `off_mission`. They are not silently treated as target opportunities.

Drug tokens are seeded from common oncology/Roche-related drug names and must be reviewed with client compliance before broader use.

## Fixture Coverage

Protected examples:

- `гемотест орел победа 1` -> `competitor_brand`
- `онкологический центр в сколково адрес` -> `facility_navigational`
- `подногтевая меланома фото` -> `medical_informational`
- `за руку` -> `own_brand`
- `ритуксимаб цена` -> `drug_compliance`
- unmatched query -> `off_mission`
- conflict priority: competitor brand wins over medical tokens.

## Local Review Run

Command:

```bash
node -r ts-node/register/transpile-only scripts/runYandexIntentFilteredOpportunityReview.ts \
  --history-review reports/task-038-zaruku-yandex-28d-query-history-review-2026-07-05.json \
  --out reports/task-041-zaruku-yandex-intent-filtered-opportunity-review-2026-07-06.json
```

Result:

- Input query records: 50
- Target query records: 15
- Excluded query records: 35
- Opportunities before filtering: 10
- Opportunities after filtering: 2

Class counts:

- `drug_compliance`: 0
- `competitor_brand`: 30
- `own_brand`: 1
- `facility_navigational`: 3
- `medical_informational`: 12
- `supportive_trust`: 0
- `off_mission`: 4

Filtered opportunities:

- `подногтевая меланома фото`
- `онкологический центр в сколково адрес`

Competitor-brand result:

- 30 competitor-brand queries moved to monitoring bucket.
- Competitor-brand queries produce zero opportunities after filtering.

SERP top-N expansion:

- Configured top-N: 30
- Excluded top-N candidates: 20
- Target top query keywords: 15
- Target top-N request count: 15

No live SERP rerun was performed for TASK-041. The updated opt-in SERP review script will use target-class filtering before future live requests.

## Intentionally Not Changed

- No LLM classification.
- No lemmatization.
- No Opportunity Engine threshold changes.
- No production pipeline defaults changed.
- No Firestore writes.
- No storage/schema changes.
- No Telegram, scheduler or auto-approval changes.
- No GSC, DataForSEO, Metrica or LLM provider changes.
- No heuristic query-to-page branch resumed.

## Risks / Notes

- Token lists are deterministic but incomplete by design. They should evolve via versioned config changes.
- Facility classification currently requires both facility token and geo token.
- Drug compliance token list is a seed and requires client/legal review before being considered final.
- The two remaining opportunities still need URL evidence from a future filtered SERP run before task automation can be reconsidered.

## Recommended TASK-042

Run an opt-in filtered SERP URL evidence refresh using only target-class top queries from TASK-041, then rerun the TASK-040 quality gate on the filtered result. This should reduce SERP spend and measure whether target opportunity URL coverage improves.
