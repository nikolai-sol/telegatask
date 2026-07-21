# TASK-045 - Approval Decision Persistence + Evidence-Rich Digest (RU)

Date: 2026-07-10

Status: completed in dev mode.

## What Changed

- Added durable approval decision model and pure persistence service:
  - `src/features/seoAgent/weeklyTop10ApprovalDecision.ts`
- Added Firestore repository adapter:
  - `src/features/seoAgent/weeklyTop10ApprovalDecisionRepository.ts`
- Added Russian evidence-rich Telegram digest template:
  - `src/features/seoAgent/weeklyTop10TelegramApprovalRuTemplate.ts`
  - `src/features/seoAgent/weeklyTop10TelegramApprovalMessageV2.ts`
- Added fixture-backed tests:
  - `src/features/seoAgent/fixtures/weeklyTop10ApprovalDecision/opportunities.json`
  - `src/features/seoAgent/weeklyTop10ApprovalDecision.test.ts`
  - `src/features/seoAgent/weeklyTop10TelegramApprovalMessageV2.test.ts`
- Added opt-in dev runner:
  - `scripts/runWeeklyTop10DevDigestV2.ts`
- Enabled local dev flags:
  - `SEO_WEEKLY_TOP10_DEV_CHAT_ID=2779103`
  - `SEO_WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_HANDLER=1`
  - `SEO_WEEKLY_TOP10_APPROVAL_DECISION_WRITES=1`

## Firestore Schema

Collection:

`seoWeeklyTop10ApprovalDecisions`

Document id:

`{teamId}_{opportunityId}`

Fields:

- `id`
- `teamId`
- `runId`
- `opportunityId`
- `clusterId`
- `draftTaskId`
- `decision`: `approved | rejected`
- `rejectReason`
- `reviewer.userId`
- `reviewer.telegramUserId`
- `decidedAt`
- `source`: `telegram_dev_callback`
- `callbackData`

Writes are allowed only when:

```plain text
SEO_WEEKLY_TOP10_APPROVAL_DECISION_WRITES=1
```

Flag off returns `writes_disabled` and performs no Firestore write.

## Live Digest V2

Source:

`reports/task-043-zaruku-yandex-query-cluster-review-2026-07-07.json`

Template language:

Russian.

The v2 message shows:

- query / cluster;
- intent class;
- target URL;
- Yandex Webmaster impressions;
- CTR;
- Webmaster average position;
- SERP position;
- medical-review flag;
- specific action text.

Default buttons:

- `Одобрить`
- `Отклонить`
- `Открыть`

`Convert` is absent by default and appears only with explicit `includeConvertButton`.

## Live Transcript

Final transcript:

`reports/task-045-zaruku-weekly-top10-approval-persistence-final-2026-07-10.json`

Initial TASK-045 run:

- run id: `t045r1233`
- sent message `3011`: `query_cluster_001`
- sent message `3012`: `query_cluster_002`
- captured approve callback for message `3011`
- persisted decision: `approved`

Second digest after the first decision:

- approved item excluded from included items;
- undecided Skolkovo item marked `carried_over`;
- included count: `1`;
- carried-over count: `1`.

Reject-only capture:

- run id: `t045reject43`
- sent message `3015`
- captured reject callback:
  - `seo10:v1:r:zaruku:t045reject43:reject1`
- persisted decision: `rejected`
- reject reason:
  - `Требует медицинского/редакторского ревью перед постановкой задачи.`

Final digest after both decisions:

- `подногтевая меланома фото`: `approved`
- `онкологический центр в сколково адрес`: `rejected`
- included count: `0`
- production pipeline run: `false`

## Idempotency

Real repository repeat-check:

- approved opportunity repeat returned `already_decided`
- rejected opportunity repeat returned `already_decided`
- repeat Firestore write: `false`

User-facing answers:

- `Уже решено: одобрено.`
- `Уже решено: отклонено.`

## Side Effects

Expected dev-mode side effects:

- Telegram dev messages sent: `true`
- Firestore writes to `seoWeeklyTop10ApprovalDecisions`: `true`

Not performed:

- approval command execution: `false`
- weekly digest persistence: `false`
- production pipeline run: `false`
- scheduler changes: `false`
- production delivery enable: `false`

## Verification

Passed:

```bash
npx vitest run src/features/seoAgent/weeklyTop10ApprovalDecision.test.ts src/features/seoAgent/weeklyTop10TelegramApprovalMessageV2.test.ts src/features/seoAgent/weeklyTop10TelegramApprovalMessage.test.ts src/features/seoAgent/weeklyTop10TelegramApprovalCallbackHandler.test.ts src/features/seoAgent/weeklyTop10TelegramApprovalResponse.test.ts src/features/seoAgent/weeklyTop10TelegramApprovalTelegrafAdapter.test.ts src/bot/weeklyTop10TelegramApprovalBotIntegration.test.ts
npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts
npm test -- --run
npx tsc --noEmit --pretty false
```

Results:

- focused tests: `7` files, `31` tests passed;
- golden baseline: `6` tests passed;
- full suite: `50` files, `160` tests passed;
- TypeScript: passed.

## Intentionally Not Changed

- Approval command execution was not enabled.
- Scheduler was not changed.
- Production Telegram delivery was not enabled.
- Weekly digest persistence was not added.
- Opportunity thresholds were not changed.
- Intent classifier and clustering logic were not changed.
- GSC, DataForSEO, Metrica, Yandex providers and LLM were not changed.
- Existing v1 Telegram callback contract remains compatible.

## Recommended Next Task

TASK-046 - section-level rank tracking cron contract: Chapter 6.2 clusters -> weekly SERP checks -> RankHistory -> dashboard export.
