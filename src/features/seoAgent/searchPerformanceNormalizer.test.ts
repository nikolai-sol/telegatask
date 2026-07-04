import { describe, expect, test } from "vitest";
import type { SeoSearchConsoleSnapshot } from "./types";
import {
  normalizeSearchPerformanceSnapshot,
  normalizeSearchPerformanceSnapshots,
} from "./searchPerformanceNormalizer";

const emptySnapshot: SeoSearchConsoleSnapshot = {
  property: null,
  siteUrl: null,
  dateRange: {
    startDate: null,
    endDate: null,
    days: null,
  },
  clicks: null,
  impressions: null,
  ctr: null,
  averagePosition: null,
  topQueries: [],
  topPages: [],
  countries: [],
  devices: [],
};

const gscSnapshot: SeoSearchConsoleSnapshot = {
  property: "sc-domain:zaruku.ru",
  siteUrl: "sc-domain:zaruku.ru",
  dateRange: {
    startDate: "2026-06-01",
    endDate: "2026-06-28",
    days: 28,
  },
  clicks: 10,
  impressions: 200,
  ctr: 5,
  averagePosition: 7.5,
  topQueries: ["рак лечение", "за руку"],
  topPages: ["https://zaruku.ru/rak/"],
  countries: ["rus"],
  devices: ["DESKTOP"],
};

const yandexSnapshot: SeoSearchConsoleSnapshot = {
  property: "https:zaruku.ru:443",
  siteUrl: "https://zaruku.ru/",
  dateRange: {
    startDate: "2026-06-17",
    endDate: "2026-06-23",
    days: 7,
  },
  clicks: 5,
  impressions: 100,
  ctr: 5,
  averagePosition: 8.9,
  topQueries: ["рак лечение"],
  topPages: [],
  countries: [],
  devices: ["ALL"],
};

describe("searchPerformanceNormalizer", () => {
  test("normalizes a GSC snapshot into source-marked summary and dimension records", () => {
    const records = normalizeSearchPerformanceSnapshot({
      source: "gsc",
      snapshot: gscSnapshot,
    });

    expect(records[0]).toEqual({
      source: "gsc",
      searchEngine: "google",
      property: "sc-domain:zaruku.ru",
      siteUrl: "sc-domain:zaruku.ru",
      dateRange: {
        startDate: "2026-06-01",
        endDate: "2026-06-28",
        days: 28,
      },
      dimension: "summary",
      key: null,
      query: null,
      page: null,
      country: null,
      device: null,
      clicks: 10,
      impressions: 200,
      ctr: 5,
      averagePosition: 7.5,
      sourceRank: null,
    });
    expect(records).toContainEqual(expect.objectContaining({
      source: "gsc",
      searchEngine: "google",
      dimension: "query",
      key: "рак лечение",
      query: "рак лечение",
      clicks: null,
      impressions: null,
      sourceRank: 1,
    }));
    expect(records).toContainEqual(expect.objectContaining({
      dimension: "page",
      key: "https://zaruku.ru/rak/",
      page: "https://zaruku.ru/rak/",
      sourceRank: 1,
    }));
  });

  test("keeps GSC and Yandex Webmaster records separate for the same query", () => {
    const records = normalizeSearchPerformanceSnapshots({
      searchConsole: gscSnapshot,
      yandexWebmaster: yandexSnapshot,
    });
    const sameQueryRecords = records.filter((record) => record.dimension === "query" && record.query === "рак лечение");

    expect(sameQueryRecords).toHaveLength(2);
    expect(sameQueryRecords).toEqual([
      expect.objectContaining({
        source: "gsc",
        searchEngine: "google",
        dateRange: { startDate: "2026-06-01", endDate: "2026-06-28", days: 28 },
      }),
      expect.objectContaining({
        source: "yandex_webmaster",
        searchEngine: "yandex",
        dateRange: { startDate: "2026-06-17", endDate: "2026-06-23", days: 7 },
      }),
    ]);
  });

  test("returns no records for an empty missing-source snapshot", () => {
    expect(normalizeSearchPerformanceSnapshot({ source: "gsc", snapshot: emptySnapshot })).toEqual([]);
  });

  test("trims blank dimension values without shifting source-specific rank for retained records", () => {
    const records = normalizeSearchPerformanceSnapshot({
      source: "yandex_webmaster",
      snapshot: {
        ...yandexSnapshot,
        topQueries: ["  ", "восстановление после рмж"],
      },
    });

    expect(records.filter((record) => record.dimension === "query")).toEqual([
      expect.objectContaining({
        source: "yandex_webmaster",
        searchEngine: "yandex",
        key: "восстановление после рмж",
        sourceRank: 1,
      }),
    ]);
  });
});
