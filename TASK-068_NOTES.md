# TASK-068_NOTES

## Status

Implemented with Beget as the scheduler host instead of TimeWeb.

TimeWeb remains inaccessible because SSH auth to `root@147.45.132.90:2222` still fails with `Permission denied (publickey,password)`. The operator confirmed that ReportingDash is on Beget and approved using Beget for this reliability step.

## What Changed

- Added explicit weekly rhythm window semantics:
  - `runWeekKey` is the idempotency/run owner week.
  - `dataWeekKey` is the completed week being analyzed.
  - Monday `2026-07-20T07:00:00.000Z` maps to `runWeekKey=2026-W30`, `dataWeekKey=2026-W29`, `runId=seo_weekly_2026-W30`.
- Kept report/data `weekKey` as the data week for downstream dashboard compatibility.
- Added optional `dashboard_export` post-chain stage.
  - It runs after the global report.
  - It is failure-isolated: MySQL export failure marks `dashboardExport.status=export_pending` and the weekly rhythm still completes.
- Added scheduler catch-up on process start when:
  - `SEO_WEEKLY_RHYTHM_CRON=1`;
  - current local time in `SEO_WEEKLY_RHYTHM_TIME_ZONE` is Monday at/after 09:00.
- Added explicit timezone support for the weekly cron schedule.
- Added env documentation for:
  - `SEO_MYSQL_DASHBOARD_POST_CHAIN`
  - `SEO_GLOBAL_REPORT_POST_CHAIN`
  - `SEO_WEEKLY_RHYTHM_CRON`
  - `SEO_WEEKLY_RHYTHM_TIME_ZONE`

## What Intentionally Did Not Change

- No WGD production diagnostic pipeline was executed.
- No full Telegatask bot daemon was started on Beget.
- No ReportingDash code was changed.
- No canonical collector ownership was changed.
- No existing SEO collector/provider logic was changed.
- No PM2 or cron changes were made on TimeWeb because VPS access is blocked.

## VPS Blocker

TimeWeb read-only SSH check:

```bash
ssh -o BatchMode=yes -o PreferredAuthentications=publickey -o ConnectTimeout=8 -p 2222 root@147.45.132.90 'hostname'
```

Result:

```text
root@147.45.132.90: Permission denied (publickey,password).
```

The `beget` SSH alias works, but it points to `5.35.85.218` and has no `/opt/telegatask`; it is not the Telegatask production VPS.

## Beget Deployment

Beget SSH works via the local `beget` alias and the `.env` `REPORTING_VPS_SSH_*` values.

Deployed Telegatask as an isolated neighbor app:

```text
/opt/telegatask
```

Important boundary:

- The full Telegatask bot daemon was NOT started.
- No `pm2 start dist/index.js --name telegatask` was run.
- The Beget cron invokes only the weekly SEO rhythm CLI:

```text
/opt/telegatask/scripts/runWeeklySeoRhythmCron.sh
```

This avoids Telegram bot polling/webhook conflicts while still moving the SEO rhythm off the sleep-prone Mac station.

Mac station scheduler was disabled:

- local `.env`: `SEO_WEEKLY_RHYTHM_CRON=0`
- local PM2 `telegatask` restarted after rebuild
- log confirmed `[scheduler] 6 cron jobs started`

Crontab was updated with one appended block only; existing ReportingDash cron lines were left unchanged. Backup:

```text
/root/crontab.backup.telegatask.20260720151609
```

New cron block:

```cron
## Telegatask SEO OS weekly rhythm runner (isolated CLI, no bot daemon)
CRON_TZ=Europe/Vienna
10 9 * * 1 cd /opt/telegatask && /opt/telegatask/scripts/runWeeklySeoRhythmCron.sh >> /opt/telegatask/logs/weekly-seo-rhythm-cron.log 2>&1
```

## W30 Live Result on Beget

Manual W30 backlog run was executed on Beget through the same cron wrapper.

Result:

- `runWeekKey`: `2026-W30`
- `dataWeekKey`: `2026-W29`
- `runId`: `seo_weekly_2026-W30`
- status: `completed`
- rank tracking records written: `26`
- GSC search performance records: `34`
- generated opportunities: `3`
- Telegram digest messages: `1`
- Telegram message id: `3059`
- weekly artifact: `/opt/telegatask/reports/task-048-zaruku-weekly-seo-rhythm-2026-W30.json`
- global report: `/opt/telegatask/reports/task-049-zaruku-global-report-2026-W29.json`

The first dashboard export attempt was pending before the dedicated MySQL writer was added:

```text
ERROR 1045 (28000): Access denied for user 'report_bd'@'5.35.85.218' (using password: YES)
```

Manual export retry artifact:

```text
/opt/telegatask/reports/task-061-zaruku-mysql-dashboard-export-2026-W30-data-2026-W29-manual-retry.json
```

The first W30 run also exposed and fixed a wrapper bug: `scripts/runWeeklySeoRhythm.ts` used `spawn` in the dashboard export post-chain without importing it. The import was added and synced to Beget. After that, the dashboard export reached the real MySQL blocker above, which was later fixed by `telegatask_seo@localhost`.

