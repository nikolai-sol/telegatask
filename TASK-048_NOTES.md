# TASK-048 - Weekly Cron Wiring

Date: 2026-07-10

Status: completed.

## What Changed

- Added weekly rhythm coordinator:
  - `src/features/seoAgent/weeklySeoRhythm.ts`
- Added coordinator tests:
  - `src/features/seoAgent/weeklySeoRhythm.test.ts`
- Added Firestore run-state adapter:
  - `src/features/seoAgent/weeklySeoRhythmRepository.ts`
  - collection: `seoWeeklyRhythmRuns`
- Added orchestrating script:
  - `scripts/runWeeklySeoRhythm.ts`
- Added guarded scheduler hook:
  - `src/services/scheduler.ts`
  - schedule: `0 9 * * 1`
  - only registered when `SEO_WEEKLY_RHYTHM_CRON=1`
- Added Zaruku weekly budget config:
  - `sectionRankTracking.weeklyRunMaxSerpRequests = 50`

## Env

Configured locally:

```plain text
SEO_WEEKLY_RHYTHM_CRON=1
SEO_WEEKLY_RHYTHM_CLUSTER_REVIEW_PATH=reports/task-043-zaruku-yandex-query-cluster-review-2026-07-07.json
```

Existing flags still apply:

```plain text
SEO_RANK_HISTORY_WRITES=1
SEO_WEEKLY_TOP10_DEV_CHAT_ID=<configured>
```

## Idempotency

Week key:

```plain text
2026-W28
```

Run id:

```plain text
seo_weekly_2026-W28
```

Repeated same-week run returns `noop` before rank tracking or digest delivery. Live repeat returned the existing digest message ids:

```plain text
3024, 3025, 3026
```

RankHistory record ids include the stable weekly run id, so a resumed failed run overwrites the same weekly records rather than creating duplicate weekly RankHistory rows.

## Live Run

Command:

```bash
node -r ts-node/register/transpile-only scripts/runWeeklySeoRhythm.ts --out-dir reports
```

Artifact:

```plain text
reports/task-048-zaruku-weekly-seo-rhythm-2026-W28.json
```

Results:

- status: `completed`
- tracking list size: `13`
- SERP requests: `13`
- max SERP requests: `50`
- RankHistory records written: `13`
- generated `section_ranking_gap` opportunities: `5`
- digest v2 messages sent to dev chat: `3`
- digest message ids: `3024`, `3025`, `3026`

Opportunities by section:

- `/melanoma/`: `2`
- `/map/`: `1`
- `/obraz_zhizni_pri_onkologii/`: `1`
- `/content/`: `1`

Side effects:

- Firestore writes: `true`
- Telegram dev-chat messages: `true`
- approval command execution: `false`
- production pipeline run: `false`
- production chat delivery: `false`

## Repeat Run

The same command was run again for `2026-W28`.

Result:

- status: `noop`
- no SERP calls;
- no new RankHistory writes;
- no duplicate digest messages.

## Failure Simulation

Command:

```bash
node -r ts-node/register/transpile-only scripts/runWeeklySeoRhythm.ts \
  --out-dir reports \
  --now 2026-07-17T09:00:00.000Z \
  --simulate-failure-stage rank_tracking
```

Artifact:

```plain text
reports/task-048-zaruku-weekly-seo-rhythm-2026-W29.json
```

Result:

- status: `failed`
- failed stage: `rank_tracking`
- tracking list size: `13`
- SERP requests: `0`
- RankHistory writes: `0`
- digest messages: `0`
- service failure message sent to dev chat;
- no partial digest.

## Tests

Passed:

```bash
npx vitest run src/features/seoAgent/weeklySeoRhythm.test.ts src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts
npm test -- --run
npx tsc --noEmit --pretty false
```

Results:

- focused + golden: `2` files, `11` tests passed;
- full suite: `53` files, `173` tests passed;
- TypeScript: passed.

## Intentionally Not Changed

- No production chat delivery.
- No approval command execution.
- No Metrika, GSC, DataForSEO or LLM.
- No Engine/classifier/clustering/gate changes.
- No production WGD pipeline changes.

## Recommended Next Task

TASK-049 - Metrika layer for the Chapter 7.3 global report.
