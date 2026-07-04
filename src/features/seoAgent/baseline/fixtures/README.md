# Zaruku Golden Baseline Fixtures

These fixtures were generated from `reports/wgd-zaruku-cancer-portal-2026-06-26.json`.

Volatile values such as Firestore IDs, run IDs, timestamps, source collection times, and rank-check timestamps are sanitized. Large arrays are trimmed where the test only needs representative shape.

## Fixture Coverage

- `run.json`: protects the persisted SEO analysis run shape, source selection, source status schema, normalized collector outputs, recommendations, findings, harness metadata, and scores.
- `draftTasks.json`: protects generated SEO draft task shape, evidence shape, labels, task status, priority, and conversion fields.
- `page.json`: protects the runner-owned homepage snapshot output.
- `sitemap.json`: protects the runner-owned sitemap summary output.
- `lighthouse.json`: protects the local Lighthouse summary output.
- `yandexQueries.json`: protects the expanded Yandex Webmaster popular-query output.
- `aiProbes.json`: protects the Yandex generative-search probe output.
- `report-outline.html`: protects the HTML report section outline without asserting volatile rendered metric values.
