# Wordstat Demand–Content Gap Implementation Plan

> **For Codex:** Execute this plan inline with `executing-plans`; no subagents are authorized for this task. Follow test-driven development for every behavior change.

**Goal:** Add Yandex Wordstat as a non-scoring demand layer in the standard SEO report, use it to identify the primary content opportunity, regenerate the Russian Flowerlife report, and publish the verified responsive HTML to its existing open GitHub Pages URL.

**Architecture:** A new bounded Wordstat collector calls Yandex Search API directly with the existing API key, normalizes response evidence, and compares demand phrases with crawled title/description/H1–H3 signals. The resulting optional `wordstat` evidence is serialized separately, projected into the manager presentation, and rendered before Yandex positions. Scoring and existing findings remain unchanged; the demand opportunity is advisory and becomes the first manager recommendation only when it is a non-brand partial or missing cluster.

**Tech Stack:** TypeScript, Vitest, native `fetch`, existing WGD report pipeline, static HTML/CSS, GitHub Pages, Playwright visual verification.

---

## Task 1: Add Wordstat evidence contracts and demand-gap analysis

**Files:**
- Create: `src/features/seoAgent/wgdReport/wordstatEvidence.ts`
- Create: `src/features/seoAgent/wgdReport/wordstatEvidence.test.ts`
- Modify: `src/features/seoAgent/wgdReport/types.ts`

**Step 1: Write failing contract and analysis tests**

Cover these independent behaviors:

- safe parsing rejects negative, decimal, unsafe, and non-numeric counts;
- brand detection derives candidates from hostname plus short homepage title/H1 and can accept explicit brand keys;
- one page must contain all meaningful seed tokens and at least one high-demand related phrase to be `covered`;
- at least two seed tokens and at least half the meaningful tokens produce `partial`; otherwise `missing`;
- best page is deterministic by coverage, token ratio, matched fields, then crawl order;
- primary opportunity excludes brand clusters and sorts by demand, with `missing` before `partial` on ties;
- an unavailable response produces `not_measured`, not a content gap.

Run:

```bash
npx vitest run src/features/seoAgent/wgdReport/wordstatEvidence.test.ts
```

Expected: FAIL because the Wordstat module and types do not exist.

**Step 2: Add minimal evidence types and pure analysis functions**

Add types for:

```ts
type WordstatCoverageState = "covered" | "partial" | "missing" | "not_measured";
type WordstatCollectionState = "success" | "partial" | "unavailable" | "not_applicable";

type WordstatEvidence = {
  status: { state: WordstatCollectionState; message: string; checkedAt: string };
  clusters: WordstatDemandCluster[];
  primaryRecommendation: WordstatPrimaryRecommendation | null;
  requestCount: number;
  limitations: string[];
};
```

Implement normalization, brand classification, page matching over title/description/H1–H3, deterministic best-page selection, and primary-opportunity selection as pure exported functions.

**Step 3: Verify GREEN and refactor**

Run the focused test until it passes, then keep tokenization and comparison helpers private.

**Step 4: Commit**

```bash
git add src/features/seoAgent/wgdReport/types.ts src/features/seoAgent/wgdReport/wordstatEvidence.ts src/features/seoAgent/wgdReport/wordstatEvidence.test.ts
git commit -m "feat(seo): model Wordstat demand gaps"
```

## Task 2: Implement bounded Wordstat API collection

**Files:**
- Modify: `src/features/seoAgent/wgdReport/wordstatEvidence.ts`
- Modify: `src/features/seoAgent/wgdReport/wordstatEvidence.test.ts`

**Step 1: Write failing collector tests**

Use an injected fetch implementation and assert:

- requests use `Api-Key` and never expose credentials in evidence or errors;
- no more than 10 unique seeds and 20 returned phrases per seed are retained;
- invalid count values become `null`;
- top requests are collected for all seeds before the top three non-brand gaps are enriched;
- only the top three gaps receive 13 completed months of dynamics and regional distribution;
- the complete run stays within 16 requests;
- partial failures preserve valid evidence and produce `partial`; total failure produces `unavailable`.

Expected: FAIL on missing collector behavior.

**Step 2: Implement minimal collector**

Call:

```text
POST https://searchapi.api.cloud.yandex.net/v2/wordstat/topRequests
POST https://searchapi.api.cloud.yandex.net/v2/wordstat/dynamics
POST https://searchapi.api.cloud.yandex.net/v2/wordstat/regions
```

