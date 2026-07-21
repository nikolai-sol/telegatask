import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Workbook } from "exceljs";
import { describe, expect, test } from "vitest";
import {
  normalizeAlisaQuery,
  parseAlisaVisibilityRows,
  readAlisaAiVisibilityWorkbook,
} from "./alisaAiVisibilityWorkbookImport";

const header = [
  "Запрос",
  "Присутствует сайт",
  "Ответ в Алисе AI",
  "Сайт 1",
  "Сайт 2",
  "Сайт 3",
];

describe("Alisa AI visibility workbook rows", () => {
  test("normalizes duplicate-query keys", () => {
    expect(normalizeAlisaQuery("  Ёлка   ПРИ РАКЕ ")).toBe("елка при раке");
  });

  test("computes dashboard, source-citation, and concentration metrics", () => {
    const result = parseAlisaVisibilityRows([
      header,
      [
        "Запрос один",
        true,
        "https://yandex.ru/search/?text=1",
        "https://www.zaruku.ru/page/?x=1#part",
        "https://example.org/a",
        "https://zaruku.ru/page/?x=1#part",
      ],
      [
        "Запрос два",
        false,
        "https://yandex.ru/search/?text=2",
        "https://example.org/b",
        null,
        null,
      ],
    ]);

    expect(result.metrics).toEqual({
      query_count: 2,
      mentions: 1,
      citations: 2,
      presence_rate: 0.5,
      total_source_citations: 4,
      zaruku_source_citations: 2,
      citation_concentration: 1,
    });
    expect(result.missing_queries).toEqual([
      {
        query: "Запрос два",
        alisa_answer_url: "https://yandex.ru/search/?text=2",
      },
    ]);
    expect(result.zaruku_urls).toEqual([
      {
        url: "https://zaruku.ru/page/?x=1#part",
        citation_count: 2,
        query_count: 1,
        queries: ["Запрос один"],
      },
    ]);
    expect(result.competitor_source_domains).toEqual([
      {
        domain: "example.org",
        citation_count: 2,
        query_count: 2,
        representative_urls: [
          "https://example.org/a",
          "https://example.org/b",
        ],
      },
    ]);
    expect(result.validation).toEqual({
      errors: [],
      rows_checked: 2,
      presence_source_consistency_checks: 2,
    });
  });

  test("reconciles the TASK-069 baseline metric tuple", () => {
    const baselineHeader = [
      "Запрос",
      "Присутствует сайт",
      "Ответ в Алисе AI",
      ...Array.from({ length: 10 }, (_, index) => `Сайт ${index + 1}`),
    ];
    const rows = Array.from({ length: 155 }, (_, index) => {
      const sourceCount = index < 73 ? 9 : 8;
      const sources = Array.from(
        { length: sourceCount },
        (_, sourceIndex) => `https://source-${sourceIndex}.example/query-${index}`
      );
      if (index < 89) {
        sources[0] = index < 60
          ? "https://zaruku.ru/rak-molochnoj-zhelezy/invalidnost/"
          : `https://zaruku.ru/other-${index}/`;
      }
      return [
        `Запрос ${index + 1}`,
        index < 89,
        `https://yandex.ru/search/?text=${index + 1}`,
        ...sources,
      ];
    });

    const result = parseAlisaVisibilityRows([baselineHeader, ...rows]);

    expect(result.metrics).toEqual({
      query_count: 155,
      mentions: 89,
      citations: 155,
      presence_rate: 0.5742,
      total_source_citations: 1313,
      zaruku_source_citations: 89,
      citation_concentration: 0.6742,
    });
    expect(result.missing_queries).toHaveLength(66);
    expect(result.zaruku_urls[0].citation_count).toBe(60);
  });

  test("rejects normalized duplicate queries", () => {
    expect(() =>
      parseAlisaVisibilityRows([
        header,
        [" Ёлка  ", false, "https://yandex.ru/1", "https://example.org"],
        ["елка", false, "https://yandex.ru/2", "https://example.net"],
      ])
    ).toThrow("Duplicate normalized query");
  });

  test("rejects true presence without a Zaruku source", () => {
    expect(() =>
      parseAlisaVisibilityRows([
        header,
        ["query", true, "https://yandex.ru/1", "https://example.org"],
      ])
    ).toThrow("Presence/source mismatch");
  });

  test("rejects false presence with a Zaruku source", () => {
    expect(() =>
      parseAlisaVisibilityRows([
        header,
        ["query", false, "https://yandex.ru/1", "https://zaruku.ru/page"],
      ])
    ).toThrow("Presence/source mismatch");
  });

  test("reads a Neurostatistics XLSX file and records source metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alisa-workbook-"));
    const filePath = join(
      directory,
      "neurostatistics-zaruku.ru-20260720-192621.xlsx"
    );
    try {
      const workbook = new Workbook();
      const sheet = workbook.addWorksheet("sheet1");
      sheet.addRows([
        header,
        [
          "Запрос один",
          true,
          "https://yandex.ru/search/?text=1",
          "https://zaruku.ru/page",
          "https://example.org/a",
          null,
        ],
        [
          "Запрос два",
          false,
          "https://yandex.ru/search/?text=2",
          "https://example.org/b",
          null,
          null,
        ],
      ]);
      await workbook.xlsx.writeFile(filePath);

      const result = await readAlisaAiVisibilityWorkbook(filePath);

      expect(result.source).toMatchObject({
        filename: "neurostatistics-zaruku.ru-20260720-192621.xlsx",
        filename_timestamp: "2026-07-20T19:26:21",
        sheet_name: "sheet1",
      });
      expect(result.source.path).toBe(filePath);
      expect(result.source.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(result.analysis.metrics).toMatchObject({
        query_count: 2,
        mentions: 1,
        citations: 2,
        presence_rate: 0.5,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
