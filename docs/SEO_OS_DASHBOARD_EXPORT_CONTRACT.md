# SEO OS Dashboard Export Contract

## Weekly Run Window

`seo_weekly_runs` uses two week keys:

- `week_key`: completed data week exported into dashboard facts.
- `run_week_key`: scheduler/run week that proves the weekly rhythm woke up.

Example:

```plain text
Monday 2026-07-20 cron
run_week_key = 2026-W30
week_key     = 2026-W29
runId        = seo_weekly_2026-W30
```

Dashboard rhythm-health panels should key wake-up status by `run_week_key`.
Data panels should continue to filter positions, opportunities, tasks and section facts by `week_key`.

## Telemetry

`seo_weekly_runs` telemetry is exported from the weekly rhythm artifact:

- `stages_json`: weekly rhythm stages;
- `serp_requests`: weekly rank tracking request count;
- `llm_tokens`: Hermes advisory token count when enrichment runs;
- `digest_count`: digest messages generated;
- `started_at`: weekly artifact start timestamp;
- `finished_at`: global report/export timestamp.

`seo_tasks.section` is derived from the matched opportunity section. Historical rows with `section='/'` should be corrected by re-running the dashboard export after TASK-071.
