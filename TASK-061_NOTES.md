# TASK-061 - Dashboard Data Contract Fixes + AI Visibility v0 + SoV Weekly

## Changed

- Added `seo_ai_visibility` and `seo_sov_weekly` read-model tables to `010_seo_os_v1.sql`.
- Added `section` to `seo_tasks` and populated it from the source opportunity section when tasks are exported from approval decisions.
- Added explicit `window` metadata to the Global Report contract and MySQL/dashboard export artifacts.
- Added pure builders for:
  - manual AI visibility import records;
  - Yandex Webmaster Query SoV weekly rows;
  - `medical_intent_total` aggregate for north-star KPI cards.
- Added opt-in local commands:
  - `scripts/runSeoAiVisibilityImport.ts`;
  - `scripts/runSeoSovWeeklyExport.ts`.
- Updated Zaruku config to Semantic Profile v1.2:
  - `/kompleksnoe_genomnoe_profilirovanie/`;
  - `/vnimatelney_k_sebe/`;
  - `/medialib/`;
  - KGP and self-check seed clusters.

## Generated Artifacts

- `reports/task-061-zaruku-mysql-dashboard-export-2026-W29-dry-run.json`
- `reports/task-061-zaruku-mysql-dashboard-export-2026-W29-dry-run.sql`
- `reports/task-061-zaruku-mysql-dashboard-export-2026-W29-live.json`
- `reports/task-061-zaruku-mysql-dashboard-export-2026-W29-live.sql`
- `reports/task-061-zaruku-sov-weekly-export-2026-W29-dry-run.json`
- `reports/task-061-zaruku-sov-weekly-export-2026-W29-dry-run.sql`
- `reports/task-061-zaruku-sov-weekly-export-2026-W29-live.json`
- `reports/task-061-zaruku-sov-weekly-export-2026-W29-live.sql`
- `reports/task-061-zaruku-ai-visibility-import-2026-07-dry-run.json`
- `reports/task-061-zaruku-ai-visibility-import-2026-07-dry-run.sql`
- `reports/task-061-zaruku-ai-visibility-import-2026-07-live.json`
- `reports/task-061-zaruku-ai-visibility-import-2026-07-live.sql`

## Live Write Status

Live commands were re-run with explicit `SEO_MYSQL_DASHBOARD_EXPORT=1` on 2026-07-13.

Result: all three live artifacts are `exported` and MySQL verification confirmed the expected rows.

Executed commands:

```bash
SEO_MYSQL_DASHBOARD_EXPORT=1 npx ts-node --transpile-only scripts/runSeoMysqlDashboardExport.ts --global-report reports/task-049-zaruku-global-report-2026-W29.json --out reports/task-061-zaruku-mysql-dashboard-export-2026-W29-live.json --sql-out reports/task-061-zaruku-mysql-dashboard-export-2026-W29-live.sql --execute
SEO_MYSQL_DASHBOARD_EXPORT=1 npx ts-node --transpile-only scripts/runSeoSovWeeklyExport.ts --sov-snapshot reports/zaruku-yandex-webmaster-sov-baseline-2026-07-13.json --week-key 2026-W29 --snapshot-date 2026-07-13 --out reports/task-061-zaruku-sov-weekly-export-2026-W29-live.json --sql-out reports/task-061-zaruku-sov-weekly-export-2026-W29-live.sql --execute
SEO_MYSQL_DASHBOARD_EXPORT=1 npx ts-node --transpile-only scripts/runSeoAiVisibilityImport.ts --engine alisa_ai --period 2026-07 --presence-rate 0.44 --mentions 89 --citations 155 --provenance wm_alisa_manual --captured-at 2026-07-13T14:30:00.000Z --note "WM Alisa AI avg last 4 weeks baseline" --out reports/task-061-zaruku-ai-visibility-import-2026-07-live.json --sql-out reports/task-061-zaruku-ai-visibility-import-2026-07-live.sql --execute
```

## Baseline Values Protected

- Query SoV baseline from 2026-07-13:
  - `medical_org_labs_noise`: 63.74% impressions, 15.41% clicks.
  - `medical_intent_total`: 24.81% impressions, 72.79% clicks.
- AI visibility manual baseline:
  - engine: `alisa_ai`;
  - period: `2026-07`;
  - presence rate: `0.44`;
  - provenance: `wm_alisa_manual`;
  - mentions/citations sample: `89 / 155`.

## MySQL Verification

Verified rows:

- `seo_tasks`: 4 W29 task rows, all with populated `section`.
- `seo_sov_weekly`:
  - `medical_org_labs_noise`: `63.74` impression share, `15.41` click share.
  - `medical_intent_total`: `24.81` impression share, `72.79` click share.
- `seo_ai_visibility`: `alisa_ai`, `2026-07`, `presence_rate=0.4400`, `provenance=wm_alisa_manual`, `mentions=89`, `citations=155`.

## Dashboard-Side Bugs Documented, Not Coded Here

- `Traffic and visibility by section` shows `visits=0`; likely dashboard week/date join bug for open weeks.
- Funnel view merges confidence with URL; dashboard needs a column split.

## Intentionally Not Changed

- No Firestore write path changes.
- No Telegram callback or digest behavior changes.
- No production WGD pipeline run.
- No Yandex/GSC/provider changes.
- No vendor per-query AI checks.
- No rhythm chain restructure.
- No opportunity engine scoring or threshold changes.

## Recommended TASK-062

Enable the intentional MySQL write gate in the deployment environment, run the three TASK-061 import/export commands, then verify the dashboard cards and table columns against `seo_ai_visibility`, `seo_sov_weekly`, and `seo_tasks.section`.
