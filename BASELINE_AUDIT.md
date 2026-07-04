# SEO OS Baseline Audit: Zaruku WGD Pipeline

Date: 2026-07-03  
Production runner: `scripts/runWgdZarukuCancerPortal.ts`  
Production site: `zaruku.ru`  
Scope: document and freeze current behavior only. No migration, refactor, rename, or output change is included in TASK-001.

## Current Execution Flow

```text
scripts/runWgdZarukuCancerPortal.ts
  ↓
dotenv/config + Firebase Admin config
  ↓
Seed QA team and QA company documents in Firestore
  ↓
upsertSeoConfig(...)
  ↓
Runner-owned Zaruku collectors
  ├─ fetchPageSnapshot("https://zaruku.ru/")
  ├─ readSitemapSummary("https://zaruku.ru/sitemap.xml")
  ├─ readYandexPopularQueries(50)
  └─ runLocalLighthouse("https://zaruku.ru/")
  ↓
runSeoAnalysis(...)
  ↓
resolveSeoSourceSelection(["crawler", "yandex_webmaster", "yandex_serp_rank"])
  ↓
executeSelectedSource(...)
  ├─ BasicCrawlerSeoSource.getSnapshot(domain)
  ├─ YandexWebmasterSeoSource.getSnapshot(domain)
  └─ YandexSerpRankSource.run(...)
  ↓
Normalization and aggregation inside seoAgentService
  ├─ source statuses
  ├─ empty GSC/PageSpeed/ranking defaults where not selected
  ├─ yandexWebmaster snapshot
  ├─ rankTracking snapshot
  ├─ recommendations
  ├─ findings
  ├─ scores
  └─ harness metadata
  ↓
runSeoHarness(...)
  ├─ retrieveSeoSkills(...)
  ├─ normalize findings
  ├─ evidence gate
  ├─ realizeSeoActions(...)
  └─ regulateSeoTrajectory(...)
  ↓
createSeoAnalysisRun(...)
  ↓
generateSeoDraftTasksForRun(...)
  ↓
listSeoDraftTasksForRun(...)
  ↓
runYandexGenSearchProbes(...)
  ↓
Write reports/wgd-zaruku-cancer-portal-YYYY-MM-DD.json
Write reports/wgd-zaruku-cancer-portal-YYYY-MM-DD.html
```

## Detected Modules

