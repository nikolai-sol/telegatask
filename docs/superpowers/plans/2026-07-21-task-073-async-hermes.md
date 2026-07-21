# TASK-073 async Hermes implementation plan

1. Add failing tests for advisory job DDL/export and state-preserving idempotent upserts.
2. Add `seo_advisory_jobs` to the schema, production table config, and dashboard export plan.
3. Add pure async-worker lifecycle tests and implementation for pending, ready, skipped, stale, retry, and no-op paths.
4. Add an idempotent Telegram advisory text merger and tests.
5. Add MySQL CLI, Hermes, and Telegram adapters in an on-demand Mac worker script.
6. Remove Hermes imports, flags, and calls from the weekly Beget CLI; export digest chat/message metadata for pending jobs.
7. Add an independent opt-in Mac scheduler and environment documentation.
8. Run targeted tests, full tests, typecheck/build, and a dry-run/no-op worker check.
9. Record implementation and operational evidence in `TASK-073_NOTES.md` and update the Notion task status/evidence.
