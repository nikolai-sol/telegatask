# TASK-002 Notes

Date: 2026-07-03

## What Changed

- Added Zaruku production config at `src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.ts`.
- Updated `scripts/runWgdZarukuCancerPortal.ts` to import scenario values from that config.
- Added pure runner helper module at `src/features/seoAgent/production/zaruku/zarukuWgdRunnerHelpers.ts`.
- Added direct unit tests for pure helper behavior in `zarukuWgdRunnerHelpers.test.ts`.

## Config Extracted

The config now centralizes:

- domain, target URL, sitemap URL, aliases;
- market, language, Yandex region, device;
- GSC placeholder as `gscSiteUrl: null`;
- team seed identity and name;
- company seed identity and seed fields;
- user seed identity;
- tracking keywords;
- competitors;
- important sections;
- brand/exclude keywords;
- selected production SEO sources;
- report file prefix and report title/heading labels;
- Yandex popular query limit;
- rank tracking keyword limit env value;
- AI probe target domain, channel, throttle, label, and queries.

## Helpers Directly Tested

Direct tests now cover these pure helper areas:

- HTML escaping and status class mapping.
- Homepage snapshot parsing/building from raw HTML.
- Sitemap URL parsing and section aggregation.
- Yandex generative search source parsing, target matching, target position, and answer extraction.

These tests do not contact the network, Firestore, Lighthouse, or Yandex APIs.

## Hardcoded Values That Remain

- The production entrypoint remains `scripts/runWgdZarukuCancerPortal.ts`.
- Local Lighthouse CLI flags remain in the runner because this task did not extract the live adapter.
- Report prose remains in the runner because changing report rendering structure/content is out of scope; Zaruku-specific report title/heading/domain labels were routed through config where safe.
- Firestore collection names remain in the runner because persistence orchestration was explicitly not moved.
- Yandex API endpoint URLs remain in the runner/provider code because this task did not change collector logic.

## Intentionally Not Changed

- No GSC activation.
- No storage/schema/table changes.
- No event bus.
- No `seoAgentService.ts` refactor.
- No provider class movement.
- No Firestore write behavior changes.
- No report output schema changes.
- No production pipeline run.

## Risks Found

- The runner still mixes orchestration, live collectors, persistence, and report rendering.
- Local Lighthouse remains a synchronous CLI call with local runtime dependency.
- The Yandex popular query collector and AI probe still live in the runner and depend on environment credentials.
- Report rendering still contains substantial static production prose, so future extraction should be protected by HTML/report tests.

## Recommended TASK-003

Extract the runner-owned sitemap and homepage snapshot collectors into a small production collector module behind the current `page` and `sitemap` output contracts.

Keep the golden baseline and the new pure helper tests green. Do not move Firestore writes or `seoAgentService.ts` yet.
