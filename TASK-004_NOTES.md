# TASK-004 Notes

Date: 2026-07-03

## What Changed

- Added a collector-style module for the runner-owned local Lighthouse summary.
- Updated `scripts/runWgdZarukuCancerPortal.ts` to delegate Lighthouse collection to that module.
- Added direct unit tests for the Lighthouse collector with an injected command execution adapter.

## Files Changed

- `scripts/runWgdZarukuCancerPortal.ts`
- `src/features/seoAgent/production/zaruku/collectors/localLighthouseCollector.ts`
- `src/features/seoAgent/production/zaruku/collectors/localLighthouseCollector.test.ts`
- `TASK-004_NOTES.md`

## Lighthouse Collector Extracted

- `collectLocalLighthouse`
  - Input: Zaruku config subset with `targetUrl`.
  - Optional input: command execution adapter for tests.
  - Output: same `LighthouseSummary` shape currently written as `lighthouse`.
  - Runtime behavior preserved: executes `npx lighthouse` with the existing flags and options.
  - Error behavior preserved: any command/parsing error returns a failed summary with null metric fields.

## Output Contract Preserved

The `lighthouse` object still contains:

- `status`
- `message`
- `pageUrl`
- `performanceScore`
- `accessibilityScore`
- `bestPracticesScore`
- `seoScore`
- `firstContentfulPaintMs`
- `largestContentfulPaintMs`
- `cumulativeLayoutShift`
- `totalBlockingTimeMs`
- `speedIndexMs`
- `totalByteWeight`

Scoring and metric extraction still use the same helper behavior from `zarukuWgdRunnerHelpers.ts`.

## Tests Added

- Successful Lighthouse summary from fixture process output.
- Missing metric behavior returns null metric fields.
- Failure fallback returns `status: "failed"` and null metric fields.
- Tests inject the command adapter, so no unit test runs Chrome or Lighthouse.

## Intentionally Not Changed

- No PageSpeed API or remote Lighthouse behavior.
- No GSC activation.
- No storage/schema/event changes.
- No Firestore write behavior changes.
- No `seoAgentService.ts` changes.
- No provider class movement.
- No draft task/recommendation/report schema changes.
- No `page` or `sitemap` collector changes beyond normal test execution.
- No production pipeline run.

## Recommended Next Task

TASK-005 should extract Yandex generative search probes behind the same `aiProbes` output contract, with injected fetch/timer adapters so unit tests do not call Yandex APIs or sleep.
