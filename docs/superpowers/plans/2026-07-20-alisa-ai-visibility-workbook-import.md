# Alisa AI Visibility Workbook Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse Neurostatistics Alisa AI visibility XLSX exports directly, save auditable evidence, and upsert the deterministic monthly aggregate through the existing guarded MySQL path.

**Architecture:** A focused feature module owns XLSX decoding, normalization, validation, aggregation, and evidence types. A separate CLI owns flags, filesystem artifacts, the existing `buildAiVisibilityImportPlan` call, and guarded MySQL execution; the current manual CLI remains untouched.

**Tech Stack:** TypeScript 5.9, Node.js, Vitest 4, `exceljs`, existing MySQL CLI integration.

## Global Constraints

- `query_count` is the number of validated non-blank query rows.
- `mentions` is the number of rows marked present.
- `citations` equals `query_count` under the current dashboard contract.
- `presence_rate` is `mentions / query_count`, rounded to four decimal places.
- `total_source_citations` counts all non-empty `Сайт N` cells.
- `zaruku_source_citations` counts target-domain source cells.
- `--period YYYY-MM` and `--captured-at <ISO-8601>` are explicit required inputs.
- Normalize duplicate queries with trim, lowercase, collapsed whitespace, and `ё` to `е`.
- Normalize `www.zaruku.ru` to `zaruku.ru`; query strings, hashes, and trailing slashes must not change target-host recognition.
- Preserve `engine=alisa_ai` and `provenance=wm_alisa_manual` for the existing dashboard row key.
- Do not change dashboard UI, Opportunity Engine inputs, recommendation logic, scheduler behavior, Firestore, or Telegram.
- Do not execute MySQL until the dry-run evidence has been reviewed and matches `155 / 89 / 155 / 0.5742` with no validation errors.

---

## File Structure

- Create `src/features/seoAgent/alisaAiVisibilityWorkbookImport.ts`: parsing, normalization, validation, metrics, and evidence aggregation.
- Create `src/features/seoAgent/alisaAiVisibilityWorkbookImport.test.ts`: pure rules plus real XLSX decoding tests.
- Create `scripts/importAlisaAiVisibilityWorkbook.ts`: CLI flags, evidence/SQL writing, guarded MySQL execution.
- Create `scripts/importAlisaAiVisibilityWorkbook.test.ts`: dry-run, write-gate, and failure-path tests with injected dependencies.
- Create `docs/seo-ai-visibility-weekly-import.md`: exact operator workflow, review checklist, live command, and verification SQL.
- Modify `package.json` and `package-lock.json`: add `exceljs` as a direct runtime dependency.
- Modify `scripts/mysqlClientDefaults.test.ts`: include the new MySQL-writing command in the `--no-defaults` isolation check.

---

### Task 1: Deterministic Row Normalization and Aggregation

**Files:**

- Create: `src/features/seoAgent/alisaAiVisibilityWorkbookImport.ts`
- Create: `src/features/seoAgent/alisaAiVisibilityWorkbookImport.test.ts`

**Interfaces:**

- Consumes: header/value matrices decoded from XLSX.
- Produces: `normalizeAlisaQuery(value: string): string`, `parseAlisaVisibilityRows(matrix: unknown[][]): AlisaAiVisibilityAnalysis`, and the exported analysis/evidence types used by the CLI.

- [ ] **Step 1: Write failing tests for normalization and the dashboard metric contract**

Add tests with this public shape:

