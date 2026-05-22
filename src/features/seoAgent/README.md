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

## Source Architecture

Single-source mode is preserved:

```bash
SEO_DATA_PROVIDER=mock
```

Multi-source mode is enabled with:

```bash
SEO_DATA_SOURCES=mock,pagespeed,crawler,gsc,sistrix
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
- `gsc`

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

Without `SISTRIX_API_KEY`, single-source mode returns a controlled `503` and multi-source mode marks SISTRIX as `not_configured`.

### `pagespeed`

Homepage-only PageSpeed Insights source.

Optional env:

```bash
PAGESPEED_API_KEY=...
```

Notes:

- key is optional for light/manual use
- key is never logged
- API responses are normalized into scores and metrics only
- no raw Lighthouse payload is exposed

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

### `gsc`

Google Search Console provider shell for future owned query data.

Current Stage 07 behavior:

- provider structure exists
- missing credentials return safe `not_configured`
- startup does not crash
- source does not block other sources in multi-source mode

Planned normalized fields:

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
GSC_SITE_URL=https://annavisas.com/
GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
```

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
  "status": "failed",
  "safeMessage": "PageSpeed Insights returned an unexpected response"
}
```

Allowed statuses:

- `success`
- `skipped`
- `failed`
- `not_configured`

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

- placeholder source today
- safe recommendation to connect GSC when skipped or not configured

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
- `pagespeed` for homepage performance and technical SEO signals
- `gsc` as the future owned query/performance source
- `sistrix` remains additive, not mandatory

## Known Limitations

- GSC real auth is still a placeholder
- crawler is homepage-only
- PageSpeed is homepage-only
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
