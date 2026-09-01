# Universal WGD SEO Report Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable Codex skill and deterministic CLI that produce evidence-rich SEO reports for arbitrary websites, with a Yandex-first Russian profile, mobile and desktop Lighthouse evidence, and a post-acceptance execution-plan gate.

**Architecture:** Add a focused `src/features/seoAgent/wgdReport/` module whose units parse inputs, crawl public pages, collect Lighthouse and Yandex evidence, normalize findings, and render timestamped JSON/HTML artifacts. A thin `scripts/runSeoReport.ts` entrypoint exposes the module through `npm run seo:report`; an installed Codex skill orchestrates natural-language use and the acceptance workflow.

**Tech Stack:** TypeScript 5.9, Node.js `fetch`, Vitest, Chrome/Lighthouse CLI, existing Yandex Search and Yandex Generative Search providers, existing Yandex Webmaster and GSC providers, Markdown Codex skill instructions.

## Global Constraints

- Russian profile: `market=RU`, `language=ru`, Yandex region `225` by default.
- DataForSEO is `not_applicable` for `market=RU` or `language=ru` and must not be called.
- Crawl at most 100 same-origin HTML URLs with concurrency 5 and a 15-second request timeout.
- Exclude account, registration, login, logout, checkout, and mutation-like URLs.
- Run separate mobile and desktop Lighthouse profiles for the homepage and up to five priority pages.
- Treat Yandex generative probe visibility as a controlled sample, never official Webmaster SoV.
- Yandex Webmaster and GSC require confirmed property access; credential presence alone is insufficient.
- Never log or persist secrets, auth headers, tokens, or credential-bearing URLs.
- Generate `execution-plan.md` only after explicit user acceptance of the report.
- Do not modify the audited website, verify ownership, send Telegram messages, or create real tasks.
- Preserve unrelated changes already present in the dirty worktree.

---

## File Structure

- `src/features/seoAgent/wgdReport/types.ts`: shared input, evidence, finding, and artifact contracts.
- `src/features/seoAgent/wgdReport/cliOptions.ts`: deterministic argument parsing and RU source policy.
- `src/features/seoAgent/wgdReport/htmlAnalyzer.ts`: pure HTML metadata, link, media, and structured-data extraction.
- `src/features/seoAgent/wgdReport/siteCrawler.ts`: bounded same-origin crawl and aggregate duplicate/broken-link evidence.
- `src/features/seoAgent/wgdReport/lighthouseCollector.ts`: mobile/desktop Lighthouse invocation and normalization.
- `src/features/seoAgent/wgdReport/providerPreflight.ts`: safe source availability and owner-access classification.
- `src/features/seoAgent/wgdReport/yandexEvidence.ts`: existing Yandex SERP and generative collector adapters.
- `src/features/seoAgent/wgdReport/findings.ts`: evidence-to-finding rules and prioritized backlog.
- `src/features/seoAgent/wgdReport/reportRenderer.ts`: escaped, readable HTML report.
- `src/features/seoAgent/wgdReport/artifactWriter.ts`: timestamped JSON/evidence layout and manual query pack.
- `src/features/seoAgent/wgdReport/runWgdReport.ts`: orchestration boundary with dependency injection.
- `scripts/runSeoReport.ts`: CLI entrypoint.
- `/Users/nafanya/.codex/skills/seo-report/SKILL.md`: natural-language orchestration and acceptance gate.
- `/Users/nafanya/.codex/skills/seo-report/references/report-workflow.md`: stable runbook loaded by the skill.
- `/Users/nafanya/.codex/skills/seo-report/agents/openai.yaml`: generated UI metadata with implicit invocation enabled.

---

### Task 1: Shared contracts and CLI options

**Files:**
- Create: `src/features/seoAgent/wgdReport/types.ts`
- Create: `src/features/seoAgent/wgdReport/cliOptions.ts`
- Test: `src/features/seoAgent/wgdReport/cliOptions.test.ts`

**Interfaces:**
- Produces: `WgdReportOptions`, `SourceCoverage`, `PageEvidence`, `LighthouseEvidence`, `WgdFinding`, `WgdReportPayload`, `parseWgdCliOptions(argv)`.
- Consumes: no project state or network.