## MySQL Export Final Fix

Final state: dashboard export is working from Beget without MySQL root.

- Created a dedicated MySQL writer: `telegatask_seo@localhost`.
- Left `report_bd` unchanged for ReportingDash/canonical collectors.
- `/opt/telegatask/.env` now uses:
  - `MYSQL_HOST=localhost`
  - `MYSQL_DB=report_bd`
  - `MYSQL_USER=telegatask_seo`
- `.env` is `600`; backup saved on Beget.
- The exporter scripts use `mysql --no-defaults` so `/root/.my.cnf` cannot inject root credentials:
  - `scripts/runSeoMysqlDashboardExport.ts`
  - `scripts/runSeoSovWeeklyExport.ts`
  - `scripts/runSeoAiVisibilityImport.ts`
- Live W30/data-W29 export under `telegatask_seo` succeeded:

```json
{
  "status": "exported",
  "mysqlWrites": true,
  "summary": {
    "weekKey": "2026-W29",
    "positions": 26,
    "opportunities": 3,
    "tasks": 4,
    "weeklyRuns": 1
  }
}
```

DB counts after upsert:

```text
seo_weekly_runs       1
seo_positions_weekly  26
seo_opportunities     9
seo_tasks             4
```

## Callback Incident Fix (2026-07-20)

The first approval click on the W30 Telegram digest failed on the Mac bot:

```text
ENOENT: no such file or directory, open 'reports/task-048-zaruku-weekly-seo-rhythm-2026-W30.json'
```

Root cause: the weekly artifact was created on Beget, while Telegram callbacks are still handled by the Mac bot. The approval resolver used to require a local artifact file to map callback data to `opportunityId`.

Fix:

- weekly runs now persist compact `approvalTargets` in the Firestore run record;
- callback resolver reads `approvalTargets` first and falls back to local artifact files only for older runs;
- W30 was backfilled with approval targets from the Beget artifact;
- Beget code and Mac bot code were rebuilt/restarted.

Verified resolver for W30:

```json
{
  "opportunityId": "seo_opp_0df8162a661dd0c5",
  "clusterId": "seed_self_check_screening"
}
```

## TimeWeb Deploy Runbook If SSH Is Restored Later

1. Add a dedicated key, preferably `~/.ssh/telegatask_timeweb_ed25519`, to `/root/.ssh/authorized_keys` on TimeWeb.
2. Add an SSH alias:

```sshconfig
Host telegatask-prod
  HostName 147.45.132.90
  Port 2222
  User root
  IdentityFile ~/.ssh/telegatask_timeweb_ed25519
  IdentitiesOnly yes
```

3. Verify read-only:

```bash
ssh telegatask-prod 'cd /opt/telegatask && pwd && pm2 describe telegatask && crontab -l'
```

4. Ensure the Mac station has `SEO_WEEKLY_RHYTHM_CRON=0`.
5. Deploy/update TimeWeb using the existing deploy flow only after confirming no other cron jobs are modified.
6. On TimeWeb, enable only the Telegatask scheduler flags needed for this process:

```dotenv
SEO_WEEKLY_RHYTHM_CRON=1
SEO_WEEKLY_RHYTHM_TIME_ZONE=Europe/Vienna
SEO_GLOBAL_REPORT_POST_CHAIN=1
SEO_MYSQL_DASHBOARD_POST_CHAIN=1
SEO_MYSQL_DASHBOARD_EXPORT=1
```

7. Restart only the `telegatask` PM2 process with updated env.
8. Verify:
   - PM2 process is online.
   - startup catch-up either runs or noops by `runWeekKey`.
   - weekly artifact exists for `runWeekKey`.
   - global report exists for `dataWeekKey`.
   - MySQL export artifact is `exported` or `export_pending` with a retryable error.

## Tests

Passing:

```bash
npx tsc --noEmit --pretty false
npx vitest run src/features/seoAgent/weeklySeoRhythm.test.ts
```

Beget verification:

```bash
cd /opt/telegatask
npm run build
SEO_WEEKLY_RHYTHM_CRON=0 node -r ts-node/register/transpile-only scripts/runWeeklySeoRhythm.ts --dry-run-no-telegram --out-dir reports/smoke --now 2026-07-20T07:30:00.000Z
```

The Beget smoke returned disabled with the expected split:

```json
{
  "weekKey": "2026-W30",
  "runWeekKey": "2026-W30",
  "dataWeekKey": "2026-W29",
  "runId": "seo_weekly_2026-W30"
}
```

Beget `vitest` cannot run on the installed Node `v20.11.1` because current Vitest/Rolldown expects newer Node APIs (`node:util.styleText`). TypeScript build does pass on Beget.

Final verification:

```bash
npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts
npm test -- --run
```

## Recommended Next

Leave W31 as the autonomy exam on Beget. If W31 runs at Monday 09:10 Europe/Vienna and produces Telegram + Firestore + MySQL dashboard export without manual intervention, Level 1 reliability can be treated as proven.