| Module | Purpose | Main Entrypoint | Dependencies | Current Responsibility | Future SEO OS Layer |
|---|---|---|---|---|---|
| Zaruku WGD runner | One-off production report orchestration for Zaruku | `scripts/runWgdZarukuCancerPortal.ts` | Firebase, SEO config repo, SEO service, `fetch`, Lighthouse CLI, Yandex APIs, filesystem | Seeds QA data, sets config, runs collectors, renders JSON/HTML | Scenario runner / workflow adapter |
| SEO agent service | Multi-source SEO run orchestration | `runSeoAnalysis` | Source registry, providers, repositories, GSC opportunity engine, harness | Executes selected sources, normalizes outputs, creates recommendations/findings/draft tasks | Analysis orchestration |
| Source registry | Select and instantiate SEO sources | `resolveSeoSourceSelection`, `createRankingProvider` | Environment variables, mock/SISTRIX providers | Maps explicit/env provider selection into source list | Source selection |
| Basic crawler source | Homepage technical snapshot | `BasicCrawlerSeoSource.getSnapshot` | `fetch` | Reads homepage metadata, robots, sitemap, indexability | Technical collector |
| Yandex Webmaster source | Owned Yandex search performance snapshot | `YandexWebmasterSeoSource.getSnapshot` | Yandex OAuth/Webmaster API, env vars | Reads host, history, popular queries | Owned search collector |
| Yandex SERP rank source | Yandex rank tracking | `YandexSerpRankSource.run` | Yandex Search API, env vars, SERP matching | Checks tracking keywords and target domain positions | Rank collector |
| Google SERP rank source | Google rank tracking | `GoogleSerpRankSource.run` | DataForSEO env/API | Not selected by Zaruku runner, available in service | Rank collector |
| Google Search Console source | Owned Google search performance | `GoogleSearchConsoleSeoSource.getSnapshot` | GSC credentials, config | Not selected by Zaruku runner, normalized as empty | Owned search collector |
| PageSpeed source | API-based PageSpeed snapshot | `PageSpeedSeoSource.getSnapshot` | Google PageSpeed API | Not selected in `runSeoAnalysis`; runner separately runs local Lighthouse | Performance collector |
| Local Lighthouse runner | Desktop Lighthouse report summary | `runLocalLighthouse` inside runner | `npx lighthouse`, Chrome | Runner-owned local performance collector for HTML/JSON output | Performance collector |
| Sitemap collector | Sitemap summary for Zaruku | `readSitemapSummary` inside runner | `fetch`, URL parsing | Counts URLs and sections in `sitemap.xml` | Crawl inventory collector |
| Homepage snapshot collector | Rich homepage snapshot for Zaruku report | `fetchPageSnapshot` inside runner | `fetch`, regex HTML parsing | Extracts title, description, H1, canonical, word count, links | Page snapshot collector |
| Yandex popular query collector | Expanded Yandex Webmaster popular queries | `readYandexPopularQueries` inside runner | Yandex Webmaster OAuth/API | Adds 50-query table to final report | Owned search collector |
| Yandex generative probe collector | AI answer/source probe | `runYandexGenSearchProbes` inside runner | Yandex Search API generative endpoint | Measures target source presence/usage in AI answers | AI visibility collector |
| GSC opportunity engine | GSC-driven opportunity generation | `generateGscOpportunities` | Search Console snapshot | Produces opportunities from GSC if available | Opportunity engine |
| SEO harness | Evidence-gated draft-task harness | `runSeoHarness` | Contract, evidence, action realizer, trajectory regulator, skill retriever | Converts findings to bounded draft tasks | Agent governance |
| Analysis run repository | Persist SEO analysis runs | `createSeoAnalysisRun`, `findSeoAnalysisRunByTeamAndId` | Firestore | Stores and normalizes run documents | Run repository |
| Draft task repository | Persist SEO draft tasks | `createSeoDraftTasks`, `listSeoDraftTasksByRun` | Firestore | Stores draft tasks and conversion metadata | Task repository |
| SEO config repository | Persist per-company SEO config | `upsertSeoConfig`, `findSeoConfigByCompany` | Firestore | Stores domain, markets, competitors, tracking keywords | Configuration repository |

## Current Collectors

### Active in `scripts/runWgdZarukuCancerPortal.ts`

- Homepage Snapshot
  - Entrypoint: `fetchPageSnapshot`
  - Output: `page`
  - Fields: `url`, `finalUrl`, `httpStatus`, `title`, `description`, `h1`, `canonical`, `wordCount`, `bodySample`, `internalLinks`

- Sitemap
  - Entrypoint: `readSitemapSummary`
  - Output: `sitemap`
  - Fields: `sitemapUrl`, `status`, `urlCount`, `sampledUrls`, `sectionCounts`

- Local Lighthouse
  - Entrypoint: `runLocalLighthouse`
  - Output: `lighthouse`
  - Fields: `status`, `message`, `pageUrl`, scores, paint metrics, CLS, TBT, speed index, byte weight

- Expanded Yandex Webmaster popular queries
  - Entrypoint: `readYandexPopularQueries`
  - Output: `yandexQueries`
  - Fields: `query`, `impressions`, `clicks`, `ctr`, `averagePosition`

- SEO Agent Basic Crawler
  - Entrypoint: `BasicCrawlerSeoSource.getSnapshot`
  - Output inside run: `run.crawler`
  - Source status: `crawler`

- SEO Agent Yandex Webmaster
  - Entrypoint: `YandexWebmasterSeoSource.getSnapshot`
  - Output inside run: `run.yandexWebmaster`
  - Source status: `yandex_webmaster`

- SEO Agent Yandex SERP
  - Entrypoint: `YandexSerpRankSource.run`
  - Output inside run: `run.rankTracking.yandex`
  - Source status: `yandex_serp_rank`

- Yandex GPT / AI probe
  - Entrypoint: `runYandexGenSearchProbes`
  - Output: `aiProbes`
  - Measures Yandex generative answer result text, sources, used sources, target found/used, source positions

### Present but not selected by this runner

- Mock ranking provider: available as `mock`, not selected.
- SISTRIX ranking provider: available as `sistrix`, not selected.
- Google Search Console: available as `gsc`, not selected.
- PageSpeed API source: available as `pagespeed`, not selected by `runSeoAnalysis`; local Lighthouse is run separately by the runner.
- Google SERP rank source: available as `google_serp_rank`, not selected.

