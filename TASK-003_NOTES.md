# TASK-003 Notes

Date: 2026-07-03

## What Changed

- Added collector-style modules for the runner-owned `page` and `sitemap` outputs.
- Updated `scripts/runWgdZarukuCancerPortal.ts` to delegate homepage and sitemap collection to those modules.
- Added direct unit tests for both collectors with injected fetch implementations.

## Files Changed

- `scripts/runWgdZarukuCancerPortal.ts`
- `src/features/seoAgent/production/zaruku/collectors/httpText.ts`
- `src/features/seoAgent/production/zaruku/collectors/homepageSnapshotCollector.ts`
- `src/features/seoAgent/production/zaruku/collectors/homepageSnapshotCollector.test.ts`
- `src/features/seoAgent/production/zaruku/collectors/sitemapSummaryCollector.ts`
- `src/features/seoAgent/production/zaruku/collectors/sitemapSummaryCollector.test.ts`
- `TASK-003_NOTES.md`

## Collectors Extracted

- `collectHomepageSnapshot`
  - Input: Zaruku config subset with `targetUrl` and `domain`.
  - Output: same `PageSnapshot` shape currently written as `page`.
  - Behavior preserved: fetch failures still reject because the previous runner-owned homepage function did not catch them.

- `collectSitemapSummary`
  - Input: Zaruku config subset with `sitemapUrl` and `targetUrl`.
  - Output: same `SitemapSummary` shape currently written as `sitemap`.
  - Behavior preserved: fetch/parsing failures return an empty sitemap summary with `status: null`.

- `fetchText`
  - Shared internal collector helper preserving the existing request behavior and `User-Agent`.
  - Tests inject a fake fetch implementation, so no unit test contacts live services.

## Output Contracts Preserved

- `page` field names and nullability are unchanged.
- `sitemap` field names and aggregation rules are unchanged.
- Existing regex-based parsing remains the source of truth.
- Production runner still writes the same top-level JSON/HTML payload shape.

## Tests Added

- Homepage collector:
  - successful snapshot from fixture HTML;
  - empty successful response behavior;
  - fetch failure rejection behavior.

- Sitemap collector:
  - successful summary from fixture XML;
  - section aggregation;
  - fetch failure empty-summary behavior.

## Intentionally Not Changed

- No GSC activation.
- No storage/schema/event changes.
- No Firestore write behavior changes.
- No `seoAgentService.ts` changes.
- No provider class movement.
- No draft task/recommendation/report schema changes.
- No production pipeline run.

## Recommended Next Task

TASK-004 should extract the local Lighthouse summary adapter behind the same `lighthouse` output contract, with injected command execution or fixture payload parsing so unit tests do not run Lighthouse or Chrome.