- [ ] **Step 1: Write failing option-policy tests**

```ts
import { describe, expect, test } from "vitest";
import { parseWgdCliOptions } from "./cliOptions";

describe("parseWgdCliOptions", () => {
  test("normalizes a Russian report and skips DataForSEO", () => {
    const options = parseWgdCliOptions([
      "--url", "flowerlife-school.com",
      "--market", "RU",
      "--language", "ru",
      "--keyword", "цветок жизни школа",
    ]);
    expect(options.url).toBe("https://flowerlife-school.com/");
    expect(options.domain).toBe("flowerlife-school.com");
    expect(options.region).toBe("225");
    expect(options.sources.dataForSeo).toBe("not_applicable");
    expect(options.keywords).toEqual(["цветок жизни школа"]);
  });

  test("rejects non-http input", () => {
    expect(() => parseWgdCliOptions(["--url", "file:///tmp/a"])).toThrow("HTTP or HTTPS");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run src/features/seoAgent/wgdReport/cliOptions.test.ts`
Expected: FAIL because `cliOptions.ts` does not exist.

- [ ] **Step 3: Add the explicit contracts and minimal parser**

```ts
export type WgdMarket = "RU" | "AT" | "DE" | "OTHER";
export type WgdDevice = "mobile" | "desktop";
export type CoverageState = "success" | "partial" | "unavailable" | "not_applicable" | "owner_access_required";

export type WgdReportOptions = {
  url: string;
  domain: string;
  market: WgdMarket;
  language: string;
  region: string;
  crawlLimit: number;
  lighthousePageLimit: number;
  keywords: string[];
  aiQueries: string[];
  priorityUrls: string[];
  outDir: string;
  sources: { dataForSeo: CoverageState };
};
```

Implement `parseWgdCliOptions` with repeated `--keyword`, `--ai-query`, and `--priority-url` support, defaults `crawlLimit=100`, `lighthousePageLimit=6`, and a sanitized default output root of `reports`.

- [ ] **Step 4: Verify GREEN and build compatibility**

Run: `npx vitest run src/features/seoAgent/wgdReport/cliOptions.test.ts && npm run build`
Expected: focused tests PASS and TypeScript build exits `0`.

- [ ] **Step 5: Commit only Task 1 files**

```bash
git add src/features/seoAgent/wgdReport/types.ts src/features/seoAgent/wgdReport/cliOptions.ts src/features/seoAgent/wgdReport/cliOptions.test.ts
git commit -m "feat(seo): define generic WGD report options"
```

### Task 2: Pure HTML analysis

**Files:**
- Create: `src/features/seoAgent/wgdReport/htmlAnalyzer.ts`
- Test: `src/features/seoAgent/wgdReport/htmlAnalyzer.test.ts`
- Modify: `src/features/seoAgent/wgdReport/types.ts`

**Interfaces:**
- Consumes: `{ requestedUrl, finalUrl, status, headers, html }`.
- Produces: `analyzeHtmlPage(input): PageEvidence` with title, description, robots, canonical, hreflang, headings, links, JSON-LD types/errors, Open Graph, Twitter Cards, image/alt counts, word count, and indexability.

- [ ] **Step 1: Write failing extraction tests using an inline fixture**

```ts
test("extracts indexability, metadata, structure, links, media, and schema", () => {
  const page = analyzeHtmlPage({
    requestedUrl: "https://example.com/",
    finalUrl: "https://example.com/ru",
    status: 200,
    headers: { "content-type": "text/html", "x-robots-tag": "" },
    html: `<html lang="ru"><head>
      <title>Курс</title><meta name="description" content="Описание">
      <meta name="robots" content="noindex,nofollow">
      <link rel="canonical" href="https://example.com/ru">
      <link rel="alternate" hreflang="ru" href="https://example.com/ru">
      <meta property="og:title" content="Курс">
      <script type="application/ld+json">{"@type":"Organization"}</script>
    </head><body><h1>Курс</h1><h2>Программа</h2>
      <a href="/courses/1">Подробнее</a><img src="/hero.jpg" alt="">
    </body></html>`,
  });
  expect(page.indexable).toBe(false);
  expect(page.robots).toContain("noindex");
  expect(page.headings.h1).toEqual(["Курс"]);
  expect(page.schemaTypes).toEqual(["Organization"]);
  expect(page.images).toEqual({ total: 1, missingAlt: 1 });
  expect(page.internalLinks).toEqual(["https://example.com/courses/1"]);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run src/features/seoAgent/wgdReport/htmlAnalyzer.test.ts`