## Repositories

| Repository | Inputs | Outputs | Ownership |
|---|---|---|---|
| `seoConfigRepository.ts` | Team/company/domain config, markets, languages, competitors, keywords, target location/region/device | `SeoCompanyConfig` | SEO config persistence |
| `seoAnalysisRunRepository.ts` | Normalized run payload from `runSeoAnalysis` | `SeoAnalysisRun` documents and normalized reads | SEO analysis run persistence |
| `seoDraftTaskRepository.ts` | Draft tasks generated from harness/findings/recommendations | `SeoDraftTask` documents and normalized reads | SEO draft task persistence |
| `companyRepository.ts` | Company lookup by id | Company record | Shared company model |
| `teamMemberRepository.ts` | Team member lookup | Team member record | Shared team membership model |
| `firestore.service.ts` | Agency task creation/read during draft conversion | Real agency task | Shared task system |
| `gscCredentialRepository.ts` | Team credential state | GSC credential material/config | Google Search Console provider support |

## Current Outputs

### JSON Report

Written to `reports/wgd-zaruku-cancer-portal-YYYY-MM-DD.json`.

Top-level sections:

- `run`
- `draftTasks`
- `page`
- `sitemap`
- `lighthouse`
- `yandexQueries`
- `aiProbes`

### HTML Report

Written to `reports/wgd-zaruku-cancer-portal-YYYY-MM-DD.html`.

Required sections:

- Hero / run metadata
- Executive Snapshot
- Главные выводы
- Страница и структура
- Yandex Webmaster: top queries
- Yandex SERP rank checks
- Lighthouse
- Как усилить портал
- Yandex Alisa / AI source position
- Source statuses
- Draft tasks

### Draft Tasks

Generated through `generateSeoDraftTasksForRun` after the run is persisted. In the captured baseline these are recommendation-backed draft tasks, not real tasks.

### Recommendations

Generated in `createRecommendations` from normalized source outputs and source availability. Current Zaruku baseline recommendations are tracking/content oriented because SISTRIX, GSC, and PageSpeed API are not selected and ranking visibility is unavailable.

## Production Risks

- Hardcoded production scenario in the runner:
  - `teamId`, `companyId`, `createdByUserId`, `domain`, `targetUrl`, competitors, keywords, Yandex region, language, and device are all embedded in `scripts/runWgdZarukuCancerPortal.ts`.

- Runner mutates shared Firestore state:
  - It writes `teams`, `companies`, SEO config, analysis runs, and draft tasks.
  - Re-running creates new run/task documents and can update QA team/company/config docs.

- Mixed responsibilities:
  - The runner both collects data and renders an HTML report.
  - Some collectors are inside the runner while other collectors are provider classes.

- Network and credential coupling:
  - Homepage, sitemap, Yandex Webmaster, Yandex Search API, Yandex generative search, and local Lighthouse all require external availability.
  - API credentials and role permissions change collector status.

- Local runtime dependency:
  - Lighthouse is invoked via `execFileSync("npx", ["lighthouse", ...])` and depends on local Chrome/Lighthouse behavior.

- Regex HTML parsing:
  - Homepage metadata, body text, links, and sitemap URLs are parsed with regular expressions.

- Date-dependent behavior:
  - Output paths use the current date.
  - Yandex Webmaster date windows are computed from current date.
  - Run IDs, task IDs, timestamps, checkedAt/collectedAt values are volatile.

- High coupling in `seoAgentService.ts`:
  - Source execution, normalization, recommendations, findings, harness, scoring, persistence, and draft-task generation are in one service module.

- Environment-variable global state:
  - `SEO_RANK_TRACKING_MAX_KEYWORDS` is set inside the runner.
  - Provider behavior depends on many env vars, including Yandex and PageSpeed configuration.

- Files difficult to extract safely:
  - `scripts/runWgdZarukuCancerPortal.ts`: scenario config, collectors, rendering, and persistence are interleaved.
  - `src/features/seoAgent/seoAgentService.ts`: orchestration and normalization logic are broad and tightly coupled.

## Safe Extraction Candidates

These are candidates only. TASK-001 does not extract them.

