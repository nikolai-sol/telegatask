# SEO Agent Project — Stage 07

SEO Agent now supports provider-neutral multi-source SEO analysis infrastructure. The backend can merge several SEO signals into one normalized analysis run, while keeping draft-task generation and explicit draft-to-real-task conversion from Stages 05–06.5.

Stage 07 is still backend-only:

- no UI
- no Telegram commands
- no AI synthesis
- no automatic real task creation during analysis or draft generation

## Scope

- store SEO configuration per Company
- run normalized SEO analysis from one or more sources
- keep SISTRIX support without making it mandatory
- support free or owned sources first
- generate SEO draft tasks from unified recommendations and opportunities
- keep approve/reject and explicit conversion to real TelegaTask tasks unchanged

Project note:

- `fish-in-rif.ru` is a B2B chilled and fresh-frozen fish and seafood wholesale supplier
- it is not a fishing goods or tackle website

## Source Architecture

Single-source mode is preserved:

```bash
SEO_DATA_PROVIDER=mock
```

Multi-source mode is enabled with:

```bash
SEO_ENABLED_SOURCES=pagespeed,crawler,google_serp_rank,yandex_serp_rank
```

Rules:

- if `SEO_DATA_SOURCES` is set, multi-source mode is used
- if `SEO_DATA_SOURCES` is not set, old `SEO_DATA_PROVIDER` behavior is preserved
- missing `SEO_DATA_PROVIDER` still defaults to `mock`
- unknown source names return a controlled error
- one optional source can fail without failing the whole run if at least one selected source succeeds
- source failures are recorded as safe source statuses

Supported Stage 07 source names:

- `mock`
- `sistrix`
- `pagespeed`
- `crawler`
- `google_serp_rank`
- `yandex_serp_rank`
- `gsc`

Alias support:

- `basic_crawler` resolves to `crawler`

## Source Behavior

### `mock`

Default safe provider for local and fallback testing.

### `sistrix`

Existing ranking/competitor source. Still optional.

Required env:

```bash
SEO_DATA_PROVIDER=sistrix
SISTRIX_API_KEY=...
SISTRIX_API_BASE_URL=https://api.sistrix.com
```

Without `SISTRIX_API_KEY`, single-source mode returns a controlled `503` and multi-source mode records SISTRIX as a failed source with an explicit status message and error code.

Current real-source status:

- planned
- not connected in the current Amalphis production-like run path
- required for visibility and competitor scoring

### `pagespeed`

Homepage-only PageSpeed Insights source.

Optional env:

```bash
PAGESPEED_API_KEY=...
```

Notes:

- key is optional for light/manual use, but PageSpeed Insights is quota-limited
- key is never logged
- API responses are normalized into scores and metrics only
- no raw Lighthouse payload is exposed
- rate limits do not fail the whole SEO analysis if other sources succeed
- rate-limited runs are saved with source status `partial`, message `PageSpeed Insights rate limit reached`, and error code `PAGESPEED_RATE_LIMIT`

Manual WGD / HTML report rule:

- Do not use the `pagespeed` source for one-off WGD HTML reports unless a dedicated PageSpeed API quota is intentionally being tested.
- For speed/performance in one-off WGD reports, run local Lighthouse through Chrome instead of PageSpeed Insights API.
- Use desktop/provided mode when the target page fails mobile headless Lighthouse with `NO_FCP`.
- Store the local Lighthouse snapshot separately in the report JSON/HTML and keep `pagespeed` out of `sources`, so the run does not waste PSI quota or produce `PAGESPEED_RATE_LIMIT`.

Known working command shape:

```bash
npx lighthouse "https://example.com/path/" \
  --quiet \
  --output=json \
  --output-path=stdout \
  --preset=desktop \
  --throttling-method=provided \
  --only-categories=performance,accessibility,best-practices,seo \
  --chrome-flags="--headless=new --no-sandbox --disable-gpu"
```

Implementation reference:

- `scripts/runWgdLeovitHtml.ts` runs WGD with `sources: ["crawler", "gsc", "yandex_serp_rank"]` and appends a separate local Lighthouse snapshot.