Expected: FAIL because `analyzeHtmlPage` is missing.

- [ ] **Step 3: Implement deterministic regex-based extraction**

Use bounded helpers that accept both attribute orders for meta/link tags, decode common entities, strip scripts/styles before word counting, catch JSON-LD parse errors, normalize same-origin links, and exclude non-HTTP schemes. Do not add a parser dependency.

- [ ] **Step 4: Add edge-case tests and verify GREEN**

Add tests for reversed meta attributes, `X-Robots-Tag`, invalid JSON-LD, fragments, `mailto:`, duplicate links, and subdomain exclusion.
Run: `npx vitest run src/features/seoAgent/wgdReport/htmlAnalyzer.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/features/seoAgent/wgdReport/types.ts src/features/seoAgent/wgdReport/htmlAnalyzer.ts src/features/seoAgent/wgdReport/htmlAnalyzer.test.ts
git commit -m "feat(seo): analyze WGD page metadata"
```

### Task 3: Bounded site crawler and aggregate evidence

**Files:**
- Create: `src/features/seoAgent/wgdReport/siteCrawler.ts`
- Test: `src/features/seoAgent/wgdReport/siteCrawler.test.ts`
- Modify: `src/features/seoAgent/wgdReport/types.ts`

**Interfaces:**
- Consumes: `crawlSite({ startUrl, limit, concurrency, timeoutMs }, deps)`.
- Produces: `CrawlEvidence` with pages, robots, sitemap candidates, discovered URLs, broken links, redirect chains, duplicate titles/descriptions, and crawl limitations.

- [ ] **Step 1: Write failing graph-and-limit tests**

```ts
test("crawls same-origin HTML breadth-first and respects exclusions and limit", async () => {
  const responses = new Map([
    ["https://example.com/", html(200, `<a href="/a">A</a><a href="/login">Login</a><a href="https://other.test/x">X</a>`) ],
    ["https://example.com/a", html(200, `<title>A</title><a href="/b">B</a>`) ],
    ["https://example.com/b", html(404, `<title>Missing</title>`) ],
  ]);
  const result = await crawlSite({ startUrl: "https://example.com/", limit: 3, concurrency: 2, timeoutMs: 1000 }, fakeFetch(responses));
  expect(result.pages.map((p) => p.requestedUrl)).toEqual([
    "https://example.com/", "https://example.com/a", "https://example.com/b",
  ]);
  expect(result.excludedUrls).toContain("https://example.com/login");
  expect(result.brokenUrls).toContain("https://example.com/b");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run src/features/seoAgent/wgdReport/siteCrawler.test.ts`
Expected: FAIL because crawler is missing.

- [ ] **Step 3: Implement the bounded queue**

Implement `fetchWithTimeout`, same-origin normalization, mutation-path exclusions, HTML content-type checks, `robots.txt` fetch, common sitemap candidates plus sitemap URLs found in robots, sitemap-index recursion capped at 10 files, and URL de-duplication. Use `analyzeHtmlPage` for every HTML response.

- [ ] **Step 4: Add aggregate tests and verify GREEN**

Cover duplicate titles/descriptions, redirect final URLs, non-HTML resources, sitemap discovery, timeouts, and 100-page truncation.
Run: `npx vitest run src/features/seoAgent/wgdReport/siteCrawler.test.ts src/features/seoAgent/wgdReport/htmlAnalyzer.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/features/seoAgent/wgdReport/types.ts src/features/seoAgent/wgdReport/siteCrawler.ts src/features/seoAgent/wgdReport/siteCrawler.test.ts
git commit -m "feat(seo): add bounded WGD site crawler"
```

### Task 4: Mobile and desktop Lighthouse collection

