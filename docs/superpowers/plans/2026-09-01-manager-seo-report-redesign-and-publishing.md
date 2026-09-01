# Manager-first Russian SEO Report and GitHub Pages Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the technical-first WGD HTML with a scored, manager-first Russian report, regenerate the Flowerlife audit, and publish the verified bundle through the repository's existing GitHub Pages workflow.

**Architecture:** Extend normalized crawl and Yandex evidence only where the approved scoring formula needs explicit provenance. Calculate scores and finding groups in pure modules, build a locale-safe manager presentation model that cannot access raw English evidence strings, and keep the HTML renderer focused on escaped layout. Publish only an allowlisted copy of the final generated bundle to `mini-app/seo-reports/flowerlife-school/`; the existing Pages workflow deploys that directory after the final push to `main`.

**Tech Stack:** TypeScript 5.9, Node.js 22.19+, Vitest, `robots-parser` 3.0.1, Lighthouse 13.4.1, static HTML/CSS with native `details`, GitHub Pages and GitHub CLI.

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-09-01-manager-seo-report-redesign-design.md`.
- The open report order is: overall score, main problems, Yandex positions, Alice visibility, speed, priority actions, then closed technical details.
- For `language=ru`, every visible heading, status, finding title, impact, action, empty state, date, and limitation is Russian.
- Raw `finding.evidence`, `finding.action`, provider messages, Lighthouse titles/descriptions, finding codes, and internal state names never enter the open manager model.
- Overall nominal weights are technical 40%, Yandex 25%, Lighthouse speed/UX 20%, and Alice 15%.
- `collectionCoverage` and `scoringCoverage` remain separate; overall display thresholds are 80% and 60% exactly as approved.
- Yandex Search checks the first 20 results. A missing `checkedDepth` is unscored legacy evidence, never an implicit top-20 check.
- Lighthouse contributes only complete successful mobile/desktop pairs with numeric required categories. Lighthouse SEO is not included in speed/UX.
- Homepage or majority public-content `noindex` caps the site score at 39. A page intended for indexing but carrying `noindex` is capped at 39.
- Yandex Webmaster and Google Search Console access gaps do not reduce the score.
- DataForSEO remains `not_applicable` for `market=RU` or `language=ru` and is not called.
- HTML contains `<meta name="robots" content="noindex,nofollow">` because the shared report is public but not intended for search indexing.
- Page, methodology, site-technical, and specialist-data details are closed by default and have no `open` attribute.
- Keep `report.json` and evidence rich; do not create `execution-plan.md` before the user accepts the redesigned report itself.
- Publish only `index.html`, `report.json`, and `evidence/*.json`. Never publish secrets, manual packs, execution plans, symlinks, or arbitrary files.
- The approved public URL is `https://nikolai-sol.github.io/telegatask/seo-reports/flowerlife-school/`. Do not use the currently unresolved `taskbot.pldata.io` domain.
- Future public reports still require separate explicit approval.
- Preserve unrelated user changes and keep every task commit scoped to its listed files.

---

## File Structure

- `src/features/seoAgent/types.ts`: add explicit Yandex checked-depth provenance.
- `src/features/seoAgent/wgdReport/types.ts`: add crawl coverage, structured signal conflicts, score, group, and published-payload contracts.
- `src/features/seoAgent/wgdReport/htmlAnalyzer.ts`: emit structured signal conflicts and observe every unique internal URL before evidence retention limits.
- `src/features/seoAgent/wgdReport/siteCrawler.ts`: retain bounded evidence while counting attempted, eligible, and dropped crawl URLs and robots access.
- `src/features/seoAgent/wgdReport/managerScoring.ts`: pure scoring and page-score calculations.
- `src/features/seoAgent/wgdReport/findingCatalog.ts`: known finding codes, deterministic rank, manager eligibility, stage, and technical anchor.
- `src/features/seoAgent/wgdReport/findingGroups.ts`: structured site/page aggregation without parsing prose.
- `src/features/seoAgent/wgdReport/reportLocalization.ts`: exhaustive Russian and English fallback dictionaries.
- `src/features/seoAgent/wgdReport/managerPresentation.ts`: safe view model for all open and collapsible HTML sections.
- `src/features/seoAgent/wgdReport/reportHtml.ts`: escaping, links, score-band, details, and small table helpers.
- `src/features/seoAgent/wgdReport/managerReportRenderer.ts`: open manager sections only.
- `src/features/seoAgent/wgdReport/technicalReportRenderer.ts`: localized page, methodology, site, and specialist details.
- `src/features/seoAgent/wgdReport/reportModel.ts`: idempotent schema-2 published payload builder.
- `src/features/seoAgent/wgdReport/reportRenderer.ts`: HTML shell and renderer composition.
- `src/features/seoAgent/wgdReport/pagesPublisher.ts`: validated allowlist copy into the tracked Pages directory.
- `scripts/publishSeoReport.ts`: CLI wrapper for the Pages publisher.
- `docs/COMMANDS.md`: reusable manager-report and opt-in publication commands.
- `/Users/nafanya/.codex/skills/seo-report/SKILL.md`: manager-first and separate-publication approval contract.
- `/Users/nafanya/.codex/skills/seo-report/references/report-workflow.md`: detailed run, review, and publication gates.

---

### Task 1: Exact crawl coverage before retention limits

**Files:**
- Modify: `src/features/seoAgent/wgdReport/types.ts`
- Modify: `src/features/seoAgent/wgdReport/htmlAnalyzer.ts`
- Modify: `src/features/seoAgent/wgdReport/htmlAnalyzer.test.ts`
- Modify: `src/features/seoAgent/wgdReport/siteCrawler.ts`
- Modify: `src/features/seoAgent/wgdReport/siteCrawler.test.ts`
- Modify: `src/features/seoAgent/wgdReport/findings.test.ts`
- Modify: `src/features/seoAgent/wgdReport/runWgdReport.test.ts`
- Modify: `src/features/seoAgent/wgdReport/artifactWriter.test.ts`
- Modify: `src/features/seoAgent/wgdReport/reportRenderer.test.ts`

**Interfaces:**
- Preserves: `crawlSite(options, deps): Promise<CrawlEvidence>`.
- Adds: `HtmlAnalysisOptions.onDiscoveredInternalUrl?: (url: string) => void`.
- Adds to `CrawlEvidence`: `attemptedUrlCount`, `eligibleDiscoveredCount`, `droppedEligibleCount`, and `truncated`.

- [ ] **Step 1: Add RED tests for pre-cap observation and structured counters**

```ts
test("observes unique internal URLs before evidence retention", () => {
  const observed: string[] = [];
  const page = analyzeHtmlPage(htmlInput(`
    <a href="/a">A</a><a href="/b">B</a><a href="/b">B again</a>
  `), { maxInternalLinks: 1, onDiscoveredInternalUrl: (url) => observed.push(url) });

  expect(page.internalLinks).toEqual(["https://example.com/a"]);
  expect(observed).toEqual(["https://example.com/a", "https://example.com/b"]);
});

test("counts unique eligible URLs dropped by the crawl limit", async () => {
  const result = await crawlSite({
    startUrl: "https://example.com/",
    limit: 2,
    concurrency: 1,
    timeoutMs: 1000,
  }, fakeFetch(new Map([
    ["https://example.com/", html(200, `<a href="/a">A</a><a href="/b">B</a>`)],
    ["https://example.com/a", html(200, "A")],
  ])));

  expect(result).toMatchObject({
    attemptedUrlCount: 2,
    eligibleDiscoveredCount: 3,
    droppedEligibleCount: 1,
    truncated: true,
  });
});
```

Add equivalent sitemap-overflow, duplicate-priority, non-HTML, mutation-path, and concurrency-invariance tests. Require `truncated === (droppedEligibleCount > 0)` and `pages.length <= attemptedUrlCount`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run src/features/seoAgent/wgdReport/htmlAnalyzer.test.ts src/features/seoAgent/wgdReport/siteCrawler.test.ts
```

Expected: FAIL because the callback and four fields do not exist.

- [ ] **Step 3: Implement separate observed, admitted, and retained URL sets**

Use this contract in `types.ts`:

```ts
export type CrawlEvidence = {
  attemptedUrlCount: number;
  eligibleDiscoveredCount: number;
  droppedEligibleCount: number;
  truncated: boolean;
  pages: PageEvidence[];
  robots: RobotsEvidence;
  sitemapCandidates: SitemapCandidate[];
  discoveredUrls: string[];
  excludedUrls: string[];
  brokenUrls: string[];
  redirectChains: RedirectChain[];
  duplicateTitles: Record<string, string[]>;
  duplicateDescriptions: Record<string, string[]>;
  limitations: string[];
};
```

In `collectLinks`, keep an `observed` set independent of `retained`; call `onDiscoveredInternalUrl` exactly once for each normalized same-origin URL before applying `maxLinks` or `maxInternalLinks`.

In `siteCrawler.ts`, use `eligibleUrls` for every unique allowed start/priority/sitemap/internal URL and `admittedUrls` only for URLs admitted to the bounded queue. Extend `extractSitemapLocations` with `onUniqueUrl?: (url: string) => void`, scan the whole bounded XML body even after retained evidence is full, and do not count sitemap-index file URLs as page candidates. Return:

```ts
const droppedEligibleCount = eligibleUrls.size - admittedUrls.size;
return {
  attemptedUrlCount: attempted,
  eligibleDiscoveredCount: eligibleUrls.size,
  droppedEligibleCount,
  truncated: droppedEligibleCount > 0,
  // existing evidence fields follow unchanged
};
```

Emit `Page crawl truncated after ${attempted} URLs.` only when `droppedEligibleCount > 0`.

- [ ] **Step 4: Update typed crawl fixtures without changing their meaning**

For complete one-page fixtures, add:

```ts
attemptedUrlCount: 1,
eligibleDiscoveredCount: 1,
droppedEligibleCount: 0,
truncated: false,
```

Use counts matching each fixture's existing graph; do not use blanket casts to bypass the new contract.

- [ ] **Step 5: Verify GREEN and regression compatibility**

Run:

```bash
npx vitest run src/features/seoAgent/wgdReport/htmlAnalyzer.test.ts src/features/seoAgent/wgdReport/siteCrawler.test.ts src/features/seoAgent/wgdReport/findings.test.ts src/features/seoAgent/wgdReport/runWgdReport.test.ts src/features/seoAgent/wgdReport/artifactWriter.test.ts src/features/seoAgent/wgdReport/reportRenderer.test.ts
npm run build
```

Expected: all focused tests PASS and TypeScript build exits `0`.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/features/seoAgent/wgdReport/types.ts src/features/seoAgent/wgdReport/htmlAnalyzer.ts src/features/seoAgent/wgdReport/htmlAnalyzer.test.ts src/features/seoAgent/wgdReport/siteCrawler.ts src/features/seoAgent/wgdReport/siteCrawler.test.ts src/features/seoAgent/wgdReport/findings.test.ts src/features/seoAgent/wgdReport/runWgdReport.test.ts src/features/seoAgent/wgdReport/artifactWriter.test.ts src/features/seoAgent/wgdReport/reportRenderer.test.ts
git commit -m "feat(seo): record exact crawl coverage"
```

### Task 2: Scoreable robots, signal-conflict, and Yandex-depth provenance

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/features/seoAgent/types.ts`
- Modify: `src/features/seoAgent/providers/yandexSerpRankSource.ts`
- Modify: `src/features/seoAgent/providers/yandexSerpRankSource.test.ts`
- Modify: `src/features/seoAgent/wgdReport/types.ts`
- Modify: `src/features/seoAgent/wgdReport/htmlAnalyzer.ts`
- Modify: `src/features/seoAgent/wgdReport/htmlAnalyzer.test.ts`
- Modify: `src/features/seoAgent/wgdReport/siteCrawler.ts`
- Modify: `src/features/seoAgent/wgdReport/siteCrawler.test.ts`
- Modify: `src/features/seoAgent/wgdReport/yandexEvidence.test.ts`
- Modify: `src/features/seoAgent/wgdReport/runWgdReport.ts`
- Modify: `src/features/seoAgent/wgdReport/runWgdReport.test.ts`

**Interfaces:**
- Adds: `SeoSignalConflict`, `RobotsAccessEvidence`, `PageEvidence.signalConflicts`, `RobotsEvidence.access`, `CrawlSiteOptions.robotsUserAgent`.
- Adds: optional legacy-compatible `YandexRankCheck.checkedDepth`; every new Yandex Search API check sets `20`.

- [ ] **Step 1: Write RED tests for structured evidence**

```ts
test("emits structured conflicts without parsing English prose", () => {
  const page = analyzeHtmlPage({
    ...htmlInput(`<meta name="robots" content="index"><link rel="canonical" href="/other">`),
    headers: { "content-type": "text/html", "x-robots-tag": "noindex" },
  });
  expect(page.signalConflicts).toEqual(expect.arrayContaining([
    { code: "robots_index_disagreement", category: "robots" },
    { code: "canonical_differs_from_final", category: "canonical" },
  ]));
});

test("records YandexBot robots access for checked content URLs", async () => {
  const result = await crawlSite(options({ robotsUserAgent: "YandexBot" }), fakeFetchWithRobots(`
    User-agent: YandexBot
    Disallow: /private
  `));
  expect(result.robots.access).toEqual({
    state: "measured",
    userAgent: "YandexBot",
    checkedUrlCount: 2,
    blockedUrls: ["https://example.com/private"],
  });
});

test("records the exact Yandex search depth", async () => {
  const result = await source.run(rankInput());
  expect(result.checks[0].checkedDepth).toBe(20);
});
```

- [ ] **Step 2: Run provenance tests and verify RED**

Run:

```bash
npx vitest run src/features/seoAgent/wgdReport/htmlAnalyzer.test.ts src/features/seoAgent/wgdReport/siteCrawler.test.ts src/features/seoAgent/providers/yandexSerpRankSource.test.ts src/features/seoAgent/wgdReport/yandexEvidence.test.ts
```

Expected: FAIL on missing structured fields and `checkedDepth`.

- [ ] **Step 3: Add the direct robots parser dependency and contracts**

Run:

```bash
npm install --save robots-parser@3.0.1
```

Add exact contracts:

```ts
export type SeoSignalConflict = {
  code:
    | "robots_index_disagreement"
    | "robots_follow_disagreement"
    | "canonical_differs_from_final"
    | "canonical_on_non_2xx"
    | "multiple_canonical_targets"
    | "hreflang_language_has_multiple_targets";
  category: "robots" | "canonical" | "hreflang";
};

export type RobotsAccessEvidence = {
  state: "measured" | "unavailable";
  userAgent: "YandexBot" | "Googlebot";
  checkedUrlCount: number;
  blockedUrls: string[];
};
```

Keep legacy `indexabilityConflicts: string[]`; derive it from the structured array for compatibility. Never score by comparing legacy strings.

- [ ] **Step 4: Calculate robots access and search depth**

Retain robots body only inside the crawl function. For a 2xx response, use `robotsParser(robotsUrl, body).isAllowed(url, userAgent)` for each admitted content URL. Treat 404/410 as measured with an empty blocked list; treat fetch failures and other statuses as unavailable.

In `runWgdReport.ts`, pass:

```ts
robotsUserAgent: options.market === "RU" || options.language.startsWith("ru")
  ? "YandexBot"
  : "Googlebot",
```

In `src/features/seoAgent/types.ts`, define:

```ts
export type YandexRankCheck = SerpRankCheck & {
  searchEngine: "yandex";
  checkedDepth?: number;
};
```

Set `checkedDepth: 20` in every new `YandexSerpRankSource` check and preserve it through `safeRankCheck`.

- [ ] **Step 5: Verify GREEN and build**

Run:

```bash
npx vitest run src/features/seoAgent/wgdReport/htmlAnalyzer.test.ts src/features/seoAgent/wgdReport/siteCrawler.test.ts src/features/seoAgent/providers/yandexSerpRankSource.test.ts src/features/seoAgent/wgdReport/yandexEvidence.test.ts src/features/seoAgent/wgdReport/runWgdReport.test.ts
npm run build
```

Expected: focused tests PASS, `robots-parser@3.0.1` is a direct dependency, and build exits `0`.

- [ ] **Step 6: Commit Task 2**

```bash
git add package.json package-lock.json src/features/seoAgent/types.ts src/features/seoAgent/providers/yandexSerpRankSource.ts src/features/seoAgent/providers/yandexSerpRankSource.test.ts src/features/seoAgent/wgdReport/types.ts src/features/seoAgent/wgdReport/htmlAnalyzer.ts src/features/seoAgent/wgdReport/htmlAnalyzer.test.ts src/features/seoAgent/wgdReport/siteCrawler.ts src/features/seoAgent/wgdReport/siteCrawler.test.ts src/features/seoAgent/wgdReport/yandexEvidence.test.ts src/features/seoAgent/wgdReport/runWgdReport.ts src/features/seoAgent/wgdReport/runWgdReport.test.ts
git commit -m "feat(seo): add scoreable crawl provenance"
```

### Task 3: Pure site and page scoring

**Files:**
- Modify: `src/features/seoAgent/wgdReport/types.ts`
- Create: `src/features/seoAgent/wgdReport/managerScoring.ts`
- Create: `src/features/seoAgent/wgdReport/managerScoring.test.ts`

**Interfaces:**
- Produces: `calculateWgdReportAssessment(input): WgdReportAssessment`.
- Consumes only normalized evidence, options, findings, and source states; performs no I/O.

- [ ] **Step 1: Define score contracts and RED tests**

```ts
export type WgdComponentId = "technical" | "yandex" | "lighthouse" | "alice";
export type WgdAssessmentState = "scored" | "preliminary" | "insufficient_data";

export type WgdComponentAssessment = {
  score: number | null;
  nominalWeight: 40 | 25 | 20 | 15;
  effectiveWeight: number;
  collectionCoverage: number;
  scoringCoverage: number;
  collected: number;
  requested: number;
};

export type WgdAtomicRuleAssessment = {
  id: WgdTechnicalRuleId;
  weight: number;
  applicableCount: number;
  measuredCount: number;
  passedCount: number;
  ruleCoverage: number | null;
  passRate: number | null;
};
```

Add table tests for the 14 exact rules:

```ts
expect(assessment.components.technical.rules.map(({ id, weight }) => [id, weight])).toEqual([
  ["http_success", 20], ["indexability", 25], ["robots_access", 5], ["sitemap", 10],
  ["canonical", 12], ["signal_conflicts", 3], ["title_present", 3], ["title_unique", 2],
  ["description_present", 3], ["description_unique", 2], ["h1_present", 5],
  ["broken_internal_links", 5], ["redirect_chains", 3], ["orphan_pages", 2],
]);
```

Cover zero applicable/measured values, partial crawl completion, all position bands, missing `checkedDepth`, 3-query/60% gates, Alice zero denominator, complete Lighthouse pairs, missing categories, owner gaps, 80/60 overall states, mass `noindex`, and page-score redistribution.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run src/features/seoAgent/wgdReport/managerScoring.test.ts
```

Expected: FAIL because the score types and calculator do not exist.

- [ ] **Step 3: Implement technical normalization exactly**

```ts
function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.min(1, Math.max(0, numerator / denominator)) : 0;
}

function technicalScore(rules: readonly WgdAtomicRuleAssessment[]): number | null {
  const denominator = rules.reduce((sum, rule) => sum + rule.weight * (rule.ruleCoverage ?? 0), 0);
  if (denominator === 0) return null;
  const numerator = rules.reduce((sum, rule) =>
    sum + rule.weight * (rule.ruleCoverage ?? 0) * (rule.passRate ?? 0), 0);
  return Math.round((numerator / denominator) * 100);
}
```

Compute `crawlCompletion = attemptedUrlCount / eligibleDiscoveredCount`, atomic rule coverage from applicable measured weights, `technical.collectionCoverage = crawlCompletion × atomicRuleCoverage`, and set technical scoring coverage to zero unless the homepage was parsed as HTML.

- [ ] **Step 4: Implement Yandex, Lighthouse, Alice, overall, and page formulas**

Use exact Yandex bands `1-3=100`, `4-10=80`, `11-20=60`, and not found in a `checkedDepth >= 20` check `=0`. Use only successful queries with depth provenance; below three successful queries or 60% coverage, set scoring coverage to zero.

Form Lighthouse pairs by requested URL. A valid pair has successful mobile and desktop profiles with numeric performance, accessibility, and best-practices. Calculate:

```ts
const lighthouseScore = Math.round(
  mobilePerformanceMean * 0.50
  + desktopPerformanceMean * 0.20
  + accessibilityBothProfilesMean * 0.20
  + bestPracticesBothProfilesMean * 0.10
);
```

Calculate overall with `effectiveWeight = nominalWeight × scoringCoverage`; completeness is the sum of effective weights. At `>=80`, emit `scored` and a status band; at `60-79.999`, emit `preliminary` with no status; below `60`, emit `insufficient_data` with `displayScore: null`. Apply the sitewide indexability cap after weighted calculation.

For page Lighthouse points use `10 × mobilePerformance / 100 + 5 × desktopPerformance / 100`; redistribute unavailable group weight across measured groups and apply the page `noindex` cap.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npx vitest run src/features/seoAgent/wgdReport/managerScoring.test.ts
npm run build
```

Expected: all score cases PASS, including proof that owner access and Lighthouse SEO never change any score.

```bash
git add src/features/seoAgent/wgdReport/types.ts src/features/seoAgent/wgdReport/managerScoring.ts src/features/seoAgent/wgdReport/managerScoring.test.ts
git commit -m "feat(seo): calculate manager report scores"
```

### Task 4: Structured manager finding catalog and groups

**Files:**
- Create: `src/features/seoAgent/wgdReport/findingCatalog.ts`
- Create: `src/features/seoAgent/wgdReport/findingGroups.ts`
- Create: `src/features/seoAgent/wgdReport/findingGroups.test.ts`
- Modify: `src/features/seoAgent/wgdReport/findings.ts`
- Modify: `src/features/seoAgent/wgdReport/types.ts`

- [ ] **Step 1: Write RED grouping tests**

Cover deterministic ordering, maximum severity, URL de-duplication, site/page scope, a maximum of five manager groups, and hostile URLs embedded only in `evidence` prose. Require `owner_access_gap`, `crawl_truncated`, Alice-not-used, and heuristic findings to stay out of confirmed manager problem groups.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run src/features/seoAgent/wgdReport/findingGroups.test.ts
```

Expected: FAIL because the catalog and group builder do not exist.

- [ ] **Step 3: Implement a shared exhaustive finding catalog**

For every known finding code, define a stable rank, `managerEligible`, delivery stage, and technical anchor. Make `findings.ts` consume the catalog rank instead of a private duplicate order. Do not infer metadata from English text or code-name substrings.

- [ ] **Step 4: Aggregate only structured evidence**

Build affected URL sets from `affectedUrl`, duplicate-title/description maps, broken URLs, redirect chains, page evidence, and other typed fields. Never parse `finding.evidence` or `finding.action`. Return deterministic groups and keep coverage/heuristic observations for methodology or specialist data.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/features/seoAgent/wgdReport/findingGroups.test.ts src/features/seoAgent/wgdReport/findings.test.ts
npm run build
git add src/features/seoAgent/wgdReport/findingCatalog.ts src/features/seoAgent/wgdReport/findingGroups.ts src/features/seoAgent/wgdReport/findingGroups.test.ts src/features/seoAgent/wgdReport/findings.ts src/features/seoAgent/wgdReport/types.ts
git commit -m "feat(seo): group manager findings structurally"
```

### Task 5: Locale-safe manager presentation

**Files:**
- Create: `src/features/seoAgent/wgdReport/reportLocalization.ts`
- Create: `src/features/seoAgent/wgdReport/reportLocalization.test.ts`
- Create: `src/features/seoAgent/wgdReport/managerPresentation.ts`
- Create: `src/features/seoAgent/wgdReport/managerPresentation.test.ts`
- Modify: `src/features/seoAgent/wgdReport/types.ts`

- [ ] **Step 1: Write RED localization and data-boundary tests**

Test every status, severity, priority, known finding code, source state, Lighthouse category, and manager heading in Russian. Verify `ru` and `ru-*` select Russian and other languages select an explicit English fallback. Insert sentinel English strings into raw evidence, actions, provider messages, and Lighthouse descriptions; assert none occur in serialized manager presentation.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run src/features/seoAgent/wgdReport/reportLocalization.test.ts src/features/seoAgent/wgdReport/managerPresentation.test.ts
```

Expected: FAIL because localization and presentation builders do not exist.

- [ ] **Step 3: Implement exhaustive dictionaries and Russian formatting**

Use `Record<Union, ...>` dictionaries so additions fail at compile time. Localize headings, states, dates, numbers, impacts, and actions. Unknown findings are specialist-only; do not display a machine-code fallback to managers.

- [ ] **Step 4: Build the manager presentation model**

Return the overall card and four component cards, up to five confirmed problems, all requested Yandex queries, Alice rows, Lighthouse lab results, delivery stages, page summaries, methodology, and specialist links. Use only normalized values plus approved localized copy.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/features/seoAgent/wgdReport/reportLocalization.test.ts src/features/seoAgent/wgdReport/managerPresentation.test.ts
npm run build
git add src/features/seoAgent/wgdReport/reportLocalization.ts src/features/seoAgent/wgdReport/reportLocalization.test.ts src/features/seoAgent/wgdReport/managerPresentation.ts src/features/seoAgent/wgdReport/managerPresentation.test.ts src/features/seoAgent/wgdReport/types.ts
git commit -m "feat(seo): localize manager report presentation"
```

### Task 6: Manager-first renderer and closed technical details

**Files:**
- Create: `src/features/seoAgent/wgdReport/reportHtml.ts`
- Create: `src/features/seoAgent/wgdReport/managerReportRenderer.ts`
- Create: `src/features/seoAgent/wgdReport/technicalReportRenderer.ts`
- Modify: `src/features/seoAgent/wgdReport/reportRenderer.ts`
- Modify: `src/features/seoAgent/wgdReport/reportRenderer.test.ts`

- [ ] **Step 1: Replace old renderer assertions with RED manager-contract tests**

Require this exact open section order: `overall-score`, `main-problems`, `yandex-positions`, `alice-visibility`, `speed-ux`, `priority-actions`, `page-details`. Require closed `details` sections `site-technical`, `methodology`, and `specialist-data`, plus one closed `.page-detail` per crawled page. Assert no `open` attribute, no raw English sentinel, no finding codes, safe hostile HTML, valid evidence links, and responsive table wrappers.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run src/features/seoAgent/wgdReport/reportRenderer.test.ts
```

Expected: FAIL against the current English technical-first renderer.

- [ ] **Step 3: Split HTML helpers and renderers**

Keep escaping, safe relative links, score bands, table wrappers, and `details` helpers in `reportHtml.ts`. Give `managerReportRenderer` only the safe presentation model. Keep normalized technical evidence and links in the closed renderer, with localized labels.

- [ ] **Step 4: Compose the report shell**

Preserve `renderWgdHtml(payload)` as the public API. Add UTF-8, responsive viewport, print styles, and `<meta name="robots" content="noindex,nofollow">`. Keep all seven manager blocks visible and every per-page/technical/methodology/specialist block collapsed by default.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/features/seoAgent/wgdReport/reportRenderer.test.ts
npm run build
git add src/features/seoAgent/wgdReport/reportHtml.ts src/features/seoAgent/wgdReport/managerReportRenderer.ts src/features/seoAgent/wgdReport/technicalReportRenderer.ts src/features/seoAgent/wgdReport/reportRenderer.ts src/features/seoAgent/wgdReport/reportRenderer.test.ts
git commit -m "feat(seo): render manager-first Russian report"
```

### Task 7: One schema-2 published model for JSON and HTML

**Files:**
- Create: `src/features/seoAgent/wgdReport/reportModel.ts`
- Create: `src/features/seoAgent/wgdReport/reportModel.test.ts`
- Modify: `src/features/seoAgent/wgdReport/types.ts`
- Modify: `src/features/seoAgent/wgdReport/artifactWriter.ts`
- Modify: `src/features/seoAgent/wgdReport/artifactWriter.test.ts`
- Modify: `src/features/seoAgent/wgdReport/runWgdReport.ts`
- Modify: `src/features/seoAgent/wgdReport/runWgdReport.test.ts`

- [ ] **Step 1: Write RED model and writer tests**

Require schema `2.0`, recalculated assessment, finding groups, page scores, crawl counters, Yandex checked depth, old normalized evidence fields, and existing relative evidence links. Assert a forged incoming assessment is replaced, missing legacy crawl counters fail closed to insufficient technical coverage, and redacted values never reappear.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run src/features/seoAgent/wgdReport/reportModel.test.ts src/features/seoAgent/wgdReport/artifactWriter.test.ts src/features/seoAgent/wgdReport/runWgdReport.test.ts
```

Expected: FAIL because published schema 2 and the idempotent builder do not exist.

- [ ] **Step 3: Implement `buildPublishedWgdReport`**

Always recalculate assessment and groups from normalized evidence. Treat missing required provenance as unscored, not as optimistic inferred coverage. Make repeated calls idempotent.

- [ ] **Step 4: Integrate at the artifact boundary**

After current sanitization and Lighthouse raw-payload extraction, build one published object. Serialize that exact object to `report.json` and pass the same object to HTML rendering so scores and rows cannot diverge.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/features/seoAgent/wgdReport/reportModel.test.ts src/features/seoAgent/wgdReport/artifactWriter.test.ts src/features/seoAgent/wgdReport/runWgdReport.test.ts src/features/seoAgent/wgdReport/reportRenderer.test.ts
npm run build
git add src/features/seoAgent/wgdReport/reportModel.ts src/features/seoAgent/wgdReport/reportModel.test.ts src/features/seoAgent/wgdReport/types.ts src/features/seoAgent/wgdReport/artifactWriter.ts src/features/seoAgent/wgdReport/artifactWriter.test.ts src/features/seoAgent/wgdReport/runWgdReport.ts src/features/seoAgent/wgdReport/runWgdReport.test.ts
git commit -m "feat(seo): publish scored report schema"
```

### Task 8: Safe GitHub Pages staging command

**Files:**
- Create: `src/features/seoAgent/wgdReport/pagesPublisher.ts`
- Create: `src/features/seoAgent/wgdReport/pagesPublisher.test.ts`
- Create: `scripts/publishSeoReport.ts`
- Modify: `package.json`

- [ ] **Step 1: Write RED publisher tests**

Test safe slug validation; missing/legacy/English reports; absent assessment; unexpected files; symlinks; invalid JSON; missing evidence; unsafe links; secret-like values; existing destination without `--replace`; atomic replacement; and an exact successful allowlist containing only `index.html`, `report.json`, and `evidence/*.json`.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run src/features/seoAgent/wgdReport/pagesPublisher.test.ts
```

Expected: FAIL because the publisher does not exist.

- [ ] **Step 3: Implement validation and atomic publication**

Validate the source bundle and every JSON file, Russian manager markers, schema 2 assessment, evidence href targets, absence of symlinks and credential-shaped content, and a strict slug. Copy into a sibling temporary directory and rename only after validation. On `--replace`, keep the old destination until the staged bundle is complete.

- [ ] **Step 4: Add the CLI**

Expose:

```bash
npm run seo:publish-report -- --report-dir <absolute-or-repo-relative-dir> --slug flowerlife-school [--replace]
```

Print the tracked destination and public GitHub Pages URL; do not push or deploy from this command.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/features/seoAgent/wgdReport/pagesPublisher.test.ts
npm run seo:publish-report -- --help
npm run build
git add src/features/seoAgent/wgdReport/pagesPublisher.ts src/features/seoAgent/wgdReport/pagesPublisher.test.ts scripts/publishSeoReport.ts package.json
git commit -m "feat(seo): stage reports for GitHub Pages"
```

### Task 9: Reusable command and installed skill contract

**Files:**
- Modify: `/Users/nafanya/.codex/skills/seo-report/SKILL.md`
- Modify: `/Users/nafanya/.codex/skills/seo-report/references/report-workflow.md`
- Modify: `docs/COMMANDS.md`

- [ ] **Step 1: Read the skill-authoring instructions before editing**

```bash
sed -n '1,260p' /Users/nafanya/.codex/skills/writing-skills/SKILL.md
```

Continue until EOF if longer than the first chunk.

- [ ] **Step 2: Update the installed `seo-report` skill**

Specify that `language` controls all manager-visible HTML; Russian sites use Yandex, not DataForSEO; missing Yandex Webmaster or Search Console owner access is disclosed without score penalty; visible output is manager-first; technical sections are closed; report acceptance precedes execution-plan creation; and public publication requires explicit approval for each report and destination.

- [ ] **Step 3: Document reusable commands**

Add the report command and the separate opt-in Pages staging command to `docs/COMMANDS.md`, with the canonical Flowerlife example and acceptance/publication gates.

- [ ] **Step 4: Validate and commit only repository documentation**

```bash
/usr/bin/python3 /Users/nafanya/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/nafanya/.codex/skills/seo-report
git add docs/COMMANDS.md
git commit -m "docs: document manager SEO report publishing"
```

The installed skill is intentionally outside this repository; report its validated update separately rather than trying to stage it.

### Task 10: Full verification, live Flowerlife run, publication, and deployment proof

**Files:**
- Create: `mini-app/seo-reports/flowerlife-school/index.html`
- Create: `mini-app/seo-reports/flowerlife-school/report.json`
- Create: `mini-app/seo-reports/flowerlife-school/evidence/*.json`

- [ ] **Step 1: Run all local quality gates**

```bash
npx vitest run src/features/seoAgent/wgdReport
npm test
npm run build
npm run seo:report -- --help
npm run seo:publish-report -- --help
git diff --check
```

- [ ] **Step 2: Generate one new live Russian Flowerlife report**

```bash
npm run seo:report -- \
  --url https://flowerlife-school.com/ \
  --market RU \
  --language ru \
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

Pin the printed report directory. Confirm schema 2, assessment arithmetic, all requested Yandex/Alice rows, complete mobile/desktop Lighthouse pairs or explicit limitations, Russian visible text, no internal jargon, no raw English sentinels, closed technical details, and valid evidence targets.

- [ ] **Step 3: Perform desktop and 390-pixel browser QA**

Serve the bundle locally, inspect screenshots at desktop and mobile widths with Playwright, expand representative page/methodology/specialist sections, and verify no horizontal layout break, unreadable table, leaked internal labels, or missing link.

- [ ] **Step 4: Stage and commit the approved Pages bundle**

```bash
npm run seo:publish-report -- --report-dir <pinned-report-dir> --slug flowerlife-school
git add mini-app/seo-reports/flowerlife-school
git diff --cached --check
git diff --cached --name-only
git commit -m "docs(seo): publish Flowerlife manager report"
```

Assert every staged path begins with `mini-app/seo-reports/flowerlife-school/` and that the ignored timestamped source remains untouched.

- [ ] **Step 5: Push the exact `main` SHA and watch its Pages run**

Fetch origin first and require `git rev-list --left-right --count origin/main...main` to report zero commits behind. Push `main`, locate the `deploy-miniapp.yml` run whose `headSha` equals the pushed SHA, and wait for `conclusion=success`.

- [ ] **Step 6: Verify deployed bytes and HTTP behavior**

Require HTTP 200 with no redirect to `taskbot.pldata.io` for the canonical directory, `index.html`, `report.json`, and every published evidence link. Download the deployed HTML/JSON/evidence with cache busting and compare them byte-for-byte to the tracked Pages directory. Reconfirm Pages has no active CNAME.

- [ ] **Step 7: Handoff for report acceptance**

Return the exact public URL, score/completeness and component summary, limitations such as absent owner-console access, pushed commit SHA, and successful workflow URL. Do not create `execution-plan.md`; ask the user to accept the report first, as agreed.

## Plan Self-Review

- [x] Every approved score threshold, weight, cap, source gate, localization rule, and Pages safety rule is represented by a named test or release check.
- [x] Every implementation step names concrete behavior and a verification command; no work is deferred to an unspecified follow-up.
- [x] Every changed contract has its fixture migrations and build gate listed.
- [x] Manager-visible data has a hard presentation boundary from raw evidence strings.
- [x] Publication is allowlisted, atomic, noindex, explicitly approved for this report, and verified against the exact pushed SHA.
