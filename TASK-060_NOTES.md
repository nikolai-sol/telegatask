# TASK-060 Notes — Sitemap Inventory Resolver / Gap Honesty Fixes

## What changed

- Added a pure shared page inventory resolver:
  - `src/features/seoAgent/pageInventoryCoverageResolver.ts`
  - input: sitemap/page inventory items plus cluster query/section
  - output: `covered` / `partial` / `gap`, matching URL, matched title/H1 tokens
  - matching: section path prefix plus title/H1 token overlap
  - no lemmatization
  - thresholds live in default/config input

- Wired the shared resolver into:
  - `forumThreadDiscovery` via optional `inventoryPages`
  - `sectionRankingGapOpportunityEngine` for sitemap candidate target binding when SERP has no matched URL
  - `scripts/runContentGapDiscovery.ts`, replacing the old configured coverage page list with sitemap inventory snapshots

- Updated ranking honesty for content-gap discovery:
  - themes with Yandex Webmaster signal are `ranked`
  - themes without WM signal are listed separately as `unranked`
  - no-signal themes are not ordered by forum/SERP-result frequency

- Updated operator-facing wording:
  - section ranking missing title now says `не найден в выдаче`
  - section ranking Telegram fallback says `SERP: не найден в выдаче`
  - missing intent fallback says `не классифицирован` instead of `н/д`

- Added Hermes Russian-language guard:
  - prompt asks for Russian human-facing JSON values
  - deterministic post-check rejects non-Russian advisory values as `advisory_not_russian`

## TASK-060 rerun artifact

Created:

- `reports/task-060-zaruku-content-gap-discovery-inventory-rerun-2026-07-18.json`

Before, from TASK-065 artifact:

- source threads: 414
- non-covered threads: 183
- themes: 12
- gap themes: 9
- partial themes: 3

After TASK-060 inventory resolver rerun:

- source threads: 395
- non-covered threads: 88
- themes: 7
- ranked themes: 1
- unranked themes: 6
- gap themes: 4
- partial themes: 3

The live Yandex result set is volatile, so direct before/after counts are directional rather than bit-identical. The artifact includes deterministic `task060ResolverAcceptanceChecks` for the originally false gaps:

- `онкологический центр в сколково адрес` -> `https://zaruku.ru/map/moskva/organization_1425/` (`covered`)
- `цаоп пушкинского района спб` -> `https://zaruku.ru/map/sankt_peterburg/organization_959/` (`covered`)
- `комплексное геномное профилирование...` -> `https://zaruku.ru/kompleksnoe_genomnoe_profilirovanie/` (`covered`)
- `как проверить себя на признаки рака` -> `https://zaruku.ru/vnimatelney_k_sebe/` (`covered`)

## What intentionally did not change

- No Firestore writes.
- No MySQL/storage schema changes.
- No Telegram send in the TASK-060 rerun.
- No weekly cron/rhythm changes.
- No GSC/Yandex provider refactor.
- No production WGD pipeline run.
- No LLM/Hermes live call.
- No lemmatization or semantic matching layer.

## Risks / follow-up

- The script inventory uses known title/H1 snapshots for sitemap URLs; a future collector-owned inventory source should replace these snapshots once ReportingDash/page inventory storage is ready.
- Live SERP volatility changes forum thread counts between reruns; regression checks should assert resolver/schema behavior, not exact live counts.

## Recommended next task

TASK-066 — replace local sitemap inventory snapshots with a read-only inventory artifact/source produced by the collector boundary, then keep `pageInventoryCoverageResolver` as the shared pure matching layer.