**Files:**
- Create: `src/features/seoAgent/wgdReport/lighthouseCollector.ts`
- Test: `src/features/seoAgent/wgdReport/lighthouseCollector.test.ts`
- Modify: `src/features/seoAgent/wgdReport/types.ts`

**Interfaces:**
- Consumes: `collectLighthouseProfiles(urls, execImpl)`.
- Produces: one `LighthouseEvidence` per URL/device plus raw payloads for evidence files.

- [ ] **Step 1: Write failing argument and normalization tests**

```ts
test("runs distinct mobile and desktop profiles", () => {
  const calls: string[][] = [];
  const execImpl = (_file: string, args: string[]) => {
    calls.push(args);
    return JSON.stringify(lighthouseFixture());
  };
  const result = collectLighthouseProfiles(["https://example.com/"], execImpl);
  expect(calls).toHaveLength(2);
  expect(calls[0]).toContain("--form-factor=mobile");
  expect(calls[0]).toContain("--throttling-method=simulate");
  expect(calls[1]).toContain("--preset=desktop");
  expect(calls[1]).toContain("--throttling-method=provided");
  expect(result.map((item) => item.device)).toEqual(["mobile", "desktop"]);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run src/features/seoAgent/wgdReport/lighthouseCollector.test.ts`
Expected: FAIL because the collector is missing.

- [ ] **Step 3: Implement collection and detailed failed-audit mapping**

Invoke `npx -y lighthouse@13.4.1` with JSON stdout, 40 MB buffer, and existing Chrome flags. Normalize category scores, FCP, LCP, CLS, TBT, Speed Index, transfer size, unused JS/CSS, cache/font/render-blocking insights, and failed accessibility/SEO audits. Catch each profile independently so one failure does not erase the other profile.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/seoAgent/wgdReport/lighthouseCollector.test.ts`
Expected: argument, normalization, and partial-failure tests PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/features/seoAgent/wgdReport/types.ts src/features/seoAgent/wgdReport/lighthouseCollector.ts src/features/seoAgent/wgdReport/lighthouseCollector.test.ts
git commit -m "feat(seo): compare mobile and desktop Lighthouse"
```

### Task 5: Provider preflight and Yandex evidence adapters

**Files:**
- Create: `src/features/seoAgent/wgdReport/providerPreflight.ts`
- Create: `src/features/seoAgent/wgdReport/yandexEvidence.ts`
- Test: `src/features/seoAgent/wgdReport/providerPreflight.test.ts`
- Test: `src/features/seoAgent/wgdReport/yandexEvidence.test.ts`

**Interfaces:**
- Consumes: `preflightProviders(options, env, deps)` and `collectYandexEvidence(options, deps)`.
- Produces: safe coverage rows, Yandex SERP checks, Alice AI probes, optional Yandex Webmaster snapshot, and optional GSC snapshot.

- [ ] **Step 1: Write failing RU policy and owner-access tests**

```ts
test("marks DataForSEO not applicable and distinguishes Yandex credentials from host access", async () => {
  const coverage = await preflightProviders(ruOptions(), {
    YANDEX_SEARCH_API_KEY: "present",
    YANDEX_SEARCH_FOLDER_ID: "present",
    YANDEX_WEBMASTER_OAUTH_TOKEN: "present",
  }, {
    checkYandexHost: async () => false,
    checkGscProperty: async () => false,
  });
  expect(coverage.find((x) => x.id === "dataforseo")?.state).toBe("not_applicable");
  expect(coverage.find((x) => x.id === "yandex_search")?.state).toBe("success");
  expect(coverage.find((x) => x.id === "yandex_webmaster")?.state).toBe("owner_access_required");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run src/features/seoAgent/wgdReport/providerPreflight.test.ts src/features/seoAgent/wgdReport/yandexEvidence.test.ts`
Expected: FAIL because adapters are missing.

- [ ] **Step 3: Implement safe preflight**

Reuse `YandexWebmasterSeoSource` and `GoogleSearchConsoleSeoSource` only behind injected access checks. Convert provider errors into safe states and messages; never include raw error bodies. For Flowerlife, classify the existing Yandex OAuth credentials as present but the domain as `owner_access_required`.

- [ ] **Step 4: Implement Yandex adapters**