### `crawler`

Lightweight internal homepage crawler.

Checks:

- homepage HTTP status
- title presence
- meta description presence
- H1 presence
- canonical presence
- robots.txt reachability
- sitemap.xml reachability
- simple indexability signal detection

Limitations:

- homepage only
- no deep crawl
- no browser automation

Current real-source status:

- active
- used successfully in real-source runs for homepage technical checks

### `gsc`

Google Search Console provider for owned query and page demand data.

Current behavior:

- active
- OAuth callback stores refresh token for reuse
- live `searchAnalytics.query` calls are used in real-source runs
- selected GSC failures do not fail the whole run if another source succeeds

Planned normalized fields:

- dateRange
- clicks
- impressions
- ctr
- averagePosition
- topQueries
- topPages
- countries
- devices

Suggested placeholder env:

```bash
GSC_ENABLED=true
GSC_SITE_URL=sc-domain:annavisas.com
GSC_SITE_URLS=sc-domain:annavisas.com,sc-domain:amalphis.at
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3002/api/gsc/oauth/callback
GOOGLE_OAUTH_REFRESH_TOKEN=
GSC_DEFAULT_DATE_RANGE_DAYS=28
```

### GSC Setup

Google Search Console analysis requires OAuth 2.0. A simple API key is not enough for Search Console performance data.

Google Cloud requirements:

- create a Google Cloud project
- enable the Search Console API
- create an OAuth client
- configure the redirect URI used during OAuth consent

Search Console requirements:

- the site must be verified in Google Search Console
- the Google account used for OAuth must have access to the property
- read access is enough for `searchAnalytics.query`
- `GSC_SITE_URLS` is an optional convenience list; Companies can select any property available to the Team credential through `gscSiteUrl`
- use `sc-domain:example.com` for Domain properties and `https://example.com/` for URL-prefix properties

OAuth scopes:

- use readonly scope for analysis:
  - `https://www.googleapis.com/auth/webmasters.readonly`
- reserve full scope for future write actions only:
  - `https://www.googleapis.com/auth/webmasters`

Security rules:

- never expose or log access tokens
- never expose or log refresh tokens
- never expose or log client secrets
- never return raw Google API errors in API output

Local OAuth helper routes:

- `GET http://localhost:3002/api/gsc/oauth/start?domain=annavisas.com&teamId=...&companyId=...`
- `GET http://localhost:3002/api/gsc/oauth/status?teamId=...`
- `GET http://localhost:3002/api/gsc/oauth/smoke?domain=annavisas.com&teamId=...&companyId=...`

Notes:

- these helper routes are local-only and intended for localhost setup
- successful OAuth callback stores one refresh token per Team in Firestore collection `seoProviderCredentials`
- one Team credential may serve multiple Companies and GSC properties available to the connected Google account
- each Company stores its selected property in `SeoCompanyConfig.gscSiteUrl`
- analysis never reuses another Team's stored GSC refresh token
- existing global GSC credentials should be migrated once to the owning Team

Current limitation:

- GSC still depends on a successful local OAuth consent flow before the first live query can run

### `google_serp_rank`

External Google rank tracking source. This runs before any owner-authorized Google Search Console connection.

Provider:

- DataForSEO Google Organic SERP API

Purpose:

- check live organic positions for a configured domain and keyword set
- return matched URL, rank position, competitors above, and SERP feature context
- keep this data separate from Search Console clicks, impressions, CTR, and average position

Required env:

```bash
DATAFORSEO_AUTH_BASE64=...
DATAFORSEO_LOGIN=...
DATAFORSEO_PASSWORD=...
DATAFORSEO_DEFAULT_LOCATION=Austria
DATAFORSEO_DEFAULT_LANGUAGE=German
DATAFORSEO_DEFAULT_DEVICE=desktop
SEO_RANK_TRACKING_MAX_KEYWORDS=5
SEO_RANK_TRACKING_MAX_QUERY_LENGTH=100
SEO_MATCH_SUBDOMAINS=false
```

Auth notes:

