# Wordstat Demand-to-Content Gap Design

**Date:** 2026-09-02  
**Status:** approved in conversation; awaiting written-spec review  
**Target workflow:** `npm run seo:report` and the `seo-report` Codex skill  
**First production example:** `https://flowerlife-school.com/`

## Goal

Add Yandex Wordstat to the standard Russian-market SEO report as a primary demand layer. Wordstat must not change the overall SEO score. It must show whether measured search demand is covered by the site's prominent content signals and must produce the report's first recommendation from the highest-priority non-brand demand gap.

## User-visible contract

For a Russian report with supplied keywords, the manager HTML includes a section named **«Спрос и соответствие контента»** immediately after the main-problems summary and before rank/AI details.

The section answers four questions:

1. What demand did Wordstat measure for each seed and its related phrases?
2. Which demand clusters are covered, partially covered, or not covered by crawled pages?
3. Which page is the best current match for each covered or partial cluster?
4. Which unmet non-brand cluster should be addressed first, with seasonality and regional evidence where available?

The report's general score and existing component scores remain unchanged. Wordstat is an opportunity and content-alignment source, not a quality score.

## Scope

### Included

- Yandex Cloud Search API Wordstat using the existing `YANDEX_SEARCH_API_KEY` and `YANDEX_SEARCH_FOLDER_ID` credentials.
- `topRequests` for every unique report keyword, bounded to ten seeds and twenty returned phrases per seed.
- Demand clustering and deterministic comparison with crawled title, description, H1, H2, and H3 signals.
- Separate brand and non-brand classification.
- Monthly dynamics for the last thirteen completed months and regional distribution for up to three highest-priority non-brand gaps.
- A report-safe `wordstat` model, provider coverage row, `evidence/wordstat.json`, Russian manager presentation, methodology text, and specialist evidence link.
- Publisher support for the optional report-declared `manual-query-pack.md`, so a partial Yandex check does not force a direct-copy publication path.
- Partial-result handling: one failed seed or enrichment request must not erase successful Wordstat evidence or the rest of the SEO report.
- Updating the reusable `seo-report` skill so Wordstat is required for Russian-market runs when credentials are available.
- Regenerating, visually checking, replacing, and publishing the Flowerlife report at its existing GitHub Pages URL.

### Excluded

- Wordstat data changing the overall score or any existing component score.
- Automatic edits to the audited website.
- Automatic creation of pages, briefs, tasks, or an execution plan before explicit report acceptance.
- Treating Wordstat frequency as rankings, clicks, conversions, or guaranteed traffic.
- Unlimited semantic expansion or a full query-by-page matrix.
- Sending credentials, authorization headers, or raw provider error bodies to report artifacts.

## Architecture

### 1. Wordstat collector

Create a focused `wordstatEvidence` module under `src/features/seoAgent/wgdReport/`. It owns authentication boundaries, request limits, response validation, sanitization, and per-request status.

The collector uses these Yandex Cloud endpoints:

- `POST /v2/wordstat/topRequests`;
- `POST /v2/wordstat/dynamics`;
- `POST /v2/wordstat/regions`.

The API key is sent only in the `Authorization: Api-Key ...` request header and is never returned from the module. Every request includes `folderId`. Network calls use the existing bounded-provider timeout pattern and a small bounded retry policy for `429` and transient `5xx` responses. Permanent `4xx` responses are recorded as sanitized provider states without retaining the raw body.

Collection is two-stage:

1. Fetch `topRequests` for up to ten normalized unique input keywords, using the report region and all device types.
2. After the crawl is available and coverage gaps are calculated, fetch monthly dynamics and regional distribution for up to three top non-brand gaps.

The maximum normal request count is sixteen: ten top-request calls plus two enrichment calls for each of three gaps.

### 2. Demand normalization and clustering

Each input keyword is one seed cluster. Wordstat's returned phrases and associations stay linked to their seed and are deduplicated globally by normalized phrase. When a phrase appears under multiple seeds, the cluster with the closest normalized token overlap owns it; ties use the seed's original order.

Counts arrive as strings and are parsed only when they are non-negative safe integers. Invalid counts remain `null` and are never coerced to zero.

Brand terms are derived from:

- normalized hostname labels;
- a short homepage title or H1 when it contains no more than five meaningful tokens;
- the original report keywords that contain those derived terms.

A cluster is brand when its seed or dominant Wordstat phrases contain a derived brand term. Brand clusters remain visible but cannot become the primary content-gap recommendation.

### 3. Content coverage model

Coverage compares demand phrases with prominent crawl evidence only:

- title;
- meta description;
- H1;
- H2;
- H3.

The comparison reuses the report's normalized-token approach, including case folding, `ё` normalization, punctuation removal, and Russian/English stop-word removal. It does not claim full semantic understanding.

For every cluster:

- **covered**: one page matches all meaningful seed tokens and at least one high-demand related phrase;
- **partial**: one page matches at least half of the meaningful seed tokens, with a minimum of two matching tokens, but does not satisfy the covered rule;
- **missing**: no page satisfies either rule;
- **not measured**: the seed has no valid Wordstat result or the crawl has no usable prominent signals.

The best matching page is selected by coverage class, matched-token ratio, number of matched prominent fields, and crawl discovery order, in that order. The report explicitly labels this as a deterministic prominent-signal check, not a relevance or ranking guarantee.

### 4. Gap priority and first recommendation