Call `YandexSerpRankSource.run` with RU region/language/device and call `collectYandexGenSearchProbes` with the generic structural config. Preserve target-used/source positions and compute sample visibility only as `{ used, checked, rate }`. Generate manual query rows when credentials are missing or probes fail.

- [ ] **Step 5: Verify GREEN and existing provider tests**

Run: `npx vitest run src/features/seoAgent/wgdReport/providerPreflight.test.ts src/features/seoAgent/wgdReport/yandexEvidence.test.ts src/features/seoAgent/providers/googleSearchConsoleSeoSource.test.ts src/features/seoAgent/production/zaruku/collectors/yandexGenSearchProbeCollector.test.ts`
Expected: all tests PASS without live API calls.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/features/seoAgent/wgdReport/providerPreflight.ts src/features/seoAgent/wgdReport/yandexEvidence.ts src/features/seoAgent/wgdReport/providerPreflight.test.ts src/features/seoAgent/wgdReport/yandexEvidence.test.ts
git commit -m "feat(seo): add Yandex-first WGD evidence policy"
```

### Task 6: Findings, HTML renderer, and artifact writer

**Files:**
- Create: `src/features/seoAgent/wgdReport/findings.ts`
- Create: `src/features/seoAgent/wgdReport/reportRenderer.ts`
- Create: `src/features/seoAgent/wgdReport/artifactWriter.ts`
- Test: `src/features/seoAgent/wgdReport/findings.test.ts`
- Test: `src/features/seoAgent/wgdReport/reportRenderer.test.ts`
- Test: `src/features/seoAgent/wgdReport/artifactWriter.test.ts`

**Interfaces:**
- Consumes: crawl, Lighthouse, provider coverage, SERP, AI, and owner-source evidence.
- Produces: prioritized `WgdFinding[]`, escaped `renderWgdHtml(payload)`, and timestamped artifact paths.

- [ ] **Step 1: Write failing Flowerlife-like finding tests**

```ts
test("prioritizes index blocking above metadata and accessibility findings", () => {
  const findings = buildWgdFindings(flowerlifeLikeEvidence());
  expect(findings[0]).toMatchObject({ code: "homepage_noindex", severity: "critical" });
  expect(findings.map((x) => x.code)).toEqual(expect.arrayContaining([
    "missing_sitemap", "missing_h1", "missing_canonical", "generic_description", "alice_ai_not_used",
  ]));
  expect(findings.every((x) => x.evidence && x.verification)).toBe(true);
});
```

- [ ] **Step 2: Write failing renderer and artifact tests**

Assert the HTML contains source coverage, crawl, indexability, mobile/desktop comparison, detailed failed audits, Yandex SERP, Alice AI, owner access, prioritized backlog, limitations, and escaped hostile fixture text. Assert the writer creates `wgd-example-com-YYYYMMDD-HHmmssZ/report.json`, `report.html`, and evidence files without `execution-plan.md`.

- [ ] **Step 3: Run and verify RED**

Run: `npx vitest run src/features/seoAgent/wgdReport/findings.test.ts src/features/seoAgent/wgdReport/reportRenderer.test.ts src/features/seoAgent/wgdReport/artifactWriter.test.ts`
Expected: FAIL because modules are missing.

- [ ] **Step 4: Implement deterministic finding rules**

Use severity order `critical > high > medium > low`, stable codes, affected URL/scope, evidence string, source, confidence, action, expected effect, acceptance criterion, and verification. Add cross-page rules for duplicate metadata, broken links, thin content, missing alt, crawl truncation, and mobile/desktop regressions. Keep heuristic labels explicit.

- [ ] **Step 5: Implement HTML and artifact output**

Render semantic sections with responsive CSS, tables that scroll on mobile, source-status badges, and links to evidence paths. Write JSON atomically through a temporary file and rename. Create `manual-query-pack.md` only when manual rows exist. Do not write an execution plan.

- [ ] **Step 6: Verify GREEN**

Run: `npx vitest run src/features/seoAgent/wgdReport/findings.test.ts src/features/seoAgent/wgdReport/reportRenderer.test.ts src/features/seoAgent/wgdReport/artifactWriter.test.ts`
Expected: all tests PASS and no unescaped fixture HTML appears.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/features/seoAgent/wgdReport/findings.ts src/features/seoAgent/wgdReport/reportRenderer.ts src/features/seoAgent/wgdReport/artifactWriter.ts src/features/seoAgent/wgdReport/findings.test.ts src/features/seoAgent/wgdReport/reportRenderer.test.ts src/features/seoAgent/wgdReport/artifactWriter.test.ts
git commit -m "feat(seo): render evidence-rich WGD reports"
```