- preferred format: `DATAFORSEO_AUTH_BASE64`
- value should be Base64 of `login:password`
- if `DATAFORSEO_AUTH_BASE64` is present, it takes precedence over `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD`
- `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` remain as fallback only

Output shape:

- `query`
- `searchEngine = google`
- `position`
- `matchedUrl`
- `title`
- `snippet`
- `competitorsAbove`
- `serpFeatures`
- `location`
- `language`
- `device`
- `checkedAt`

Provider states:

- `connected`
- `missing_credentials`
- `no_keywords`
- `provider_error`
- `limit_exceeded`
- `partial_success`

### `yandex_serp_rank`

External Yandex rank tracking source. This runs before any owner-authorized Yandex Webmaster connection.

Provider:

- Yandex Search API

Purpose:

- check live organic positions for a configured domain and keyword set
- return matched URL, rank position, competitors above, and search context
- keep this data separate from Yandex Webmaster clicks, impressions, CTR, and average position

Required env:

```bash
YANDEX_SEARCH_API_KEY_ID=
YANDEX_SEARCH_API_KEY=...
YANDEX_SEARCH_FOLDER_ID=...
YANDEX_SEARCH_DEFAULT_REGION=225
YANDEX_SEARCH_DEFAULT_LANGUAGE=ru
YANDEX_SEARCH_DEFAULT_DEVICE=desktop
YANDEX_SEARCH_MODE=deferred
SEO_RANK_TRACKING_MAX_KEYWORDS=5
SEO_RANK_TRACKING_MAX_QUERY_LENGTH=100
SEO_MATCH_SUBDOMAINS=false
```

Notes:

- `YANDEX_SEARCH_API_KEY_ID` is optional and only for operator reference
- runtime uses `YANDEX_SEARCH_API_KEY` and `YANDEX_SEARCH_FOLDER_ID`
- `YANDEX_SEARCH_DEFAULT_REGION` should be a numeric region ID
- `225` means Russia

Mode:

- `deferred` is the default and preferred mode for scheduled SEO monitoring
- `sync` is supported when immediate responses are needed

Provider states:

- `connected`
- `missing_credentials`
- `no_keywords`
- `provider_error`
- `limit_exceeded`
- `partial_success`

## External Rank Tracking vs Owner-Authorized Data

External SERP rank tracking is not the same thing as Search Console or Webmaster data.

Fast external rank tracking:

- checked from external SERP providers
- returns Google or Yandex positions for a keyword set
- returns matched URL, competitors above, SERP features, and `checkedAt`
- does not return clicks, impressions, CTR, or owner performance history

Owner-authorized data:

- Google Search Console
- Yandex Webmaster
- returns real clicks, impressions, CTR, and average position based on owner-authorized performance data

The system must never label external SERP rank checks as clicks, impressions, CTR, or Search Console data.

## Keyword Selection And Limits

Rank tracking sources do not blindly check every possible query.

Selection order:

- request `keywords` passed to `POST /api/ai/seo/analyze`
- SEO config `trackingKeywords`
- GSC `topQueries` when `gsc` is selected in the same run and no explicit rank keywords are available
- SEO config `brandKeywords` as the last fallback

Normalization rules:

- trim whitespace
- remove empty values
- deduplicate case-insensitively while preserving original query text
- preserve brand and product query wording
- skip excessively long queries

Limits:

- `SEO_RANK_TRACKING_MAX_KEYWORDS` controls how many keywords each rank source checks per run
- default is `5`
- `SEO_RANK_TRACKING_MAX_QUERY_LENGTH` defaults to `100`

## Normalized Run Structure

Successful analysis returns:

- `provider`
- `sources`
- `sourceStatuses`
- `domain`
- `summary`
- `visibility`
- `keywords`
- `competitors`
- `technical`
- `searchConsole`
- `rankTracking`
- `pagespeed`
- `crawler`
- `opportunities`
- `recommendations`
- `scores`

Shared run shape remains provider-neutral. Raw vendor payloads, API keys, request URLs with tokens, and raw error objects must not be exposed.

### Source Statuses

Each run stores safe source execution status:

