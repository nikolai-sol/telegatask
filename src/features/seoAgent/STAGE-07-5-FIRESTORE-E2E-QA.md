# Stage 07.5 Firestore E2E QA

Date: 2026-05-22
Time zone: Europe/Vienna

## Environment

- backend routes mounted locally through Express with the existing SEO router
- Firestore initialized through the project service account
- Telegram Mini App auth reproduced with valid signed `X-Telegram-Init-Data`
- no secrets, tokens, API keys, or raw provider payloads are included in this report

## Domains Tested

- `annavisas.com`
- `amalphis.at`

## Source Combinations Tested

1. `SEO_DATA_PROVIDER=mock`
2. `SEO_DATA_SOURCES=mock,crawler`
3. `SEO_DATA_SOURCES=crawler,pagespeed`
4. `SEO_DATA_SOURCES=gsc,crawler,pagespeed`
5. `SEO_DATA_SOURCES=sistrix,crawler`

## Endpoint Flow Tested

- `POST /api/companies/:companyId/seo-config`
- `POST /api/ai/seo/analyze`
- `POST /api/ai/seo/runs/:runId/draft-tasks/generate`
- `GET /api/ai/seo/runs/:runId/draft-tasks`
- `PATCH /api/ai/seo/draft-tasks/:draftTaskId`
- `POST /api/ai/seo/draft-tasks/:draftTaskId/convert`
- `GET /api/companies/:companyId/seo-config` for cross-team denial check

## Pass/Fail Summary

| Check | Result | Notes |
|---|---|---|
| Firestore-backed analyze with single-source `mock` | Pass | Runs saved for both domains |
| Firestore-backed analyze with `mock,crawler` | Pass | Runs saved, crawler snapshot persisted |
| Firestore-backed analyze with `crawler,pagespeed` | Pass | Crawler succeeded, PageSpeed failed safely due rate limiting, run still saved |
| Firestore-backed analyze with `gsc,crawler,pagespeed` | Pass | `gsc` persisted as `not_configured`, run still saved |
| Firestore-backed analyze with `sistrix,crawler` | Pass | `sistrix` persisted as `not_configured`, run still saved |
| Saved run structure | Pass | `teamId`, `domain`, `provider`, `sources`, `sourceStatuses`, `summary`, `visibility`, `technical`, `searchConsole`, `pagespeed`, `crawler`, `opportunities`, `recommendations`, `scores` present as expected |
| Unsafe saved payload scan | Pass | No `apiKey`, `refreshToken`, `accessToken`, `clientSecret`, raw Lighthouse payload, or SISTRIX field leakage observed |
| Draft task generation | Pass | Drafts created and stored in Firestore |
| Draft task generation idempotency | Pass | Second generate returned existing draft tasks, no duplicates |
| Draft task list | Pass | Returned persisted draft tasks for the run |
| Approve draft task | Pass | Status updated to `approved`, no real task created yet |
| Reject draft task | Pass | Status updated to `rejected`, no real task created |
| Convert approved draft to company task | Pass | Real task created, `visibility=team`, no automatic fire |
| Repeat convert idempotency | Pass | Existing linked real task returned, no duplicate created |
| Convert approved draft to home task | Pass | Real task created with `companyId=null`, `visibility=private` |
| Conversion metadata persistence | Pass | `realTaskId`, `convertedAt`, `convertedByUserId` saved on draft task |
| Cross-team access block | Pass | Returned `403` |
| Build | Pass | `npm run build` succeeded |

## Observed Normalized Run Examples

### `SEO_DATA_PROVIDER=mock`, `annavisas.com`

- `provider: "mock"`
- `sources: ["mock"]`
- `summary.visibilityIndex: 3.4`
- `summary.keywordCount: 18`
- `sourceStatuses.mock.status: "success"`
- `opportunitiesCount: 3`
- `recommendationsCount: 4`

### `SEO_DATA_SOURCES=mock,crawler`, `annavisas.com`

- `provider: "multi_source"`
- `crawler.httpStatus: 200`
- `crawler.finalUrl: "https://annavisas.com/uk"`
- `crawler.hasTitle: true`
- `crawler.hasMetaDescription: true`
- `crawler.hasH1: true`
- `crawler.hasCanonical: true`

### `SEO_DATA_SOURCES=gsc,crawler,pagespeed`, `annavisas.com`

- `gsc.status: "not_configured"`
- `pagespeed.status: "failed"`
- `pagespeed.safeMessage: "PageSpeed Insights rate limit reached"`
- `crawler.status: "success"`
- run still persisted successfully

## Bugs Found

1. Team role persistence bug in route setup path
- Symptom: a freshly prepared QA owner user received `Access denied` on SEO config routes
- Root cause: `setRole()` in `teamRepository` wrote `roles.<userId>` using a merge pattern that did not populate `team.roles` in the shape expected by `getUserRoleInTeam()`
- Impact: permission-gated SEO routes could treat valid owner users as `viewer`

## Fixes Applied

1. `src/repositories/teamRepository.ts`
- `setRole()` now persists the `roles` map in a shape that `getUserRoleInTeam()` can read correctly
- `updatePermissions()` now persists the `permissions` map in the same safe pattern
- `removeMember()` now removes nested role/permission fields through `update()`

2. Google Search Console preparation
- `src/features/seoAgent/providers/googleSearchConsoleSeoSource.ts` now checks OAuth-oriented env placeholders instead of implying that a simple service-account path is enough
- `searchConsole.dateRange` was added to the normalized snapshot structure for future `searchAnalytics.query` support
- `.env.example` and README were updated with GSC OAuth placeholders and security notes

## GSC Connection Preparation Notes

What is still needed for real GSC data:

- Google Cloud project with Search Console API enabled
- OAuth client credentials
- redirect URI handling
- refresh token acquisition and secure storage
- a real `searchAnalytics.query` implementation
- normalized mapping for:
  - `clicks`
  - `impressions`
  - `ctr`
  - `averagePosition`
  - `topQueries`
  - `topPages`
  - `countries`
  - `devices`
  - `dateRange`

Current safe behavior:

- if GSC env is missing, the source returns `not_configured`
- if OAuth env is present but query execution is still not implemented, the source remains safely non-operational
- startup does not crash
- multi-source runs can still succeed without GSC

## Build Result

- `npm run build`
- Result: pass