```ts
import { describe, expect, test } from "vitest";
import {
  normalizeAlisaQuery,
  parseAlisaVisibilityRows,
} from "./alisaAiVisibilityWorkbookImport";

const header = [
  "Запрос",
  "Присутствует сайт",
  "Ответ в Алисе AI",
  "Сайт 1",
  "Сайт 2",
];

describe("Alisa AI visibility workbook rows", () => {
  test("normalizes duplicate-query keys", () => {
    expect(normalizeAlisaQuery("  Ёлка   ПРИ РАКЕ ")).toBe("елка при раке");
  });

  test("computes dashboard and source-citation metrics", () => {
    const result = parseAlisaVisibilityRows([
      header,
      ["Запрос один", true, "https://yandex.ru/search/?text=1", "https://www.zaruku.ru/page/?x=1#part", "https://example.org/a"],
      ["Запрос два", false, "https://yandex.ru/search/?text=2", "https://example.org/b", null],
    ]);

    expect(result.metrics).toEqual({
      query_count: 2,
      mentions: 1,
      citations: 2,
      presence_rate: 0.5,
      total_source_citations: 3,
      zaruku_source_citations: 1,
    });
    expect(result.missing_queries).toEqual([
      { query: "Запрос два", alisa_answer_url: "https://yandex.ru/search/?text=2" },
    ]);
    expect(result.zaruku_urls[0]).toMatchObject({
      url: "https://zaruku.ru/page/?x=1#part",
      citation_count: 1,
      query_count: 1,
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify the RED state**

Run:

```bash
npx vitest run src/features/seoAgent/alisaAiVisibilityWorkbookImport.test.ts
```

Expected: FAIL because `alisaAiVisibilityWorkbookImport` does not exist.

- [ ] **Step 3: Implement the minimal typed parser and aggregator**

Define these stable types and functions:

```ts
export type AlisaAiVisibilityMetrics = {
  query_count: number;
  mentions: number;
  citations: number;
  presence_rate: number;
  total_source_citations: number;
  zaruku_source_citations: number;
};

export type AlisaAiVisibilityAnalysis = {
  sheet_name: string | null;
  metrics: AlisaAiVisibilityMetrics;
  missing_queries: Array<{ query: string; alisa_answer_url: string }>;
  zaruku_urls: Array<{
    url: string;
    citation_count: number;
    query_count: number;
    queries: string[];
  }>;
  competitor_source_domains: Array<{
    domain: string;
    citation_count: number;
    query_count: number;
    representative_urls: string[];
  }>;
  validation: {
    errors: string[];
    rows_checked: number;
    presence_source_consistency_checks: number;
  };
};

export function normalizeAlisaQuery(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").replace(/\s+/gu, " ");
}
```

Implementation rules inside `parseAlisaVisibilityRows`:

```ts
const presenceRate = Number((mentions / queryCount).toFixed(4));
const metrics = {
  query_count: queryCount,
  mentions,
  citations: queryCount,
  presence_rate: presenceRate,
  total_source_citations: totalSourceCitations,
  zaruku_source_citations: zarukuSourceCitations,
};
```

Parse URLs with `new URL`, require `http:` or `https:`, lowercase the hostname, remove one leading `www.`, and assign the normalized hostname back before serializing the URL. Aggregate maps by normalized Zaruku URL and external hostname. Sort aggregate output by descending `citation_count`, then ascending key using direct code-point comparison for host-independent determinism.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run src/features/seoAgent/alisaAiVisibilityWorkbookImport.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add validation regression tests one behavior at a time**

Add individual tests asserting these errors:

```ts
expect(() => parseAlisaVisibilityRows([header, [" Ёлка  ", false, "https://yandex.ru/1", "https://example.org"] , ["елка", false, "https://yandex.ru/2", "https://example.net"]])).toThrow("Duplicate normalized query");

expect(() => parseAlisaVisibilityRows([header, ["query", true, "https://yandex.ru/1", "https://example.org"]])).toThrow("Presence/source mismatch");

