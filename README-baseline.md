# Zaruku Golden Baseline

This baseline freezes the current production behavior of the Zaruku WGD pipeline before SEO OS migration work begins.

It protects output schema, required sections, required fields, collector presence, and report outline. It intentionally does not assert exact timestamps, durations, Firestore/API IDs, network timing, random values, or volatile metric values.

## Files

- `BASELINE_AUDIT.md`: architecture and migration audit.
- `src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts`: golden regression suite.
- `src/features/seoAgent/baseline/fixtures/`: sanitized baseline fixtures generated from the current Zaruku report.

## Run the Golden Baseline

```bash
npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts
```

This validates the committed sanitized fixtures by default.

## Run the Current Production Pipeline

The production runner contacts live services and writes Firestore documents.

Required environment depends on the collectors being exercised:

- Firebase Admin config used by `src/config/firebase.ts`
- Yandex Webmaster OAuth token or refresh-token/client credentials
- Yandex Search API key and folder id for rank checks
- Yandex generative search credentials for AI probes
- Local Lighthouse/Chrome availability through `npx lighthouse`

Run:

```bash
npx ts-node scripts/runWgdZarukuCancerPortal.ts
```

The runner writes:

- `reports/wgd-zaruku-cancer-portal-YYYY-MM-DD.json`
- `reports/wgd-zaruku-cancer-portal-YYYY-MM-DD.html`

## Verify a Fresh Production Report

After running the production pipeline, point the baseline test at the new report:

```bash
WGD_BASELINE_REPORT=reports/wgd-zaruku-cancer-portal-YYYY-MM-DD.json \
WGD_BASELINE_HTML=reports/wgd-zaruku-cancer-portal-YYYY-MM-DD.html \
npx vitest run src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts
```

The test validates schema and section compatibility, not exact metric equality.

## Update the Baseline Intentionally

Only update fixtures when production behavior intentionally changes and the change has been reviewed.

1. Run the production pipeline.
2. Verify the fresh JSON/HTML with `WGD_BASELINE_REPORT` and `WGD_BASELINE_HTML`.
3. Regenerate/sanitize fixtures from the accepted production report.
4. Review fixture diffs carefully.
5. Update `BASELINE_AUDIT.md` if architecture, collectors, outputs, or risks changed.

## Changes That Should Fail CI

- Removing or renaming top-level JSON sections.
- Removing required fields from `run`, collector outputs, draft tasks, recommendations, or report sections.
- Changing the selected Zaruku production sources away from `crawler`, `yandex_webmaster`, and `yandex_serp_rank`.
- Removing known source statuses from the normalized run.
- Changing draft task evidence shape.
- Removing HTML report sections such as Executive Snapshot, Yandex Webmaster queries, Yandex SERP rank checks, Lighthouse, AI source position, Source statuses, or Draft tasks.

## Changes That Should Not Fail Solely Because Values Differ

- Timestamps and run/task IDs.
- Source collection times and API operation IDs.
- Lighthouse timings and scores.
- Yandex query counts, impressions, CTR, positions, and SERP result order.
- AI answer text or source ordering, as long as required fields remain present.

