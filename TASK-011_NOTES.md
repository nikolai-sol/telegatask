# TASK-011 — Weekly Top-10 Generator / Non-Invasive Integration Boundary

## What Changed

- Added pure module `src/features/seoAgent/weeklyTop10Generator.ts`.
- Added tests in `src/features/seoAgent/weeklyTop10Generator.test.ts`.
- The generator accepts `SeoOpportunity[]` wrapped with lightweight weekly state metadata and returns a deterministic digest object.

## Contract

- Input: `WeeklyTop10OpportunityInput[]`.
- Output: `WeeklyTop10Digest`.
- No persistence, side effects, external API calls, Telegram sends, or production runner integration.
- Digest contains:
  - `items`
  - `watchlist`
  - `carriedOver`
  - `approvedStale`
  - `summary`

## Rules Covered

- Top items are ranked by deterministic score.
- Rejected and implemented opportunities are excluded.
- Carried-over items are marked separately and can still appear in top items.
- Approved-but-not-implemented items older than the configured window are surfaced in `approvedStale`.
- If no item clears the configured confidence threshold, the digest returns `noNewOpportunities: true` and a watchlist.

## Intentionally Not Changed

- Firestore was not touched.
- Storage schema was not changed.
- Event/outbox behavior was not introduced.
- Telegram was not touched.
- HTML reports were not changed.
- Production pipeline was not changed.
- GSC/Yandex providers were not changed.
- LLM behavior was not introduced or changed.
- Opportunity Engine v1 was not wired into `runSeoAnalysis`.
- Weekly digest was not scheduled or sent.
- Production pipeline was not run to avoid Firestore writes and live service/API calls.

## Verification

- `npx vitest run src/features/seoAgent/weeklyTop10Generator.test.ts`
- `npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`
- `npm test -- --run`
- `npx tsc --noEmit --pretty false`

## Recommended Next Task

Define the approval-state source for Weekly Top-10 inputs without changing storage schema, or explicitly approve the storage contract before persisting weekly digest state.