```json
{
  "source": "pagespeed",
  "status": "partial",
  "message": "PageSpeed Insights rate limit reached",
  "errorCode": "PAGESPEED_RATE_LIMIT",
  "collectedAt": 1779828000000,
  "metricsSummary": {
    "pageUrl": "https://amalphis.at",
    "performanceScore": null
  }
}
```

Allowed statuses:

- `success`
- `partial`
- `skipped`
- `failed`

### Rank Tracking Snapshot

Runs can also include normalized external rank tracking data:

```json
{
  "rankTracking": {
    "google": {
      "provider": "dataforseo",
      "checks": [],
      "status": {
        "state": "missing_credentials",
        "message": "DataForSEO credentials are not configured",
        "checkedAt": "2026-05-27T08:00:00.000Z"
      }
    },
    "yandex": {
      "provider": "yandex_search_api",
      "checks": [],
      "status": {
        "state": "connected",
        "message": "Yandex rank checks completed successfully",
        "checkedAt": "2026-05-27T08:00:00.000Z"
      }
    }
  }
}
```

Each SERP check keeps:

- `query`
- `searchEngine`
- `targetDomain`
- `found`
- optional `position`
- optional `matchedUrl`
- optional `title`
- optional `snippet`
- optional `competitorsAbove`
- optional `serpFeatures`
- `location` or `region`
- `language`
- `device`
- `checkedAt`

Matching rules:

- protocol is stripped
- `www.` is stripped
- domain matching is case-insensitive
- subdomain matches are allowed only when `SEO_MATCH_SUBDOMAINS=true`
- `fakeamalphis.at` does not match `amalphis.at`

## How To Verify Live Rank Tracking

Required env for Google SERP:

```bash
DATAFORSEO_AUTH_BASE64=...
DATAFORSEO_LOGIN=...
DATAFORSEO_PASSWORD=...
DATAFORSEO_DEFAULT_LOCATION=Austria
DATAFORSEO_DEFAULT_LANGUAGE=German
DATAFORSEO_DEFAULT_DEVICE=desktop
SEO_RANK_TRACKING_MAX_KEYWORDS=5
SEO_RANK_TRACKING_MAX_QUERY_LENGTH=100
SEO_MATCH_SUBDOMAINS=false
```

Required env for Yandex SERP:

```bash
YANDEX_SEARCH_API_KEY_ID=
YANDEX_SEARCH_API_KEY=...
YANDEX_SEARCH_FOLDER_ID=...
YANDEX_SEARCH_DEFAULT_REGION=225
YANDEX_SEARCH_DEFAULT_LANGUAGE=ru
YANDEX_SEARCH_DEFAULT_DEVICE=desktop
YANDEX_SEARCH_MODE=deferred
SEO_RANK_TRACKING_MAX_KEYWORDS=5
SEO_RANK_TRACKING_MAX_QUERY_LENGTH=100
SEO_MATCH_SUBDOMAINS=false
```

Example SEO config:

```json
{
  "domain": "amalphis.at",
  "markets": ["AT"],
  "languages": ["de"],
  "trackingKeywords": [
    "amalphis",
    "divo olive oil",
    "divo extra virgin olive oil",
    "olivenöl 5 liter"
  ],
  "targetLocation": "Austria",
  "targetRegion": "ru",
  "targetDevice": "desktop"
}
```

Example analyze request:

```bash
curl -X POST http://localhost:3002/api/ai/seo/analyze \
  -H 'Content-Type: application/json' \
  -H 'x-telegram-init-data: ...' \
  -d '{
    "companyId": "YOUR_COMPANY_ID",
    "mode": "quick_audit",
    "sources": ["crawler", "google_serp_rank", "yandex_serp_rank"],
    "keywords": ["amalphis", "divo olive oil", "olivenöl 5 liter"],
    "region": "225",
    "language": "ru",
    "device": "desktop",
    "location": "Austria"
  }'
```

Run-level overrides:

- `keywords`: explicit keyword set for this run
- `region`: useful for Yandex SERP requests, for example `225` for Russia
- `language`: useful for both Google and Yandex SERP requests
- `device`: `desktop` or `mobile`
- `location`: useful for Google SERP requests

