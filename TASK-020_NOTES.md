# TASK-020 — Controlled Dry-Run Execution Checklist

Status: Completed.

## Objective

Define a controlled checklist for the first live read-only execution of the Weekly Top-10 reporting export path.

This task does not run the dry-run script. It documents the exact preflight, execution and validation steps needed before a human intentionally runs it.

## Scope

Allowed:

- Operational checklist.
- Command shape.
- Preconditions.
- Expected output validation.
- Failure handling.

Not allowed:

- Firestore writes.
- Storage schema changes.
- API route.
- Telegram delivery.
- Scheduler.
- Production SEO pipeline execution.
- Automatic package script wiring.

## Current dry-run entrypoints

Raw Weekly Top-10 dry-run result:

```bash
npx ts-node-dev --transpile-only --exit-child scripts/runWeeklyTop10DryRun.ts \
  --team-id <teamId> \
  --run-id <runId> \
  --opportunities <opportunities.json> \
  --now <iso>
```

Dashboard/reporting export payload:

```bash
npx ts-node-dev --transpile-only --exit-child scripts/runWeeklyTop10ReportingExport.ts \
  --team-id <teamId> \
  --run-id <runId> \
  --opportunities <opportunities.json> \
  --now <iso>
```

Optional config flags:

- `--max-items <n>`
- `--max-watchlist-items <n>`
- `--min-confidence-score <n>`
- `--stale-approved-days <n>`

## Preflight checklist

Before running either command:

- Confirm `teamId` and `runId` point to a non-critical or expected SEO run.
- Confirm the opportunities JSON is local and reviewed.
- Confirm the opportunities JSON is an array of `SeoOpportunity`-like objects.
- Confirm credentials/env are present only for read access needed by existing repositories.
- Confirm no package script, cron, route or Telegram trigger was added.
- Run local verification:

```bash
npm test
npm run build
```

## Execution guardrails

When running the controlled dry-run:

- Prefer `scripts/runWeeklyTop10ReportingExport.ts` for dashboard contract validation.
- Use an explicit `--now` ISO timestamp for deterministic output.
- Save output manually only if needed for review.
- Do not pipe the output into any updater, sender or deploy command.
- Do not run `scripts/runWgdZarukuCancerPortal.ts` as part of this checklist.

## Expected output checks

The reporting export output must include:

- `schemaVersion: "seo_os_reporting_dashboard_export_v1"`
- `source.type: "weekly_top10_dry_run"`
- `source.mode: "dry_run"`
- `teamId` matching the requested team.
- `runId` matching the requested run.
- `weeklyTop10.summary`.
- `stateSummary`.
- `snapshotCounts`.
- `sideEffects.persisted: false`
- `sideEffects.sent: false`
- `sideEffects.productionPipelineRun: false`

## Acceptable first-run outcomes

The first controlled dry-run may return:

- zero included opportunities;
- empty watchlist;
- no approved stale items;
- implementation task count of zero;
- skipped or absent state matches if no draft tasks are linked.

These outcomes are acceptable if the side-effect flags remain false and the export schema is valid.

## Failure handling

If the command fails:

- Record the command, timestamp and error output.
- Do not retry with a production pipeline run.
- Do not add writes or persistence to fix visibility.
- First check:
  - malformed opportunities JSON;
  - missing `teamId` / `runId`;
  - missing read credentials;
  - missing linked draft tasks;
  - repository read errors.

If the output schema is invalid:

- Stop before dashboard/API integration.
- Add or adjust contract tests around `seoOsReportingExportContract`.
- Re-run `npm test` and `npm run build`.

## Completion criteria

TASK-020 is complete when:

1. The controlled dry-run checklist exists.
2. It names the exact dry-run entrypoints.
3. It preserves the no-write/no-send/no-production-pipeline contract.
4. It defines preflight checks.
5. It defines output validation checks.
6. It defines acceptable first-run outcomes.
7. It defines failure handling.

## Recommended next task

Proceed to TASK-021: perform one controlled local reporting export dry-run against a known `teamId`, `runId` and reviewed opportunities fixture, then record the observed output summary without adding persistence or delivery.