Use `YANDEX_SEARCH_API_KEY` and `YANDEX_SEARCH_FOLDER_ID`, RU region `225`, a 15-second timeout per request, and redacted generic errors. Build the first analysis from `topRequests`, enrich only its top three eligible gaps, then rebuild the final evidence.

**Step 3: Verify focused tests and commit**

```bash
npx vitest run src/features/seoAgent/wgdReport/wordstatEvidence.test.ts
git add src/features/seoAgent/wgdReport/wordstatEvidence.ts src/features/seoAgent/wgdReport/wordstatEvidence.test.ts
git commit -m "feat(seo): collect bounded Wordstat evidence"
```

## Task 3: Integrate Wordstat without changing SEO scoring

**Files:**
- Modify: `src/features/seoAgent/wgdReport/runWgdReport.ts`
- Modify: `src/features/seoAgent/wgdReport/runWgdReport.test.ts`
- Modify: `src/features/seoAgent/wgdReport/reportModel.ts`
- Modify: `src/features/seoAgent/wgdReport/reportModel.test.ts`
- Modify: `src/features/seoAgent/wgdReport/artifactWriter.ts`
- Modify: `src/features/seoAgent/wgdReport/artifactWriter.test.ts`

**Step 1: Write failing orchestration and score-invariance tests**

Assert that:

- RU runs collect Wordstat after crawl evidence exists;
- non-RU runs create a `not_applicable` Wordstat source without API calls;
- provider success/partial/unavailable is reflected as a `wordstat` source row;
- `report.json` contains optional `wordstat` evidence;
- `evidence/wordstat.json` is written when Wordstat evidence is present;
- identical evidence produces the same assessment score with and without a Wordstat block.

Expected: FAIL on absent integration.

**Step 2: Wire collection and artifact output**

Extend runner dependencies with an injectable Wordstat collector. Add provider coverage but do not add a component, finding severity, score weight, cap, or scoring input. Append Wordstat limitations to report limitations. Write the evidence file only when the block exists.

**Step 3: Verify focused tests and commit**

```bash
npx vitest run src/features/seoAgent/wgdReport/runWgdReport.test.ts src/features/seoAgent/wgdReport/reportModel.test.ts src/features/seoAgent/wgdReport/artifactWriter.test.ts
git add src/features/seoAgent/wgdReport/runWgdReport.ts src/features/seoAgent/wgdReport/runWgdReport.test.ts src/features/seoAgent/wgdReport/reportModel.ts src/features/seoAgent/wgdReport/reportModel.test.ts src/features/seoAgent/wgdReport/artifactWriter.ts src/features/seoAgent/wgdReport/artifactWriter.test.ts
git commit -m "feat(seo): integrate Wordstat evidence"
```

## Task 4: Add the Russian manager-facing demand section

**Files:**
- Modify: `src/features/seoAgent/wgdReport/managerPresentation.ts`
- Modify: `src/features/seoAgent/wgdReport/managerPresentation.test.ts`
- Modify: `src/features/seoAgent/wgdReport/managerReportRenderer.ts`
- Modify: `src/features/seoAgent/wgdReport/reportLocalization.ts`
- Modify: `src/features/seoAgent/wgdReport/reportLocalization.test.ts`
- Modify: `src/features/seoAgent/wgdReport/reportRenderer.ts`
- Modify: `src/features/seoAgent/wgdReport/reportRenderer.test.ts`

**Step 1: Write failing presentation and rendering tests**

Assert that the Russian report:

- calls the section `Спрос и соответствие контента`;
- places it after main problems and before Yandex positions;
- shows demand, status, best matching page, demand phrases, and trend/region evidence when available;
- calls the winning non-brand gap `Главная возможность роста` before technical priorities;
- explains that Wordstat does not affect the SEO score;
- uses manager language without internal terms such as `normalized evidence files`;
- renders a useful unavailable/not-applicable state;
- prevents page-wide horizontal overflow at 390 px using responsive cards/tables.

Expected: FAIL because the section is missing.

**Step 2: Implement presentation projection and semantic HTML**

Add a `wordstat` presentation block and render it with compact summary cards, an opportunity table that becomes stacked rows on mobile, and collapsible supporting detail. Keep technical per-page detail inside existing disclosure controls.

**Step 3: Verify focused tests and commit**

