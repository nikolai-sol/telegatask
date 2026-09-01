# Universal WGD SEO Report Skill Design

**Date:** 2026-08-31
**Initial target:** `https://flowerlife-school.com/`
**Default market for this target:** Russia (`RU`), Russian (`ru`), Yandex region `225`

## Goal

Create a reusable Codex skill that understands requests such as “Запусти SEO-отчёт для сайта https://example.com/”, runs the strongest safe audit available for that market, produces evidence-rich HTML and JSON artifacts, and waits for explicit user acceptance before writing the final execution plan.

The first production use of the skill will create a detailed report for `flowerlife-school.com`.

## User Workflow

1. The user asks Codex to run an SEO report for a URL.
2. The skill normalizes the URL and infers market and language when they are clear. It asks one concise question only when the market or language is materially ambiguous.
3. The skill performs a provider preflight without printing secrets.
4. All available public and configured sources run. Missing owner-only sources are recorded, not treated as a reason to abort the report.
5. The skill writes the first-pass HTML and JSON report plus supporting evidence files.
6. The user reviews the report and responds with acceptance or requested changes.
7. Only after explicit acceptance, the skill rewrites the report recommendations into a final Markdown execution plan with tasks, URLs, priority, evidence, expected effect, owner, acceptance criteria, KPI, and verification method.
8. The skill does not modify the audited website or create real TelegaTask tasks without a separate explicit request.

## Architecture

The Codex skill is the conversational orchestrator. A generic repository CLI is the deterministic execution layer. The CLI owns input validation, provider preflight, bounded crawling, Lighthouse collection, Yandex probes, normalization, artifact writing, and exit codes. The skill owns the user interaction, missing-access explanation, report presentation, acceptance gate, and final-plan generation.

The implementation reuses existing SEO Agent providers and Zaruku collectors where their contracts are generic. Client-specific WGD scripts remain unchanged and are not used as the generic interface.

## Command Contract

The skill must recognize natural-language requests containing an SEO-report intent and a URL, including:

- `Запусти SEO-отчёт для сайта https://example.com/`
- `Сделай WGD для example.com`
- `Проведи подробный SEO-аудит example.com для России`

The underlying CLI accepts explicit arguments so it can be tested and run without conversational state:

```text
npm run seo:report -- --url https://example.com/ --market RU --language ru
```

Optional inputs include keyword file, additional priority URLs, crawl limit, Lighthouse page limit, and an output directory. Defaults are deterministic and recorded in the report.

## Source Policy

### Sources available without site-owner access

- HTTP and redirect inspection.
- `robots.txt` and sitemap discovery.
- Bounded internal crawl: maximum 100 HTML URLs, same-origin only, concurrency 5, per-request timeout 15 seconds.
- On-page metadata, headings, canonical, hreflang, robots directives, structured data, Open Graph, Twitter Cards, image alt coverage, internal links, duplicate metadata, and thin-content signals.
- Local Lighthouse through Chrome for the homepage and up to five priority pages. Every selected page gets two separate profiles: mobile with Lighthouse simulated mobile throttling and desktop with the desktop/provided profile.
- Yandex Search API for Russian organic SERP checks when credentials and quota are available.
- Yandex Generative Search API for query-level Alice AI source evidence when credentials and quota are available.

### Russian-market rule

For `market=RU` or `language=ru`, DataForSEO is not selected. The report records it as `not_applicable` with the reason that the current provider/location configuration does not support the required Russian market profile. DataForSEO failures must not appear as Russian-site recommendations.

Yandex Search API is the primary automated rank source. The report preserves query, region, device, found status, matched URL, position, competing domains, and collection time.

Yandex Generative Search probes report:

- whether the target domain appeared in the response sources;
- whether it was used to generate the answer;
- target source position and used-source position;
- cited URLs and answer text;
- sample visibility as `target-used queries / checked queries`.

This sample visibility is explicitly labeled as a controlled probe, not official Yandex Webmaster Share of Voice.

### Owner-only sources

- Yandex Webmaster requires OAuth and verified access to the requested host.
- Google Search Console requires OAuth and property access.

Preflight must distinguish `credentials_present` from `site_access_confirmed`. For `flowerlife-school.com`, the current Yandex Webmaster account does not contain a verified matching host, so the report must show `owner_access_required`. Google Search Console must use the same status unless property access is confirmed.

Official Alice AI Share of Voice, its trend, and top-3/top-10/top-20 visibility bands are owner-only Yandex Webmaster data. They must never be inferred from generative probes.

### Manual fallback

When Yandex Search API or generative search is unavailable, or when the user explicitly asks to verify results manually, the run writes `manual-query-pack.md`. Each row contains the exact query, region, device, and fields to capture: target position, matched URL, answer/source presence, snippet, and competitors or sources above it.

The skill can accept returned evidence as text, table, CSV, or screenshots. Imported results are labeled `manual_evidence`, preserve their capture date, and never masquerade as API evidence.

## Report Contents

The HTML report is readable by a non-technical owner and links findings to evidence. The JSON artifact is the machine-readable source of truth.

Required sections:

