# Stage 07 Multi-Source Infrastructure

Date: 2026-05-22

## What Was Implemented

- provider-neutral source registry with single-source and multi-source modes
- `SEO_DATA_PROVIDER` compatibility preserved
- new optional `SEO_DATA_SOURCES` support
- normalized `sourceStatuses` on every SEO analysis run
- homepage-only `pagespeed` source
- homepage-only internal `crawler` source
- Google Search Console provider shell with safe `not_configured` behavior
- unified run fields for:
  - `sources`
  - `sourceStatuses`
  - `technical`
  - `searchConsole`
  - `pagespeed`
  - `crawler`
- deterministic recommendations from ranking, crawler, PageSpeed, and source availability signals
- draft-task compatibility preserved by keeping recommendations and opportunities generic

## Source List

- `mock`
- `sistrix`
- `pagespeed`
- `crawler`
- `gsc`

## Env Examples

Single-source mock:

```bash
SEO_DATA_PROVIDER=mock
```

Single-source SISTRIX:

```bash
SEO_DATA_PROVIDER=sistrix
SISTRIX_API_KEY=...
SISTRIX_API_BASE_URL=https://api.sistrix.com
```

Multi-source free-first:

```bash
SEO_DATA_SOURCES=crawler,pagespeed,gsc
```

Mixed multi-source:

```bash
SEO_DATA_SOURCES=sistrix,crawler,pagespeed
```

GSC placeholder:

```bash
GSC_ENABLED=true
GSC_SITE_URL=https://annavisas.com/
GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
```

## QA Results

### Build

- `npm run build`
- Result: pass

### Local Smoke Checks

1. Old mode still works with `SEO_DATA_PROVIDER=mock`
- Check method: source selection resolver smoke
- Result: pass

2. SISTRIX missing key stays safe
- Check method: direct provider call without `SISTRIX_API_KEY`
- Result: pass
- Observed safe error: `SISTRIX provider is not configured yet`

3. Multi-source `mock,crawler`
- Check method: source selection resolver plus direct crawler and mock source calls
- Result: pass
- Observed:
  - resolver returned `mock` + `crawler`
  - mock returned overview plus keyword/competitor/url data for `annavisas.com`
  - crawler returned normalized homepage checks for `annavisas.com`

4. Multi-source `crawler,pagespeed`
- Check method: direct crawler and PageSpeed source calls
- Result: partial pass
- Observed:
  - crawler succeeded for `annavisas.com`
  - PageSpeed returned a safe failure: `PageSpeed Insights rate limit reached`
- Notes:
  - no raw payload leaked
  - failure path stays controlled

5. Multi-source with `gsc` not configured
- Check method: direct GSC shell call without config
- Result: pass
- Observed safe error: `Google Search Console source is not configured yet`

6. Invalid provider
- Check method: source selection resolver with `SEO_DATA_PROVIDER=invalid`
- Result: pass
- Observed safe error: `Unsupported SEO_DATA_PROVIDER: invalid`

7. Crawler smoke for `annavisas.com`
- Result: pass
- Observed normalized values:
  - `httpStatus: 200`
  - `finalUrl: https://annavisas.com/uk`
  - `hasTitle: true`
  - `hasMetaDescription: true`
  - `hasH1: true`
  - `hasCanonical: true`
  - `robotsTxtReachable: true`
  - `sitemapXmlReachable: true`
  - `isIndexable: true`

8. Crawler smoke for `amalphis.at`
- Result: pass
- Observed normalized values:
  - `httpStatus: 200`
  - `hasTitle: true`
  - `hasMetaDescription: true`
  - `hasH1: true`
  - `hasCanonical: true`
  - `robotsTxtReachable: true`
  - `sitemapXmlReachable: true`
  - `isIndexable: true`

## Endpoints And Flows

Stage 07 preserved existing backend routes:

- `POST /api/ai/seo/analyze`
- `POST /api/ai/seo/runs/:runId/draft-tasks/generate`
- `GET /api/ai/seo/runs/:runId/draft-tasks`
- `PATCH /api/ai/seo/draft-tasks/:draftTaskId`
- `POST /api/ai/seo/draft-tasks/:draftTaskId/convert`

Analyze now also accepts optional source override input:

```json
{
  "companyId": "company-id",
  "mode": "quick_audit",
  "sources": ["crawler", "pagespeed", "gsc"]
}
```

## Limitations

- full end-to-end route QA was not executed here because that path writes analysis runs and depends on the active Firestore/team environment
- GSC auth is still a placeholder
- PageSpeed may rate-limit unauthenticated requests
- crawler and PageSpeed are homepage-only
- no AI synthesis yet

## Next Stage Recommendation

Stage 07 is ready as infrastructure work. The next safe step is to build richer multi-source synthesis on top of:

- owned GSC query data
- PageSpeed metrics
- crawler findings
- existing ranking/competitor sources