### Task 7: Orchestration, CLI entrypoint, and package command

**Files:**
- Create: `src/features/seoAgent/wgdReport/runWgdReport.ts`
- Test: `src/features/seoAgent/wgdReport/runWgdReport.test.ts`
- Create: `scripts/runSeoReport.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `runWgdReport(options, deps)`.
- Produces: `{ reportDir, htmlPath, jsonPath, manualQueryPackPath, summary }`.

- [ ] **Step 1: Write a failing partial-run orchestration test**

Inject a two-page crawl, one successful and one failed Lighthouse profile, unavailable owner sources, successful Yandex evidence, and an in-memory artifact writer. Assert a useful partial result, stable coverage states, no DataForSEO invocation, and no execution plan.

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run src/features/seoAgent/wgdReport/runWgdReport.test.ts`
Expected: FAIL because the orchestrator is missing.

- [ ] **Step 3: Implement orchestration and priority-page selection**

Run preflight and crawl first. Select Lighthouse pages in this deterministic order: homepage, explicit priority URLs in argument order, then crawl pages sorted by crawl depth and discovery order until the configured limit. Collect Lighthouse and Yandex evidence, build findings, assemble `WgdReportPayload`, and write artifacts. A public-page fetch failure is fatal; optional provider failures remain partial.

- [ ] **Step 4: Add the CLI and package script**

```json
"seo:report": "node -r ts-node/register/transpile-only scripts/runSeoReport.ts"
```

The CLI prints only the run summary and artifact paths as JSON, sets exit code `1` for invalid/fatal runs, and never prints secrets.

- [ ] **Step 5: Verify GREEN and CLI help/error behavior**

Run: `npx vitest run src/features/seoAgent/wgdReport/runWgdReport.test.ts src/features/seoAgent/wgdReport/*.test.ts && npm run build && npm run seo:report -- --help`
Expected: tests PASS, build exits `0`, and help lists URL/market/language/keyword/AI/crawl/Lighthouse options.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/features/seoAgent/wgdReport/runWgdReport.ts src/features/seoAgent/wgdReport/runWgdReport.test.ts scripts/runSeoReport.ts package.json
git commit -m "feat(seo): add universal SEO report command"
```

### Task 8: Create and validate the Codex skill

**Files:**
- Create: `/Users/nafanya/.codex/skills/seo-report/SKILL.md`
- Create: `/Users/nafanya/.codex/skills/seo-report/references/report-workflow.md`
- Create: `/Users/nafanya/.codex/skills/seo-report/agents/openai.yaml`

**Interfaces:**
- Consumes: a natural-language SEO-report request containing a URL and the repository `npm run seo:report` command.
- Produces: report invocation, artifact presentation, missing-access guidance, explicit acceptance gate, and post-acceptance `execution-plan.md`.

- [ ] **Step 1: Record the observed RED baseline and initialize the skill**

Read `skill-creator` and `writing-skills` completely. Record the already-observed no-skill failures from this session: the repository had only client-specific WGD runners, the first RU run attempted DataForSEO, the initial report design did not require mobile Lighthouse, and credential presence initially needed a separate verified-host check. Initialize the skill without examples:

```bash
python3 /Users/nafanya/.codex/skills/.system/skill-creator/scripts/init_skill.py \
  seo-report \
  --path /Users/nafanya/.codex/skills \
  --resources references \
  --interface display_name="SEO Report" \
  --interface short_description="Run evidence-rich website SEO reports" \
  --interface default_prompt="Use $seo-report to audit https://example.com/."