1. Executive summary with critical blockers, score coverage, and the top ten actions.
2. Source coverage matrix: selected, successful, partial, unavailable, not applicable, and owner access required.
3. Crawl coverage and limitations.
4. Indexability: status codes, redirects, robots directives, sitemap, canonical, hreflang, and conflicting signals.
5. On-page SEO: title, description, H1-H6, duplicates, length checks, thin-content signals, and keyword/topic alignment.
6. Internal architecture: internal links, orphan candidates within the observed graph, crawl depth, broken links, and redirect chains.
7. Media and structured data: missing alt text, JSON-LD types and validation signals, Open Graph, and Twitter Cards.
8. Lighthouse mobile-versus-desktop comparison and actionable failed audits for performance, SEO, accessibility, and best practices. The comparison includes FCP, LCP, CLS, TBT, Speed Index, total transfer size, unused JavaScript/CSS, render-blocking resources, image delivery, cache lifetime, font loading, and failed accessibility checks when Lighthouse exposes them. Lab metrics are labeled separately from CrUX field data; field Core Web Vitals are shown only when a connected source actually returns them.
9. Yandex organic visibility with query-level evidence and SERP competitors.
10. Yandex Alice AI controlled probes with answers, source URLs, and the target-domain evidence fields.
11. Owner-data coverage for Yandex Webmaster and Google Search Console, including exact connection gaps.
12. Prioritized backlog and a draft action plan.

Every finding includes severity, affected URL or scope, observed evidence, source, confidence, recommended change, expected effect, acceptance criterion, and verification method. Unsupported precision is represented with `null` or `not measured` rather than invented scores.

## Flowerlife Initial Evidence

The first run must preserve and expand the evidence already collected on 2026-08-31:

- homepage HTTP status `200`;
- `meta robots="noindex, nofollow"` on the homepage;
- missing homepage H1 and canonical;
- missing XML sitemap at common paths;
- generic title `Цветок жизни` and description `Описание для RU`;
- local Lighthouse desktop scores: Performance 98, Accessibility 82, Best Practices 77, SEO 66;
- accessibility failures for unnamed buttons and links, low contrast, and small touch targets;
- Yandex organic checks found the branded query at position 1 and `flowerlife` at position 4 in the initial sample;
- five Yandex generative probes did not use `flowerlife-school.com` as a source, including the branded probe that cited third-party sources instead;
- current Yandex Webmaster credentials do not have verified access to `flowerlife-school.com`.

The final report must rerun live evidence rather than copying these values as current facts.

## Artifact Layout

Each run writes into a timestamped directory under `reports/`:

```text
reports/wgd-<domain>-<YYYYMMDD-HHmmssZ>/
  report.html
  report.json
  evidence/
    crawl.json
    lighthouse-<slug>.json
    yandex-serp.json
    yandex-ai-probes.json
    provider-preflight.json
  manual-query-pack.md        # only when needed
  execution-plan.md           # only after user acceptance
```

Repeated runs do not overwrite earlier timestamped evidence. The HTML report references the exact JSON evidence paths.

## Error Handling and Safety

- One optional provider failure does not fail the whole audit.
- A run fails only when the input is invalid or no public page can be fetched.
- Secrets, authorization headers, tokens, and raw credential-bearing URLs are never written to artifacts or logs.
- Same-origin crawling excludes logout, account, registration, and obvious destructive/action URLs.
- Response-size and page-count limits prevent unbounded downloads.
- The CLI reports partial coverage honestly and exits successfully when a useful partial report was produced.
- No website writes, Webmaster verification changes, Search Console changes, Telegram sends, or real-task creation occur during report generation.

## Testing Strategy

- Parser and normalization unit tests use fixtures for HTML, robots, sitemap, JSON-LD, links, and provider responses.
- Crawler tests cover same-origin enforcement, limits, redirects, exclusions, duplicates, and timeouts.
- Lighthouse tests cover distinct mobile and desktop argument profiles, per-profile failures, normalized metrics, and report comparison rows.
- Report renderer tests assert required sections, escaping, evidence links, source statuses, and RU/DataForSEO policy.
- Provider preflight tests distinguish credentials from verified property access.
- CLI tests cover argument validation, partial runs, artifact paths, and exit codes without live network calls.
- Existing Yandex Search, Yandex generative search, SEO Agent, and WGD tests remain green.
- A live smoke run against `flowerlife-school.com` is performed only after deterministic tests pass.

## Acceptance Criteria

- A natural-language Codex request with a site URL activates the skill.
- The generic CLI can produce a detailed partial report without owner-only integrations.
- RU reports skip DataForSEO and prefer Yandex sources.
- Query-level Alice AI evidence is clearly separated from official Webmaster SoV.
- Missing Webmaster and GSC access produces actionable connection guidance.
- The report includes detailed crawl and Lighthouse evidence, not only aggregate scores.
- The report contains separate mobile and desktop Lighthouse results for every selected audit page and never merges the two profiles into one score.
- The first Flowerlife HTML and JSON reports are generated and opened for review.
- The execution plan is absent before acceptance and created only after the user says the report is accepted.

## Out of Scope

- Modifying `flowerlife-school.com`.
- Automatically verifying site ownership.
- Creating real TelegaTask tasks without a separate explicit request.
- Adding a Telegram bot command in this iteration.
- Treating controlled probe visibility as official Yandex Share of Voice.
