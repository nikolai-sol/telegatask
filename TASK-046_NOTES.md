# TASK-046 - Section-Level Rank Tracking

Date: 2026-07-10

Status: completed in local opt-in mode.

## What Changed

- Added pure section rank tracking module:
  - `src/features/seoAgent/sectionRankTracking.ts`
- Added RankHistory Firestore adapter:
  - `src/features/seoAgent/sectionRankHistoryRepository.ts`
- Added local opt-in runner:
  - `scripts/runSectionRankTracking.ts`
- Added fixtures and tests:
  - `src/features/seoAgent/fixtures/sectionRankTracking/liveClusters.json`
  - `src/features/seoAgent/sectionRankTracking.test.ts`
- Added Zaruku rank tracking config:
  - `zarukuSeoProductionConfig.sectionRankTracking`

## Config

All TASK-046 thresholds and seed clusters live in Zaruku config.

```plain text
sectionRankTracking.maxSerpRequestsPerRun = 50
sectionRankTracking.alertDropThreshold = 5
sectionRankTracking.estimatedCostPerRequestRub = null
```

Seed clusters include Chapter 6.2 sections:

- `/melanoma/`
- `/rak-molochnoj-zhelezy/`
- `/rak-pecheni/`
- `/map/`
- `/obraz_zhizni_pri_onkologii/`

## RankHistory Schema

Collection:

`seoRankHistory`

Writes require:

```plain text
SEO_RANK_HISTORY_WRITES=1
```

Fields:

- `id`
- `teamId`
- `runId`
- `domain`
- `searchEngine`
- `provider`
- `clusterId`
- `query`
- `section`
- `intentClass`
- `checkedAt`
- `serpPosition`
- `found`
- `matchedUrl`
- `topResultDomains`
- `region`
- `language`
- `device`

SERP position provenance is stored separately and is not merged with Yandex Webmaster averagePosition.

## Dashboard Export Contract

Schema:

`seo_os_rank_history_dashboard_export_v1`

The export contains:

- per-section current positions;
- previous positions;
- deltas;
- section coverage;
- global coverage;
- `rank_drop_alert` records when current position worsens by at least the configured threshold.

Alerts are dashboard records only. They are not opportunities and are not sent to the digest.

## Live Runs

Source cluster artifact:

`reports/task-043-zaruku-yandex-query-cluster-review-2026-07-07.json`

Run 1:

`reports/task-046-zaruku-section-rank-tracking-run1-2026-07-10.json`

- tracking list size: `13`
- request count: `13`
- rank checks: `13`
- found count: `6`
- previous records: `0`
- RankHistory records written: `13`
- coverage: `0.461538`
- alert count: `0`

Run 2:

`reports/task-046-zaruku-section-rank-tracking-run2-2026-07-10.json`

- tracking list size: `13`
- request count: `13`
- rank checks: `13`
- found count: `5`
- previous records: `13`
- RankHistory records written: `13`
- coverage: `0.384615`
- alert count: `0`

Observed live deltas:

- `онкологический центр в сколково адрес`: `11 -> 13`, delta `+2`
- `инвалидность при онкологии молочной железы кому положена`: `3 -> 4`, delta `+1`
- `инвалидность при раке молочной железы`: `8 -> 6`, delta `-2`
- `первая группа с раком печени рабочая`: `2 -> 2`, delta `0`

No live delta crossed the configured drop threshold of `5`.

## Cost

Cost basis:

- one Yandex Search API request per tracked cluster query;
- run 1 requests: `13`;
- run 2 requests: `13`;
- estimated cost per request: `null`;
- estimated cost: `null`.

## Alert Rule

Fixture test covers:

- previous position `6`;
- current position `12`;
- delta `+6`;
- threshold `5`;
- emits `rank_drop_alert`.

Live export had no alert.

## Side Effects

Expected TASK-046 side effects:

- live Yandex Search API calls: `true`;
- Firestore writes to `seoRankHistory`: `true`.

Not performed:

- Telegram messages: `false`;
- approval command execution: `false`;
- weekly digest persistence: `false`;
- production pipeline run: `false`;
- scheduler/cron wiring: `false`.

## Verification

Passed:

```bash
npx vitest run src/features/seoAgent/sectionRankTracking.test.ts src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.test.ts src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts
npm test -- --run
npx tsc --noEmit --pretty false
```

Results:

- focused + baseline: `3` files, `10` tests passed;
- full suite: `51` files, `163` tests passed;
- TypeScript: passed.

## Intentionally Not Changed

- Scheduler/cron wiring was not added.
- Telegram digest was not changed.
- Approval flow was not changed.
- Opportunity thresholds were not changed.
- Intent classifier and clustering logic were not changed.
- GSC, DataForSEO, Metrika and LLM were not touched.
- Production pipeline defaults were not changed.

## Recommended Next Task

TASK-047 should either wire a weekly cron only after one more clean local tracking run, or add the Metrika layer for the Chapter 7.3 global report. The first dashboard export suggests the immediate visibility gap is traffic/engagement context for sections where SERP coverage is missing.
