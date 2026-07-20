# Alisa AI Visibility Workbook Import Design

## Goal

Add a standard, repeatable command that reads a `neurostatistics-zaruku.ru-*.xlsx` export directly, validates it, computes the current AI visibility dashboard metrics deterministically, saves complete evidence, and writes one `seo_ai_visibility` row through the existing MySQL import builder and write gate.

This task does not change dashboard UI and does not feed AI visibility into the Opportunity Engine or any recommendation logic.

## Source Workbook Contract

The importer accepts one `.xlsx` workbook containing a sheet with these required headers:

- `Запрос`
- `Присутствует сайт`
- `Ответ в Алисе AI`
- one or more consecutively numbered source columns beginning with `Сайт 1`

The current Neurostatistics export has `Сайт 1` through `Сайт 10`. Fully blank trailing rows are ignored. Every non-blank data row must have a query, a valid `true` or `false` presence value, and a valid Alice answer URL.

The filename must match `neurostatistics-zaruku.ru-YYYYMMDD-HHmmss.xlsx`. Its timestamp is retained as source-capture evidence. Dashboard grouping is never inferred solely from the filename: `--period` is required explicitly.

## Metric Semantics

The current `seo_ai_visibility` dashboard contract uses the following meanings:

- `query_count`: number of validated, non-blank query rows.
- `mentions`: number of rows whose normalized `Присутствует сайт` value is `true`.
- `citations`: checked examples, equal to `query_count` under the current dashboard contract.
- `presence_rate`: `mentions / query_count`, rounded to four decimal places for MySQL.
- `total_source_citations`: count of all non-empty cells across the `Сайт N` columns.
- `zaruku_source_citations`: count of source cells whose normalized hostname is `zaruku.ru`.
- `citation_concentration`: the most-cited Zaruku URL's citation count divided by `zaruku_source_citations`, rounded to four decimal places. This is a diversification measurement hook; lower concentration is the future target.

For the supplied workbook, the expected tuple is:

```text
query_count = 155
mentions = 89
citations = 155
presence_rate = 89 / 155 = 0.5742
total_source_citations = 1313
zaruku_source_citations = 89
citation_concentration = 60 / 89 = 0.6742
```

`total_source_citations` and `zaruku_source_citations` are evidence metrics. The existing MySQL table receives `mentions`, `citations`, and `presence_rate` without a schema change.

## Normalization and Validation

### Query normalization

Duplicate detection uses a normalized query key:

1. trim leading and trailing whitespace;
2. lowercase using Unicode-aware casing;
3. collapse internal whitespace to one ASCII space;
4. replace `ё` with `е`.

Two rows with the same normalized key make the import fail. The evidence keeps the original query text.

### Host and URL normalization

Source URLs are parsed with the standard URL parser. The hostname is lowercased and a leading `www.` is removed. Therefore these all resolve to the target host `zaruku.ru`:

- `https://zaruku.ru/path`
- `https://www.zaruku.ru/path/`
- `https://zaruku.ru/path?query=1#fragment`

The full normalized URL, including path, query, and hash where supplied, remains evidence. Host matching is exact after `www.` removal; lookalike domains such as `zaruku.ru.example.com` do not match.

### Consistency checks

The import fails before SQL is generated when any of these conditions occurs:

- a required header is absent or duplicated;
- `Сайт N` columns are missing or not consecutively numbered;
- no valid query rows exist;
- a query is duplicated after normalization;
- a presence value is not boolean `true`/`false` or its equivalent string;
- a query or Alice answer URL is missing or invalid;
- a non-empty source cell is not a valid HTTP or HTTPS URL;
- `Присутствует сайт=true` but no `zaruku.ru` source cell exists in the row;
- `Присутствует сайт=false` but a `zaruku.ru` source cell exists in the row.

The last two rules prevent silent divergence between the presence flag, source citations, and calculated rate.

## Architecture

### Workbook parser and aggregator

A focused module under `src/features/seoAgent` reads `.xlsx` files with `exceljs`. It exposes a workbook-reading boundary plus pure row normalization and aggregation functions so validation and metric rules can be tested independently from filesystem and XLSX decoding.

The parser returns a typed import result containing source metadata, validated rows, the metric tuple, missing-query evidence, Zaruku URL aggregates, and external-domain aggregates.

### Standard CLI

Add `scripts/importAlisaAiVisibilityWorkbook.ts` with this contract:

```text
--file <neurostatistics-zaruku.ru-*.xlsx>   required
--period <YYYY-MM>                          required
--captured-at <ISO-8601 timestamp>          required
--out <evidence.json>                       required
--sql-out <export.sql>                      optional
--execute                                   optional
```

The command fixes `engine=alisa_ai` and `provenance=wm_alisa_workbook`. This creates an idempotent workbook-sample row for the dashboard period without overwriting `provenance=wm_alisa_manual`, whose `presence_rate=0.4400` is the distinct Yandex-computed WM chart SoV baseline. The workbook origin is recorded in `raw_json` and the evidence artifact.

The existing manual `scripts/runSeoAiVisibilityImport.ts` command remains available and unchanged for backward compatibility.

### Existing MySQL path

