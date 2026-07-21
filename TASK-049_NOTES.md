# TASK-049 - Metrika Layer for the Global Report (7.3)

## Scope Completed

- Added a pure Metrika section traffic aggregation module:
  - `src/features/seoAgent/metrikaSectionTraffic.ts`
- Added a read-only Yandex Metrika collector boundary:
  - `src/features/seoAgent/yandexMetrikaReportCollector.ts`
- Added the Chapter 7.3 Global Report assembler:
  - `src/features/seoAgent/globalReportAssembler.ts`
- Added a local opt-in Global Report script:
  - `scripts/runSeoGlobalReport.ts`
- Added an optional weekly rhythm post-chain reporting hook:
  - disabled by default;
  - enabled only with `SEO_GLOBAL_REPORT_POST_CHAIN=1` or `--global-report-post-chain`;
  - failures are captured in `artifact.globalReport` and do not fail the weekly rhythm chain.

## Config

Added `zarukuSeoProductionConfig.metrikaReport`.

It contains:

- reads flag: `SEO_METRIKA_REPORT_READS`
- token env var name: `YANDEX_METRIKA_TOKEN`
- counter id env var name: `YANDEX_METRIKA_COUNTER_ID`
- API endpoint
- max rows per request
- Chapter 6.2 section URL patterns

No token, counter id or secret value was committed.

## Output Contract

Global Report schema:

```text
seo_os_global_report_v1
```

Layers:

- `layers.positions`: RankHistory dashboard export (`seo_os_rank_history_dashboard_export_v1`)
- `layers.systemWork`: weekly opportunities, approval decisions and reject reasons
- `layers.metrika`: Metrika section traffic report (`seo_os_metrika_section_traffic_v1`)

Metrika raw snapshot schema:

```text
seo_os_metrika_raw_snapshot_v1
```

## Local Run

Command:

```bash
npx ts-node --transpile-only scripts/runSeoGlobalReport.ts \
  --week-key 2026-W28 \
  --weekly-artifact reports/task-048-zaruku-weekly-seo-rhythm-2026-W28.json \
  --out reports/task-049-zaruku-global-report-2026-W28.json \
  --raw-out reports/raw/task-049-zaruku-metrika-raw-2026-W28.json
```

Artifacts:

- `reports/task-049-zaruku-global-report-2026-W28.json`
- `reports/raw/task-049-zaruku-metrika-raw-2026-W28.json`

Result:

- Global Report assembled for `2026-W28`.
- RankHistory layer present: `6` rank sections.
- System work layer present: `5` pending opportunities from weekly rhythm.
- Metrika layer present but `unavailable`.

Metrika was unavailable because the local environment does not define:

- `SEO_METRIKA_REPORT_READS`
- `YANDEX_METRIKA_TOKEN`
- `YANDEX_METRIKA_COUNTER_ID`

No Metrika API request was made in this run.

## Request Counts

Local TASK-049 run:

- Metrika API requests: `0`
- Firestore reads: `true` (approval decisions only)
- Firestore writes: `false`
- Telegram messages: `0`
- Production pipeline runs: `0`
- Actions generated from Metrika: `0`

Expected live Metrika run:

- `1` Yandex Metrika API request per weekly Global Report run.
- The query requests visits, users, page depth, average visit duration and bounce rate by start URL and search engine, filtered to organic traffic.

## Tests

Focused:

```bash
npx vitest run \
  src/features/seoAgent/metrikaSectionTraffic.test.ts \
  src/features/seoAgent/globalReportAssembler.test.ts \
  src/features/seoAgent/weeklySeoRhythm.test.ts \
  src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.test.ts \
  src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts
```

Result: `5 passed`, `16 tests passed`.

Build:

```bash
npm run build
```

Result: passed.

Full suite:

```bash
npm test -- --run
```

Result: `55 passed`, `177 tests passed`.

## Fixtures

Added:

- `src/features/seoAgent/fixtures/metrika/sectionTrafficRows.json`
- `src/features/seoAgent/fixtures/globalReport/weeklyRhythmArtifact.json`

Protected behavior:

- section URL pattern aggregation;
- weighted engagement metrics;
- organic Yandex/Google/other split;
- Global Report 7.3 three-layer schema;
- system work reject reason aggregation;
- Metrika does not generate actions.

## Intentionally Not Changed

- No production WGD pipeline changes.
- No GSC, DataForSEO, Yandex Webmaster, Yandex SERP provider or LLM changes.
- No Firestore schema changes.
- No Firestore writes added.
- No Telegram behavior changes.
- No dashboard/UI changes.
- No Metrika-derived opportunities.
- No approval/digest/action loop changes.
- No scheduler activation for the new report layer.
- No TASK-012 or TASK-036 backfill closure.

## Risks

- Live Metrika API call is not verified locally because credentials are absent.
- Metrika dimension names may need adjustment after the first credentialed read.
- Current section mapping intentionally falls back to `/content/` for unmatched root URLs; this is config-driven and should be reviewed after real traffic appears.

## Recommended Next Task

TASK-050 - Credentialed Metrika smoke read and Global Report publish:

- add `SEO_METRIKA_REPORT_READS=1`, `YANDEX_METRIKA_TOKEN`, `YANDEX_METRIKA_COUNTER_ID`;
- run one local credentialed Global Report;
- verify section traffic and organic split on real data;
- publish the credentialed artifact to Google Drive;
- only then consider enabling `SEO_GLOBAL_REPORT_POST_CHAIN=1`.