These request parameters override stored SEO config for the current analysis run only.

Expected safe source statuses when credentials are missing:

```json
[
  {
    "source": "google_serp_rank",
    "status": "skipped",
    "message": "DataForSEO credentials are not configured",
    "errorCode": "DATAFORSEO_MISSING_CREDENTIALS"
  },
  {
    "source": "yandex_serp_rank",
    "status": "skipped",
    "message": "Yandex Search API credentials are not configured",
    "errorCode": "YANDEX_SEARCH_MISSING_CREDENTIALS"
  }
]
```

Expected success shape:

- `sourceStatuses` includes `google_serp_rank` and or `yandex_serp_rank`
- `rankTracking.google.checks` and or `rankTracking.yandex.checks` contains normalized checks
- each check includes:
  - `query`
  - `searchEngine`
  - `provider`
  - `found`
  - optional `position`
  - optional `matchedUrl`
  - `checkedAt`
  - `location` or `region`

## fish-in-rif.ru Notes

Business classification:

- `fish-in-rif.ru` should be treated as a B2B fish and seafood wholesale supplier
- priority focus:
  - wholesale fish supplier
  - chilled fish wholesale
  - fresh-frozen fish wholesale
  - seafood wholesale
  - B2B / HoReCa / restaurants
  - Moscow and Moscow region first

Primary Yandex regions for this project:

- `213` Moscow
- `225` Russia fallback

Organic rank-tracking starter batch:

- `fish in rif`
- `fish-in-rif`
- `фиш ин риф`
- `поставщик рыбы оптом`
- `поставщики рыбы оптом москва`
- `рыба оптом москва`
- `свежемороженая рыба оптом`
- `охлажденная рыба оптом`
- `морепродукты оптом москва`
- `поставщик морепродуктов оптом`
- `рыба и морепродукты оптом`
- `оптовая продажа рыбы`
- `замороженная рыба оптом`
- `лосось оптом москва`
- `форель оптом москва`

Separate future AI visibility query set:

- `где купить рыбу оптом для ресторана`
- `как выбрать поставщика рыбы для ресторана`
- `лучшие поставщики рыбы оптом в москве`
- `поставщики свежемороженой рыбы для horeca`
- `где заказать морепродукты оптом в москве`
- `какие документы нужны для поставки рыбы в ресторан`
- `как выбрать поставщика морепродуктов для ресторана`

These AI visibility queries are prepared for future research flows and should not be mixed into organic `rankTracking`.

## Normalization And Recommendations

Stage 07 keeps deterministic logic only.

From ranking sources like mock or SISTRIX:

- visibility summary
- keyword opportunities
- competitor insights
- keyword and competitor recommendations

From PageSpeed:

- performance/accessibility/best-practices/SEO scores
- LCP, CLS, INP, TBT when available
- technical recommendations for weak performance or technical SEO checks

From crawler:

- technical presence checks
- indexing infrastructure recommendations

From GSC:

- live property, query, page, country, and device data when OAuth is configured
- recommendations for low CTR, existing query demand, and ranking improvement in the 8-20 position band

## GSC Opportunity Engine

The GSC opportunity engine converts real Search Console query/page demand into task-ready SEO opportunities without adding UI or bypassing the draft -> approve -> execute flow.

Inputs:

- property
- date range
- impressions
- clicks
- CTR
- average position
- top queries
- top pages

Query intent classification:

- `brand`
- `product`
- `category`
- `b2b`
- `informational`
- `unknown`

Examples:

- `amalphis` -> `brand`
- `divo olive oil` -> `product`
- `divo extra virgin olive oil` -> `product`
- `olivenöl 5 liter` -> `category`
- `lebensmittel produktion` -> `b2b`

Opportunity patterns:

- low CTR opportunity:
  - improve title/meta snippet
  - align page copy with query intent
  - add FAQ block if useful
- striking distance opportunity:
  - focus on queries roughly in positions 8-20
  - improve target page relevance
  - add internal links
  - add supporting content blocks
  - improve headings