expect(() => parseAlisaVisibilityRows([header, ["query", false, "https://yandex.ru/1", "https://zaruku.ru/page"]])).toThrow("Presence/source mismatch");
```

Also cover missing/duplicate headers, non-consecutive `Сайт N` headers, invalid presence values, missing queries, invalid Alice/source URLs, and a workbook with no data rows.

- [ ] **Step 6: Run each new test before implementing its rule, then make all parser tests pass**

Run after each test addition:

```bash
npx vitest run src/features/seoAgent/alisaAiVisibilityWorkbookImport.test.ts
```

Expected cycle: the new test fails for the intended missing validation, then passes after the minimal validation is added.

- [ ] **Step 7: Commit the parser contract**

```bash
git add src/features/seoAgent/alisaAiVisibilityWorkbookImport.ts src/features/seoAgent/alisaAiVisibilityWorkbookImport.test.ts
git commit -m "feat(seo): define Alisa visibility workbook metrics"
```

---

### Task 2: Direct XLSX Reading and Source Metadata

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/features/seoAgent/alisaAiVisibilityWorkbookImport.ts`
- Modify: `src/features/seoAgent/alisaAiVisibilityWorkbookImport.test.ts`

**Interfaces:**

- Consumes: absolute path matching `neurostatistics-zaruku.ru-YYYYMMDD-HHmmss.xlsx`.
- Produces: `readAlisaAiVisibilityWorkbook(filePath: string): Promise<AlisaAiVisibilityWorkbookResult>` with SHA-256, filename timestamp, sheet name, and `analysis`.

- [ ] **Step 1: Add `exceljs` as a direct runtime dependency**

Run:

```bash
npm install exceljs
```

Expected: `package.json` and `package-lock.json` contain a direct `exceljs` dependency and `npm install` exits 0.

- [ ] **Step 2: Write a failing direct-XLSX test**

Use `exceljs` in the test to write a temporary workbook with the exact Russian headers and two rows. Call `readAlisaAiVisibilityWorkbook` and assert:

```ts
expect(result.source).toMatchObject({
  filename: "neurostatistics-zaruku.ru-20260720-192621.xlsx",
  filename_timestamp: "2026-07-20T19:26:21",
  sheet_name: "sheet1",
});
expect(result.source.sha256).toMatch(/^[a-f0-9]{64}$/u);
expect(result.analysis.metrics).toMatchObject({
  query_count: 2,
  mentions: 1,
  citations: 2,
  presence_rate: 0.5,
});
```

- [ ] **Step 3: Verify the direct-XLSX test fails**

Run:

```bash
npx vitest run src/features/seoAgent/alisaAiVisibilityWorkbookImport.test.ts
```

Expected: FAIL because `readAlisaAiVisibilityWorkbook` is not exported.

- [ ] **Step 4: Implement direct XLSX decoding**

Add `Workbook` from `exceljs`, `createHash` from `crypto`, and `readFile`/`resolve`/`basename` boundaries. Enforce the filename regex:

```ts
const filenamePattern = /^neurostatistics-zaruku\.ru-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.xlsx$/u;
```

Read the first non-empty worksheet, convert its used rows to a plain matrix using each cell's `.text` while preserving actual boolean cell values, pass the matrix to `parseAlisaVisibilityRows`, and return the absolute path, filename, SHA-256, filename timestamp, sheet name, and analysis.

- [ ] **Step 5: Verify the focused suite passes**

Run:

```bash
npx vitest run src/features/seoAgent/alisaAiVisibilityWorkbookImport.test.ts
```

Expected: all tests PASS with no warnings.

- [ ] **Step 6: Commit XLSX support**

```bash
git add package.json package-lock.json src/features/seoAgent/alisaAiVisibilityWorkbookImport.ts src/features/seoAgent/alisaAiVisibilityWorkbookImport.test.ts
git commit -m "feat(seo): read Neurostatistics visibility workbooks"
```

---

### Task 3: Guarded Import CLI and Evidence Artifact

**Files:**

- Create: `scripts/importAlisaAiVisibilityWorkbook.ts`
- Create: `scripts/importAlisaAiVisibilityWorkbook.test.ts`
- Modify: `scripts/mysqlClientDefaults.test.ts`

**Interfaces:**

- Consumes: `--file`, `--period`, `--captured-at`, `--out`, optional `--sql-out`, and optional `--execute`.
- Produces: `parseImportAlisaAiVisibilityOptions(args)`, `runImportAlisaAiVisibilityWorkbook(options, dependencies)`, JSON evidence, optional SQL, and an optional MySQL upsert through `buildAiVisibilityImportPlan`.

