# TASK-005 Notes

Date: 2026-07-03

## What Changed

- Added a collector-style module for the runner-owned Yandex generative search probes.
- Updated `scripts/runWgdZarukuCancerPortal.ts` to delegate `aiProbes` collection to that module.
- Added direct unit tests for checked, not-configured, permission-denied, failed, and throttled multi-query behavior.

## Files Changed

- `scripts/runWgdZarukuCancerPortal.ts`
- `src/features/seoAgent/production/zaruku/collectors/yandexGenSearchProbeCollector.ts`
- `src/features/seoAgent/production/zaruku/collectors/yandexGenSearchProbeCollector.test.ts`
- `TASK-005_NOTES.md`

## Collector Extracted

- `collectYandexGenSearchProbes`
  - Input: Zaruku config subset with AI probe channel, queries, target domain, and throttle.
  - Optional inputs: env adapter, fetch adapter, sleep adapter.
  - Output: same `YandexAiProbe[]` shape currently written as `aiProbes`.
  - Runtime behavior preserved: reads Yandex credentials from `process.env`, calls the same Yandex generative search endpoint, parses the same response shapes, and sleeps between queries.

## Output Contract Preserved

Each `aiProbes` item still contains:

- `channel`
- `status`
- `query`
- `result`
- `sources`
- `sourceDetails`
- `usedSources`
- `targetFound`
- `targetUsed`
- `sourcePosition`
- `usedSourcePosition`

Existing statuses are preserved:

- `checked`
- `not_configured`
- `permission_denied`
- `failed`

## Tests Added

- Successful checked probe from fixture API response.
- Request body/header shape for Yandex generative search.
- `not_configured` behavior without credentials.
- Inter-query throttling without real sleep.
- `permission_denied` behavior for HTTP 403.
- Failed response behavior for non-OK responses.

Tests inject fetch/env/sleep adapters, so no unit test calls Yandex APIs or waits.

## Intentionally Not Changed

- No GSC activation.
- No storage/schema/event changes.
- No Firestore write behavior changes.
- No `seoAgentService.ts` changes.
- No provider class movement.
- No draft task/recommendation/report schema changes.
- No `page`, `sitemap`, or `lighthouse` contract changes.
- No production pipeline run.

## Recommended Next Task

TASK-006 should extract the expanded Yandex Webmaster popular queries collector behind the same `yandexQueries` output contract, with injected API/fetch adapters and no live API calls in unit tests.