- grouped brand/product/category opportunities:
  - similar queries can be merged into one stronger task-ready opportunity instead of producing duplicates

Draft task generation:

- task drafts reuse the engine's `recommendedAction` text
- grouped query sets such as multiple `divo` product queries become one concrete draft candidate
- if GSC has no usable query list, no fake query-specific opportunities are created

Examples of deterministic recommendations:

- `Connect Google Search Console for real query data`
- `Run PageSpeed audit for technical performance data`
- `Improve homepage performance`
- `Review indexing infrastructure`
- `Improve SEO tracking coverage`

If data is thin:

- the run does not invent precise SEO values
- empty arrays and `null` values are used
- tracking/coverage recommendations are added instead of fake precision

## Draft Task Compatibility

Stage 05/06 flows continue to work from the unified run:

- generate draft tasks
- approve or reject draft tasks
- explicitly convert approved draft tasks to real tasks
- idempotent conversion
- enforced visibility rules
- no automatic `fire` priority

Stage 07 does not change draft-task persistence or conversion architecture.

## API

- `GET /api/companies/:companyId/seo-config`
- `POST /api/companies/:companyId/seo-config`
- `PATCH /api/companies/:companyId/seo-config`
- `POST /api/ai/seo/analyze`
- `POST /api/ai/seo/runs/:runId/approve`
- `POST /api/ai/seo/runs/:runId/draft-tasks/generate`
- `GET /api/ai/seo/runs/:runId/draft-tasks`
- `PATCH /api/ai/seo/draft-tasks/:draftTaskId`
- `POST /api/ai/seo/draft-tasks/:draftTaskId/convert`
- `GET /api/ai/seo/runs/:runId`
- `POST /api/ai/seo/runs/:runId/recommended-tasks/approve`
- `POST /api/ai/seo/runs/:runId/recommended-tasks/reject`

SEO Experiment v0.1 behavior:

- analysis persists normalized findings and automatically creates draft recommended tasks
- every finding and draft task carries `teamId`, `companyId`, source evidence, confidence, and source labels
- GSC credentials are Team-scoped; the selected GSC property is Company-scoped
- bulk approve creates real Company tasks with `visibility=team`
- real SEO tasks are never created with fire priority automatically
- AI heuristic labels are advisory and are not Google ranking predictions

Optional request override for analyze:

```json
{
  "companyId": "company-id",
  "mode": "quick_audit",
  "sources": ["crawler", "pagespeed", "gsc"]
}
```

If `sources` is omitted, env-driven mode is used.

## Safe Error Policy

- invalid `SEO_DATA_PROVIDER` still returns a controlled `503`
- unsupported source names return controlled errors
- provider failures happen before run persistence when no selected source succeeds
- no raw provider payloads or stack traces are returned in API responses
- multi-source runs can still succeed with partial data if at least one selected source succeeds

## Free Sources First Strategy

Stage 07 is designed so useful SEO runs can exist without paid APIs:

- `crawler` for baseline technical presence
- local Lighthouse for one-off WGD HTML performance checks without PageSpeed Insights API quota pressure
- `pagespeed` only when PageSpeed Insights API quota/key is intentionally available
- `gsc` as the future owned query/performance source
- `sistrix` remains additive, not mandatory

## Known Limitations

- SISTRIX is still planned, not active in the current real-source Amalphis run path
- crawler is homepage-only
- PageSpeed is homepage-only
- PageSpeed can be partially unavailable because of external API rate limits
- one-off WGD HTML reports should prefer local Lighthouse over PageSpeed Insights to avoid API limits
- no AI synthesis yet
- no UI yet
- no Telegram commands yet
- no bulk source-specific task conversion flow
- scores remain heuristic, not scientific

## Stage 07 QA

Implementation and local smoke notes are documented in:

- [STAGE-07-MULTI-SOURCE-INFRASTRUCTURE.md](/Volumes/Elements/telegatask/src/features/seoAgent/STAGE-07-MULTI-SOURCE-INFRASTRUCTURE.md:1)

## Next Planned Stage

- build on the new multi-source infrastructure to create a stronger unified SEO/AI report and richer owned-data integrations