```

- [ ] **Step 2: Write the skill trigger and compact main workflow**

The skill description must trigger on Russian and English forms of SEO report, SEO audit, WGD, and a supplied website URL. `SKILL.md` must route detailed execution rules to `references/report-workflow.md` and keep the acceptance gate in the main file.

- [ ] **Step 3: Write the reference runbook**

Include preflight, RU/DataForSEO rule, Yandex Search and Alice AI behavior, owner-only source handling, manual query pack ingestion, mobile/desktop Lighthouse requirement, safe artifact presentation, and the exact post-acceptance execution-plan schema.

- [ ] **Step 4: Validate skill structure and trigger clarity**

```bash
python3 /Users/nafanya/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  /Users/nafanya/.codex/skills/seo-report
```

Then inspect the complete skill for unfinished scaffold markers, contradictory gates, unsafe secret handling, and assumptions about the current directory. Run the four observed baseline scenarios against the written instructions as a decision table and confirm the prescribed action is respectively: generic CLI, RU/Yandex routing, dual Lighthouse profiles, and owner-access classification.
Expected: validator exits `0`; every scenario maps to the required action. Because no independent-agent delegation was requested for this task, report behavioral forward-testing as not independently sampled rather than claiming it passed.

### Task 9: Live Flowerlife report and full verification

**Files:**
- Generate: `reports/wgd-flowerlife-school-com-<timestamp>/report.html`
- Generate: `reports/wgd-flowerlife-school-com-<timestamp>/report.json`
- Generate: `reports/wgd-flowerlife-school-com-<timestamp>/evidence/*`
- Generate conditionally: `reports/wgd-flowerlife-school-com-<timestamp>/manual-query-pack.md`

**Interfaces:**
- Consumes: the finished CLI, `https://flowerlife-school.com/`, RU profile, five organic keywords, and five Alice AI questions.
- Produces: the reviewable report artifacts; no execution plan yet.

- [ ] **Step 1: Run focused and full deterministic verification**

Run: `npx vitest run src/features/seoAgent/wgdReport/*.test.ts`
Expected: all WGD report tests PASS.

Run: `npm test`
Expected: complete repository test suite exits `0` with zero failures.

Run: `npm run build`
Expected: TypeScript build exits `0`.

- [ ] **Step 2: Run the live RU report**

```bash
npm run seo:report -- \
  --url https://flowerlife-school.com/ \
  --market RU \
  --language ru \
  --region 225 \
  --keyword "цветок жизни школа" \
  --keyword "платформа саморазвития" \
  --keyword "онлайн курсы саморазвития" \
  --keyword "курсы духовного развития" \
  --keyword "курсы ароматерапии онлайн" \
  --ai-query "Что такое школа Цветок жизни и какие курсы она предлагает?" \
  --ai-query "Где пройти онлайн-курсы по саморазвитию?" \
  --ai-query "Какие есть онлайн-курсы по духовному развитию?" \
  --ai-query "Где пройти онлайн-курс по ароматерапии?" \
  --ai-query "Где пройти курс по сакральной геометрии для начинающих?"
```

Expected: command exits `0`, prints HTML/JSON paths, skips DataForSEO, records Yandex Webmaster/GSC owner-access gaps, and writes no `execution-plan.md`.

- [ ] **Step 3: Inspect generated evidence and report requirements**

Check JSON for crawl count/limits, mobile and desktop Lighthouse rows, Yandex SERP checks, Alice AI probes, source coverage, and finding completeness. Check HTML visually for readable mobile/desktop comparisons, critical `noindex` prominence, source limitations, actionable backlog, and evidence links.

- [ ] **Step 4: Open the HTML report for user review**

Open the generated `report.html` in the Codex browser/file panel and provide the artifact links. Ask the user to accept or request changes. Do not create `execution-plan.md` until they explicitly accept the report.

---

## Plan Self-Review

- Spec coverage: tasks cover the CLI, bounded crawl, detailed metadata, mobile/desktop Lighthouse, Yandex SERP and Alice AI, owner-only gaps, artifact layout, Codex skill, and acceptance gate.
- Placeholder scan: the plan contains no unfinished implementation markers or unspecified test steps.
- Type consistency: later tasks consume the contracts introduced in Task 1; runner and skill use the exact `npm run seo:report` interface defined in Task 7.
- Scope: no Telegram command, website mutation, ownership verification, or automatic real-task creation is included.