Only non-brand clusters with `partial` or `missing` coverage enter the opportunity queue.

Priority order is deterministic:

1. valid 30-day total demand, descending;
2. `missing` before `partial` at equal demand;
3. seed input order.

The first queue item becomes **«Главная возможность роста»** and is prepended to the report's recommendation section. It contains:

- the demand cluster and measured 30-day count;
- its coverage state;
- the best current page, if partial;
- the highest-demand related phrases;
- monthly direction from thirteen completed months, if collected;
- leading regions, if collected;
- one bounded action: strengthen the matched landing page or create a dedicated landing page/content hub.

This recommendation is an opportunity, not a confirmed technical defect, and therefore does not receive a severity or change the score.

### 5. Report and evidence model

Add an optional top-level `wordstat` object to the normalized report payload and published report. It contains:

- collection status and checked time;
- seed results with totals, phrases, associations, and per-seed errors;
- normalized demand clusters;
- coverage classification and best-page matches;
- enrichment data for up to three gaps;
- the primary recommendation;
- limitations.

Add a provider coverage row with `id: "wordstat"`:

- `success` when every requested top-result call succeeds;
- `partial` when at least one result succeeds and another request fails;
- `unavailable` when credentials are absent, all requests fail, or the market profile is Russian but the provider cannot be reached;
- `not_applicable` for non-Russian profiles unless explicitly enabled in a future design.

Write the sanitized object to `evidence/wordstat.json`. The artifact writer and Pages publisher accept this file as an optional known evidence path. The publisher also accepts `manual-query-pack.md` only when `report.json` declares that exact relative path; any other root file remains rejected. The public report includes both declared files in the collapsed specialist-data list.

## Manager presentation

The Wordstat section appears before rank and AI visibility because it establishes whether the selected topics reflect measured demand.

It contains:

- cards for seeds checked, clusters found, covered/partial/missing totals, and the largest uncovered demand;
- a compact table with cluster, 30-day demand, brand status, coverage state, best matching page, and recommendation;
- a detail disclosure for related phrases, monthly dynamics, and regional distribution;
- a plain-language note that Wordstat demand is not traffic, ranking, or conversion data.

On mobile, cards collapse to one column and tables remain inside horizontally scrollable containers. No page-wide horizontal overflow is allowed at 390 CSS pixels.

## Flowerlife example

The first run reuses the existing five report keywords:

- `цветок жизни школа`;
- `платформа саморазвития`;
- `онлайн курсы саморазвития`;
- `курсы духовного развития`;
- `курсы ароматерапии онлайн`.

`цветок жизни школа` is expected to be classified as brand demand. Non-brand clusters compete for the primary recommendation by measured demand and coverage, without a hard-coded Flowerlife outcome.

The regenerated report replaces `mini-app/seo-reports/flowerlife-school/` through `npm run seo:publish-report -- --report-dir "$REPORT_DIR" --slug flowerlife-school --replace`, where `REPORT_DIR` is set to the directory printed by the successful report run. It is then pushed to `main` and verified at:

```text
https://nikolai-sol.github.io/telegatask/seo-reports/flowerlife-school/
```

## Error handling and limits

- Missing credentials produce an explicit Wordstat coverage gap; they never abort the crawl, Lighthouse, Yandex SERP, or Alice collection.
- Requests have bounded timeouts and total run limits.
- `429` and transient `5xx` responses may be retried with bounded backoff; other `4xx` responses are not retried.
- Raw headers and raw error bodies never enter evidence files.
- Partial seed results are retained and counted accurately.
- Dynamics uses the last thirteen completed calendar months; incomplete current-month data is excluded.
- Regional tables are bounded to ten rows per enriched gap.
- All provider strings are normalized and length-bounded before publication.

## Testing strategy

Implementation follows test-first development.

1. **Collector tests:** request shape, credential absence, successful parsing, invalid count handling, timeout, `429`/`5xx` retry bounds, permanent `4xx`, and partial seeds.
2. **Gap-analysis tests:** deduplication, brand classification, covered/partial/missing rules, best-page selection, and deterministic priority.
3. **Orchestration tests:** Russian routing, non-Russian `not_applicable`, two-stage enrichment, source coverage, and partial-report preservation.
4. **Artifact tests:** sanitized `evidence/wordstat.json`, evidence path registration, report JSON inclusion, and absence of credentials.
5. **Presentation tests:** Russian copy, section order, primary opportunity placement, score invariance, empty/partial states, escaping, and mobile-safe markup.
6. **Publisher tests:** optional Wordstat evidence is copied byte-identically and unrecognized files remain rejected.
7. **Live smoke:** one bounded Flowerlife run with real configured credentials, followed by desktop/mobile visual inspection and public byte-integrity verification.

## Acceptance criteria

- The Flowerlife report includes measured Wordstat demand for every successfully collected seed.
- The report distinguishes brand and non-brand demand.
- Every measured cluster has a covered, partial, missing, or not-measured state with visible method limitations.
- The first recommendation is the highest-priority measured non-brand demand gap.
- Adding or removing Wordstat evidence does not change the overall score or existing component scores.
- Wordstat failures leave a usable partial SEO report.
- The local and public report render without page-wide overflow at 390 CSS pixels.
- The published Flowerlife page and all relative evidence links return HTTP 200 and match the tracked files.
- No execution plan or audited-site mutation is created before explicit acceptance of the regenerated report.
