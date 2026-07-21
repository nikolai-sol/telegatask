import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test, vi } from "vitest";
import type { AlisaAiVisibilityWorkbookResult } from "../src/features/seoAgent/alisaAiVisibilityWorkbookImport";
import {
  parseImportAlisaAiVisibilityOptions,
  runImportAlisaAiVisibilityWorkbook,
} from "./importAlisaAiVisibilityWorkbook";

const workbookResult: AlisaAiVisibilityWorkbookResult = {
  source: {
    path: "/tmp/neurostatistics-zaruku.ru-20260720-192621.xlsx",
    filename: "neurostatistics-zaruku.ru-20260720-192621.xlsx",
    sha256: "a".repeat(64),
    filename_timestamp: "2026-07-20T19:26:21",
    sheet_name: "sheet1",
  },
  analysis: {
    metrics: {
      query_count: 155,
      mentions: 89,
      citations: 155,
      presence_rate: 0.5742,
      total_source_citations: 1313,
      zaruku_source_citations: 89,
      citation_concentration: 0.6742,
    },
    missing_queries: [
      {
        query: "missing query",
        alisa_answer_url: "https://yandex.ru/search/?text=missing",
      },
    ],
    zaruku_urls: [
      {
        url: "https://zaruku.ru/top",
        citation_count: 60,
        query_count: 60,
        queries: ["query"],
      },
    ],
    competitor_source_domains: [
      {
        domain: "example.org",
        citation_count: 12,
        query_count: 11,
        representative_urls: ["https://example.org/source"],
      },
    ],
    validation: {
      errors: [],
      rows_checked: 155,
      presence_source_consistency_checks: 155,
    },
  },
};

describe("importAlisaAiVisibilityWorkbook", () => {
  test("parses the standard command flags", () => {
    expect(
      parseImportAlisaAiVisibilityOptions([
        "--file",
        "/tmp/neurostatistics-zaruku.ru-20260720-192621.xlsx",
        "--period",
        "2026-07",
        "--captured-at",
        "2026-07-20T19:26:21+03:00",
        "--out",
        "reports/evidence.json",
        "--sql-out",
        "reports/import.sql",
        "--execute",
      ])
    ).toEqual({
      filePath: "/tmp/neurostatistics-zaruku.ru-20260720-192621.xlsx",
      period: "2026-07",
      capturedAt: "2026-07-20T19:26:21+03:00",
      outputPath: "reports/evidence.json",
      sqlOutputPath: "reports/import.sql",
      execute: true,
    });
  });

  test("rejects missing and invalid grouping flags", () => {
    expect(() => parseImportAlisaAiVisibilityOptions([])).toThrow(
      "Usage: importAlisaAiVisibilityWorkbook"
    );
    expect(() =>
      parseImportAlisaAiVisibilityOptions([
        "--file",
        "input.xlsx",
        "--period",
        "2026-W30",
        "--captured-at",
        "2026-07-20",
        "--out",
        "out.json",
      ])
    ).toThrow("Invalid --period");
  });

  test("writes reviewed evidence and SQL without executing MySQL in dry-run mode", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alisa-import-cli-"));
    const outputPath = join(directory, "evidence.json");
    const sqlOutputPath = join(directory, "import.sql");
    const executeSql = vi.fn(async () => undefined);
    try {
      const artifact = await runImportAlisaAiVisibilityWorkbook(
        {
          filePath: workbookResult.source.path,
          period: "2026-07",
          capturedAt: "2026-07-20T19:26:21+03:00",
          outputPath,
          sqlOutputPath,
          execute: false,
        },
        {
          now: () => "2026-07-20T20:00:00.000Z",
          environment: { SEO_MYSQL_DASHBOARD_EXPORT: "1" },
          executeSql,
          readWorkbook: async () => workbookResult,
        }
      );

      expect(artifact).toMatchObject({
        schemaVersion: "seo_os_alisa_ai_visibility_workbook_import_v1",
        status: "export_pending",
        metrics: workbookResult.analysis.metrics,
        validation: { errors: [] },
        record: {
          engine: "alisa_ai",
          period: "2026-07",
          mentions: 89,
          citations: 155,
          presenceRate: 0.5742,
          provenance: "wm_alisa_workbook",
          raw: {
            citationConcentration: 0.6742,
          },
        },
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
      expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual(artifact);
      expect(await readFile(sqlOutputPath, "utf8")).toContain(
        "INSERT INTO `seo_ai_visibility`"
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("executes exactly once only when execute and the environment gate are enabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alisa-import-cli-"));
    const executeSql = vi.fn(async () => undefined);
    try {
      const artifact = await runImportAlisaAiVisibilityWorkbook(
        {
          filePath: workbookResult.source.path,
          period: "2026-07",
          capturedAt: "2026-07-20T19:26:21+03:00",
          outputPath: join(directory, "evidence.json"),
          sqlOutputPath: null,
          execute: true,
        },
        {
          now: () => "2026-07-20T20:00:00.000Z",
          environment: { SEO_MYSQL_DASHBOARD_EXPORT: "1" },
          executeSql,
          readWorkbook: async () => workbookResult,
        }
      );

      expect(artifact.status).toBe("exported");
      expect(artifact.sideEffects.mysqlWrites).toBe(true);
      expect(executeSql).toHaveBeenCalledTimes(1);
      expect(executeSql.mock.calls[0][0]).toContain("'wm_alisa_workbook'");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