- [ ] **Step 1: Write failing flag-parser tests**

Assert the standard invocation parses exactly and that missing flags, non-`YYYY-MM` periods, invalid timestamps, and `--execute` without the environment gate are handled deterministically.

```ts
expect(parseImportAlisaAiVisibilityOptions([
  "--file", "/tmp/neurostatistics-zaruku.ru-20260720-192621.xlsx",
  "--period", "2026-07",
  "--captured-at", "2026-07-20T19:26:21+03:00",
  "--out", "reports/evidence.json",
  "--sql-out", "reports/import.sql",
  "--execute",
])).toEqual({
  filePath: "/tmp/neurostatistics-zaruku.ru-20260720-192621.xlsx",
  period: "2026-07",
  capturedAt: "2026-07-20T19:26:21+03:00",
  outputPath: "reports/evidence.json",
  sqlOutputPath: "reports/import.sql",
  execute: true,
});
```

- [ ] **Step 2: Run the CLI test and verify RED**

Run:

```bash
npx vitest run scripts/importAlisaAiVisibilityWorkbook.test.ts
```

Expected: FAIL because the command module does not exist.

- [ ] **Step 3: Implement the option parser and injectable runner**

Use this dependency boundary so tests never call the real database:

```ts
export type ImportAlisaAiVisibilityDependencies = {
  now: () => string;
  environment: NodeJS.ProcessEnv;
  executeSql: (sql: string) => Promise<void>;
};
```

Build this MySQL record:

```ts
const record: SeoAiVisibilityRecord = {
  engine: "alisa_ai",
  period: options.period,
  mentions: workbook.analysis.metrics.mentions,
  citations: workbook.analysis.metrics.citations,
  presenceRate: workbook.analysis.metrics.presence_rate,
  provenance: "wm_alisa_manual",
  capturedAt: options.capturedAt,
  raw: {
    source: "neurostatistics_workbook",
    filename: workbook.source.filename,
    sha256: workbook.source.sha256,
    sheetName: workbook.source.sheet_name,
    evidencePath: resolve(options.outputPath),
    queryCount: workbook.analysis.metrics.query_count,
    totalSourceCitations: workbook.analysis.metrics.total_source_citations,
    zarukuSourceCitations: workbook.analysis.metrics.zaruku_source_citations,
  },
};
```

Use `buildAiVisibilityImportPlan` with the existing Zaruku config. The ingestion run ID is `seo_os_ai_visibility_<period>_alisa_ai_neurostatistics` after safe character replacement.

- [ ] **Step 4: Write and pass dry-run evidence tests**

Assert the artifact contains:

```ts
expect(artifact).toMatchObject({
  schemaVersion: "seo_os_alisa_ai_visibility_workbook_import_v1",
  window: { kind: "period", period: "2026-07" },
  status: "export_pending",
  metrics: {
    query_count: 2,
    mentions: 1,
    citations: 2,
    presence_rate: 0.5,
  },
  validation: { errors: [] },
  sideEffects: {
    mysqlWrites: false,
    firestoreWrites: false,
    telegramMessagesSent: false,
    productionPipelineRun: false,
    dashboardUiChanged: false,
    recommendationSignalsChanged: false,
  },
});
expect(executeSql).not.toHaveBeenCalled();
```

The artifact also includes the full `missing_queries`, `zaruku_urls`, and `competitor_source_domains` arrays.

- [ ] **Step 5: Write and pass write-gate tests**

Test these cases separately:

- `--execute` absent and gate present: no executor call.
- `--execute` present and gate absent: no executor call, `export_pending`.
- both present: executor called once with SQL containing `INSERT INTO \`seo_ai_visibility\`` and artifact status `exported`.
- executor throws: artifact status `export_pending`, error captured, process remains retryable.

- [ ] **Step 6: Add the real MySQL executor with isolation**