```bash
npx vitest run src/features/seoAgent/wgdReport/managerPresentation.test.ts src/features/seoAgent/wgdReport/reportLocalization.test.ts src/features/seoAgent/wgdReport/reportRenderer.test.ts
git add src/features/seoAgent/wgdReport/managerPresentation.ts src/features/seoAgent/wgdReport/managerPresentation.test.ts src/features/seoAgent/wgdReport/managerReportRenderer.ts src/features/seoAgent/wgdReport/reportLocalization.ts src/features/seoAgent/wgdReport/reportLocalization.test.ts src/features/seoAgent/wgdReport/reportRenderer.ts src/features/seoAgent/wgdReport/reportRenderer.test.ts
git commit -m "feat(seo): present Wordstat demand gaps"
```

## Task 5: Preserve the optional manual query pack in publication

**Files:**
- Modify: `src/features/seoAgent/wgdReport/pagesPublisher.ts`
- Modify: `src/features/seoAgent/wgdReport/pagesPublisher.test.ts`

**Step 1: Write failing allow-list tests**

Assert that the publisher accepts `manual-query-pack.md` only when `report.json.manualQueryPackPath` declares exactly that relative path, while still rejecting undeclared root files, nested traversal, absolute paths, and unexpected evidence files.

Expected: FAIL because the current exact allow-list rejects the query pack.

**Step 2: Implement the conditional allow-list and verify**

Keep existing path validation and canonical-report checks intact.

```bash
npx vitest run src/features/seoAgent/wgdReport/pagesPublisher.test.ts
git add src/features/seoAgent/wgdReport/pagesPublisher.ts src/features/seoAgent/wgdReport/pagesPublisher.test.ts
git commit -m "feat(seo): publish declared query packs"
```

## Task 6: Update the reusable SEO-report skill

**Files:**
- Modify: `/Users/nafanya/.codex/skills/seo-report/SKILL.md`
- Modify only if needed: `/Users/nafanya/.codex/skills/seo-report/references/workflow.md`

**Step 1: Run the RED behavior check**

Verify the existing skill does not yet require Wordstat demand-gap evidence and therefore would reproduce the previously missing report layer.

**Step 2: Add the accepted contract**

For Russian reports, require direct Wordstat collection when credentials are available; otherwise surface the unavailable state and provide manual queries. State explicitly that Wordstat never affects the score and must instead identify content–demand alignment plus the first non-brand growth recommendation.

**Step 3: Validate skill wording**

Run targeted text checks for the required Russian-report, non-scoring, and primary-recommendation clauses. Do not enable the optional Yandex MCP.

## Task 7: Full verification, live Flowerlife run, and publication

**Files:**
- Regenerate: `reports/seo/flowerlife-school.com/<current-run>/...`
- Replace: `mini-app/seo-reports/flowerlife-school/...`

**Step 1: Run the full quality gate**

```bash
npm test
npm run build
git diff --check
```

Expected: all tests pass, TypeScript compiles, no whitespace errors.

**Step 2: Generate the current Russian Flowerlife audit**

Use the five accepted seeds:

```text
цветок жизни школа
платформа саморазвития
онлайн курсы саморазвития
курсы духовного развития
курсы ароматерапии онлайн
```

Run the standard SEO command with RU/Russia settings and existing Yandex credentials. Confirm the Wordstat request budget, evidence status, current overall score, content-demand gap, Yandex positions, Alice visibility, mobile and desktop Lighthouse results, limitations, and absence of secrets.

**Step 3: Publish with replacement**

Replace `mini-app/seo-reports/flowerlife-school/` using the publisher’s `--replace` mode. Commit generated evidence and the public bundle, merge the feature branch into `main`, push `main`, and wait for the GitHub Pages workflow.

**Step 4: Verify the deployed page visually**

Open the public URL at desktop and 390-pixel mobile widths with Playwright. Check:

- no page-wide horizontal scroll;
- readable cards, table labels, and disclosure controls;
- section order: score → problems → Wordstat demand → Yandex → AI → technical details;
- public access without sign-in or password;
- HTML and published JSON are the new run.

Close all agent-created browser resources afterward.

**Step 5: Final evidence**

Report the public URL, current score/completeness, Wordstat status, main demand gap, Yandex and AI coverage, speed evidence coverage, commit/push status, and any owner-access limitations. Do not write or execute a site-change plan until the user accepts the regenerated report.