| Candidate | Why It Looks Safe | Risk |
|---|---|---|
| Sitemap summary functions | Self-contained, input URL/domain, output plain JSON | Low, except current regex behavior must be preserved |
| Homepage snapshot functions | Self-contained fetch/parse/output flow | Low-medium because regex parsing is behavior |
| HTML escaping/render helpers | Pure functions in runner | Low if output snapshots are preserved |
| Local Lighthouse summary adapter | Clear input/output boundary | Medium due local CLI dependency |
| Yandex generative probe parser helpers | Mostly pure parsing and source matching | Medium due API payload variability |
| `BasicCrawlerSeoSource` | Already isolated provider class | Low-medium due network behavior |
| `YandexSerpRankSource` | Already isolated provider class | Medium due async polling and env/API semantics |
| `YandexWebmasterSeoSource` | Already isolated provider class | Medium due auth, host selection, date ranges |

## Suggested Migration Order

Do not migrate as part of TASK-001. Recommended future order:

1. Keep this golden baseline green before every change.
2. Extract pure schema/report validators into reusable test helpers.
3. Extract runner-owned pure helpers only after adding direct tests for their current outputs.
4. Extract sitemap and homepage snapshot collectors behind the same output contract.
5. Extract local Lighthouse adapter behind the same `lighthouse` output contract.
6. Extract Yandex generative probe behind the same `aiProbes` output contract.
7. Split `seoAgentService.ts` normalization/recommendation logic only after run-level fixtures cover all current selected sources.
8. Move persistence orchestration last, because it owns user-visible run/task IDs and Firestore side effects.

## SEO OS Architecture Review

| Current Module | Target Layer | Risk | Recommendation |
|---|---|---|---|
| `scripts/runWgdZarukuCancerPortal.ts` | Workflow adapter / scenario runner | High | Keep as production reference until all collector and report contracts are covered |
| Runner config constants | Tenant/site config | Medium | Externalize only after exact config fixture coverage exists |
| Runner Firestore seeding | Environment bootstrap | Medium | Move after persistence behavior is documented and isolated |
| Runner homepage snapshot | Page snapshot collector | Low-medium | Extract early, preserve regex parsing and field names |
| Runner sitemap summary | Crawl inventory collector | Low | Extract early, preserve section grouping |
| Runner local Lighthouse | Performance collector | Medium | Extract after CLI behavior is covered by fixture schema |
| Runner Yandex popular queries | Owned search collector | Medium | Extract with auth/date-range behavior unchanged |
| Runner Yandex AI probes | AI visibility collector | Medium-high | Extract after payload parser fixtures cover `checked`, `failed`, `permission_denied`, and `not_configured` |
| `seoAgentService.ts` source execution | Analysis orchestration | High | Split only after end-to-end run fixtures cover active and skipped sources |
| `seoAgentService.ts` recommendation generation | Recommendation engine | High | Preserve recommendation schema before any rule changes |
| `seoAgentService.ts` draft task generation | Task proposal engine | High | Migrate after draft task fixtures cover evidence and IDs |
| `seoAgentService.ts` scoring | Scoring engine | Medium | Extract after score nullability is covered |
| `seoSourceRegistry.ts` | Source registry | Low-medium | Good candidate once env selection tests are expanded |
| `BasicCrawlerSeoSource` | Technical collector | Low-medium | Already isolated; keep output contract stable |
| `YandexWebmasterSeoSource` | Owned search collector | Medium | Isolate credentials/date behavior before moving |
| `YandexSerpRankSource` | Rank collector | Medium | Preserve polling, XML parsing, match behavior |
| `GoogleSearchConsoleSeoSource` | Owned search collector | Medium | Not active in Zaruku runner; migrate after separate baseline |
| `PageSpeedSeoSource` | Performance collector | Medium | Not active in Zaruku `runSeoAnalysis`; local Lighthouse currently has separate report output |
| `seoAnalysisRunRepository.ts` | Run repository | Medium-high | Keep stable until orchestration split is complete |
| `seoDraftTaskRepository.ts` | Draft-task repository | Medium-high | Keep stable until task conversion behavior is separately covered |
| `seoConfigRepository.ts` | Config repository | Medium | Extract after config shape and upsert semantics are locked |

## Golden Regression Artifacts

- Fixtures: `src/features/seoAgent/baseline/fixtures/`
- Regression test: `src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`
- Usage guide: `README-baseline.md`