Use the current configuration environment-variable names and:

```ts
spawn("mysql", [
  "--no-defaults",
  "--connect-timeout=10",
  "-h", host,
  "-P", port,
  "-u", user,
  database,
], {
  env: { ...process.env, MYSQL_PWD: password },
  stdio: ["pipe", "pipe", "pipe"],
});
```

Add `importAlisaAiVisibilityWorkbook.ts` to `mysqlExportScripts` in `scripts/mysqlClientDefaults.test.ts`.

- [ ] **Step 7: Run focused and MySQL-path regression tests**

Run:

```bash
npx vitest run scripts/importAlisaAiVisibilityWorkbook.test.ts scripts/mysqlClientDefaults.test.ts src/features/seoAgent/mysqlDashboardExport.test.ts
```

Expected: all tests PASS.

- [ ] **Step 8: Commit the standard command**

```bash
git add scripts/importAlisaAiVisibilityWorkbook.ts scripts/importAlisaAiVisibilityWorkbook.test.ts scripts/mysqlClientDefaults.test.ts
git commit -m "feat(seo): import Alisa visibility workbooks"
```

---

### Task 4: Weekly Operator Runbook

**Files:**

- Create: `docs/seo-ai-visibility-weekly-import.md`

**Interfaces:**

- Consumes: the completed CLI contract.
- Produces: an exact weekly dry-run, review, live-import, MySQL verification, dashboard refresh, and retention workflow.

- [ ] **Step 1: Write the runbook**

Document:

1. Preserve the original workbook.
2. Run without `--execute` to a uniquely dated dry-run evidence file.
3. Inspect with `jq` and require:

```bash
jq '{metrics, validation, missing_query_count: (.missing_queries | length), zaruku_url_count: (.zaruku_urls | length), top_domains: .competitor_source_domains[:20]}' reports/alisa-ai-visibility-2026-07-20260720-dry-run-evidence.json
```

4. Confirm `query_count=155`, `mentions=89`, `citations=155`, `presence_rate=0.5742`, `validation.errors=[]`, and sane evidence lists.
5. Run the exact authorized live command.
6. Run the supplied verification SQL.
7. Refresh the existing ReportingDash dashboard and verify the AI visibility card is approximately `57.4%`.
8. Retain workbook, dry evidence, live evidence, and SQL as the audit trail.

State explicitly that the same monthly MySQL row is updated by later weekly captures while dated artifacts retain history.

- [ ] **Step 2: Verify documentation and scope language**

Run:

```bash
rg -n "155|89|0\.5742|validation|--execute|SEO_MYSQL_DASHBOARD_EXPORT|SELECT|57\.4|Opportunity Engine" docs/seo-ai-visibility-weekly-import.md
git diff --check -- docs/seo-ai-visibility-weekly-import.md
```

Expected: every operational gate is present and no whitespace errors are reported.

- [ ] **Step 3: Commit the runbook**

```bash
git add docs/seo-ai-visibility-weekly-import.md
git commit -m "docs: add weekly AI visibility import workflow"
```

---

### Task 5: Verification, Dry Run, Authorized Live Import, and Handoff

**Files:**

- Generate: `reports/alisa-ai-visibility-2026-07-evidence.json`
- Generate: `reports/alisa-ai-visibility-2026-07.sql`

**Interfaces:**

- Consumes: the user-provided workbook and authorized MySQL environment.
- Produces: reviewed evidence, corrected MySQL row, refreshed dashboard observation, and a separate Codex task for read-only recommendation-signal work.

- [ ] **Step 1: Run all implementation verification**

Run:

```bash
npx vitest run src/features/seoAgent/alisaAiVisibilityWorkbookImport.test.ts scripts/importAlisaAiVisibilityWorkbook.test.ts scripts/mysqlClientDefaults.test.ts src/features/seoAgent/mysqlDashboardExport.test.ts
npx tsc --noEmit --pretty false
git diff --check
```

Expected: all tests pass, TypeScript exits 0, and no whitespace errors appear.