The new command converts the parsed result into `SeoAiVisibilityRecord` and calls the existing `buildAiVisibilityImportPlan`. It uses the current Zaruku MySQL configuration, table name, DDL, idempotent `ON DUPLICATE KEY UPDATE`, `mysql --no-defaults` execution convention, and explicit write gate.

MySQL writes occur only when both conditions are true:

- the command includes `--execute`;
- `SEO_MYSQL_DASHBOARD_EXPORT=1` is present in the environment.

Without both conditions the command is a dry run, saves its artifacts, and reports `export_pending` without connecting to MySQL.

## Evidence Artifact

The JSON evidence artifact is written for both dry runs and live attempts. It contains:

- schema version and generation timestamp;
- absolute source path, filename, SHA-256 checksum, sheet name, filename timestamp, explicit `captured_at`, and explicit dashboard period;
- complete metric tuple, including `query_count`, `total_source_citations`, `zaruku_source_citations`, and `citation_concentration`;
- every missing query with its Alice answer URL;
- every normalized Zaruku URL with citation count, query count, and contributing queries;
- every external competitor/source domain with citation count, query count, and representative source URLs;
- validation counts and consistency results;
- generated MySQL plan summary, execution status, and safe side-effect flags;
- the compact MySQL record that was built from the workbook.

The `seo_ai_visibility.raw_json` value remains compact. It includes the workbook filename and SHA-256, evidence artifact path, query count, total and Zaruku source citation counts, citation concentration, sheet name, and import mode. It does not embed the complete evidence artifact.

The dashboard read-model contract treats `wm_alisa_manual` chart SoV as the headline AI visibility metric and `wm_alisa_workbook` as secondary sample evidence displayed as checked examples such as `89/155`. This task records that distinction in the read-model contract but does not change dashboard UI code.

Artifact filenames in the weekly workflow include the capture date or timestamp so later imports in the same monthly dashboard period do not overwrite earlier evidence. MySQL intentionally retains the latest capture for the period through its existing idempotent key.

## Error and Side-Effect Behavior

Workbook, validation, and flag errors terminate with a non-zero exit code before SQL or MySQL execution. MySQL failures are captured in the evidence artifact as `export_pending` with the retryable error, matching the existing import behavior.

The command has no Firestore writes, Telegram sends, scheduler changes, production WGD runs, dashboard UI writes, or Opportunity Engine calls. The evidence artifact states these exclusions explicitly.

## Testing Strategy

Development follows red-green-refactor cycles. Tests cover:

- direct reading of a representative Neurostatistics-format XLSX fixture;
- the supplied workbook tuple of `155`, `89`, `155`, `0.5742`, `1313`, and `89`;
- host normalization for bare, `www`, trailing-slash, query, and hash variants;
- normalized duplicate-query rejection, including casing, whitespace, and `ё`/`е` variants;
- presence/source disagreement in both directions;
- malformed headers, values, URLs, and empty workbooks;
- deterministic missing-query, Zaruku URL, and external-domain aggregation;
- required CLI flags and explicit monthly period validation;
- dry-run behavior and existing MySQL plan generation;
- live-write gating with an injected executor rather than a real database;
- preservation of the existing manual command and MySQL builder behavior.

Verification includes the focused test files, the complete relevant test suite, TypeScript compilation, a dry run against the supplied workbook, inspection of the generated evidence and SQL, and a scope check confirming no dashboard UI or recommendation files changed.

## Exact Weekly Workflow

The runbook will document this operator sequence:

1. Download the current Neurostatistics workbook without modifying it.
2. Record its capture timestamp with an explicit timezone and choose the dashboard month as `--period YYYY-MM`.
3. Run the command without `--execute`, saving uniquely named evidence and SQL artifacts.
4. Review the checksum, metric tuple, validation section, missing queries, Zaruku URLs, and top external domains.
5. Re-run the same input with `SEO_MYSQL_DASHBOARD_EXPORT=1` and `--execute`, writing a separate live evidence artifact.
6. Confirm `status=exported` and `sideEffects.mysqlWrites=true`.
7. Query `seo_ai_visibility` by analytics account, engine, period, and provenance; verify that the `wm_alisa_workbook` row contains the sample metrics while the `wm_alisa_manual` row remains `presence_rate=0.4400`. Verify citation concentration and the workbook checksum in `raw_json`.
8. Retain the original workbook, dry-run evidence, live evidence, and SQL file as the weekly audit trail.

The standard live command shape is:

```bash
SEO_MYSQL_DASHBOARD_EXPORT=1 npx ts-node --transpile-only scripts/importAlisaAiVisibilityWorkbook.ts \
  --file /Users/nafanya/Downloads/neurostatistics-zaruku.ru-20260720-192621.xlsx \
  --period 2026-07 \
  --captured-at 2026-07-20T19:26:21+03:00 \
  --out reports/alisa-ai-visibility-2026-07-20260720-live-evidence.json \
  --sql-out reports/alisa-ai-visibility-2026-07-20260720.sql \
  --execute
```

## Deferred Follow-Up

The next task may add AI visibility as an explicit Opportunity Engine input and recommendation signal only after the TASK-058 Level 1 closure preconditions are met. That follow-up must define freshness, period selection, thresholds, weighting, missing-data behavior, and recommendation evidence separately. No part of that integration is implemented, pre-wired, or created as a follow-up task here.
