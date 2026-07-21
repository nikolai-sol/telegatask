# TASK-047 - Section Ranking Gap Opportunities

Date: 2026-07-10

Status: completed in local opt-in mode.

## What Changed

- Added deterministic RankHistory-to-opportunity engine:
  - `src/features/seoAgent/sectionRankingGapOpportunityEngine.ts`
- Added local opt-in review runner:
  - `scripts/runSectionRankingGapOpportunityReview.ts`
- Extended RankHistory read adapter:
  - `listSeoRankHistoryRecords`
- Extended opportunity type union:
  - `section_ranking_gap`
- Extended digest v2 preview evidence:
  - section line;
  - seed/member queries line;
  - distinct `section_ranking_gap` action text.
- Updated section dashboard delta behavior:
  - configurable smoothing window;
  - `not_found` is treated as `no_data`, not as a drop.

## Config

TASK-047 thresholds/windows are config-owned:

```plain text
sectionRankTracking.rankSmoothingRuns = 2
sectionRankTracking.sectionRankingGapMaxPosition = 20
sectionRankTracking.decisionCooldownDays = 30
```

Section priorities are also config-owned:

- `/melanoma/`: `1`
- `/rak-molochnoj-zhelezy/`: `1`
- `/rak-pecheni/`: `1`
- `/map/`: `2`
- `/obraz_zhizni_pri_onkologii/`: `3`

## Gap Rule

`section_ranking_gap` is generated when a target cluster has:

- no matched position in the latest `rankSmoothingRuns` RankHistory records; or
- latest found SERP position worse than `sectionRankingGapMaxPosition`.

`not_found` is a proactive gap signal. It is not a `rank_drop_alert`.

## Cooldown Rule

Clusters with an approval/reject decision inside `decisionCooldownDays` do not resurface as new gap opportunities.

This is covered by fixture tests. The live TASK-047 run loaded `0` approval decisions for the configured team, so no live item was suppressed by cooldown.

## Local Review Run

Command:

```bash
node -r ts-node/register/transpile-only scripts/runSectionRankingGapOpportunityReview.ts \
  --out reports/task-047-zaruku-section-ranking-gap-opportunity-review-2026-07-10.json \
  --run-id task047_gap_review_20260710
```

Artifact:

`reports/task-047-zaruku-section-ranking-gap-opportunity-review-2026-07-10.json`

Results:

- RankHistory records read: `26`
- approval decisions read: `0`
- clusters evaluated: `13`
- generated `section_ranking_gap` opportunities: `6`
- digest v2 included items: `4`
- digest v2 watchlist items: `2`

Opportunities by section:

- `/melanoma/`: `2`
- `/map/`: `2`
- `/obraz_zhizni_pri_onkologii/`: `1`
- `/content/`: `1`

## Side Effects

Performed:

- Firestore reads from RankHistory and ApprovalDecision collections.

Not performed:

- Firestore writes;
- Telegram sends;
- approval command execution;
- scheduler/cron changes;
- production pipeline run.

## Verification

Passed:

```bash
npx vitest run src/features/seoAgent/sectionRankingGapOpportunityEngine.test.ts src/features/seoAgent/sectionRankTracking.test.ts src/features/seoAgent/weeklyTop10TelegramApprovalMessageV2.test.ts src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.test.ts
npx tsc --noEmit --pretty false
```

Full/golden verification was run after notes were created.

Results:

- focused + baseline: `5` files, `17` tests passed;
- full suite: `52` files, `168` tests passed;
- TypeScript: passed.

## Intentionally Not Changed

- No cron/scheduler wiring.
- No approval execution.
- No Telegram live send.
- No Metrika, GSC, DataForSEO or LLM work.
- No classifier, clustering, gate or existing Opportunity Engine threshold changes.
- No production WGD pipeline/default behavior changes.

## Recommended Next Task

TASK-048 - weekly cron wiring for the 7.2 rhythm:

```plain text
tracking run -> RankHistory -> section_ranking_gap review -> digest v2
```

Metrika report layer should follow as TASK-049.