- [ ] **Step 2: Run a dry import against the supplied workbook**

Run the standard command without `--execute` and write a temporary dry-run artifact plus SQL:

```bash
npx ts-node --transpile-only scripts/importAlisaAiVisibilityWorkbook.ts \
  --file /Users/nafanya/Downloads/neurostatistics-zaruku.ru-20260720-192621.xlsx \
  --period 2026-07 \
  --captured-at 2026-07-20T19:26:21+03:00 \
  --out reports/alisa-ai-visibility-2026-07-20260720-dry-run-evidence.json \
  --sql-out reports/alisa-ai-visibility-2026-07-20260720-dry-run.sql
```

Expected: `status=export_pending`, `sideEffects.mysqlWrites=false`, and files exist.

- [ ] **Step 3: Review the dry-run evidence before any MySQL write**

Run:

```bash
jq '{metrics, validation, missing_queries: .missing_queries[:10], zaruku_urls: .zaruku_urls[:20], competitor_source_domains: .competitor_source_domains[:20]}' reports/alisa-ai-visibility-2026-07-20260720-dry-run-evidence.json
```

Require exact metrics:

```text
query_count = 155
mentions = 89
citations = 155
presence_rate = 0.5742
total_source_citations = 1313
zaruku_source_citations = 89
validation.errors = []
```

Also confirm 66 missing queries, 14 unique Zaruku URLs, and plausible external-domain counts led by known oncology, government, medical, and community sources. Stop before live execution if any value or evidence list is inconsistent.

- [ ] **Step 4: Run the explicitly authorized live import only after Step 3 passes**

Run exactly:

```bash
SEO_MYSQL_DASHBOARD_EXPORT=1 npx ts-node --transpile-only scripts/importAlisaAiVisibilityWorkbook.ts \
  --file /Users/nafanya/Downloads/neurostatistics-zaruku.ru-20260720-192621.xlsx \
  --period 2026-07 \
  --captured-at 2026-07-20T19:26:21+03:00 \
  --out reports/alisa-ai-visibility-2026-07-evidence.json \
  --sql-out reports/alisa-ai-visibility-2026-07.sql \
  --execute
```

Expected: evidence status `exported` and `sideEffects.mysqlWrites=true`.

- [ ] **Step 5: Verify MySQL with the supplied query**

Use the configured non-root MySQL credentials and run:

```sql
SELECT
  engine,
  period,
  mentions,
  citations,
  presence_rate,
  provenance,
  captured_at,
  ingestion_run_id
FROM seo_ai_visibility
WHERE engine = 'alisa_ai'
ORDER BY period DESC;
```

Require the `2026-07` row to contain `89`, `155`, `0.5742`, `wm_alisa_manual`, and the `2026-07-20` capture time.

- [ ] **Step 6: Refresh and verify the existing dashboard without changing UI code**

Open the existing ReportingDash deployment using the available browser session, refresh it, and verify the `AI-видимость` card displays approximately `57.4%`. Record the observed value; do not edit dashboard source or configuration.

- [ ] **Step 7: Perform the final scope and repository audit**

Run:

```bash
git status --short
git diff --name-only 5107dbf..HEAD
git log --oneline 5107dbf..HEAD
```

Confirm changed source files are limited to the importer, its tests, dependency metadata, the MySQL isolation test, and runbook. Generated evidence/SQL are audit artifacts. No dashboard UI, Opportunity Engine, recommendation, scheduler, Firestore, or Telegram file changed.

- [ ] **Step 8: Create the separate follow-up Codex task**

Only after Steps 1-7 pass, create a new user-owned task with this prompt:

```text
Use imported AI visibility evidence as a read-only recommendation signal.

Input:
- seo_ai_visibility aggregate
- evidence artifact from import

Goal:
- identify missing high-value Alisa queries
- do not auto-create tasks
- produce candidate AI visibility opportunities for review
- keep dashboard contract unchanged
```

Return the created task link/directive separately from the completed import summary.
