import type { SeoSearchConsoleSnapshot } from "./types";

export type SeoSearchPerformanceSource = "gsc" | "yandex_webmaster";
export type SeoSearchEngine = "google" | "yandex";
export type SeoSearchPerformanceDimension = "summary" | "query" | "page" | "country" | "device";

export type SeoSearchPerformanceRecord = {
  source: SeoSearchPerformanceSource;
  searchEngine: SeoSearchEngine;
  property: string | null;
  siteUrl: string | null;
  dateRange: {
    startDate: string | null;
    endDate: string | null;
    days: number | null;
  };
  dimension: SeoSearchPerformanceDimension;
  key: string | null;
  query: string | null;
  page: string | null;
  country: string | null;
  device: string | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  averagePosition: number | null;
  sourceRank: number | null;
};

type NormalizeSnapshotInput = {
  source: SeoSearchPerformanceSource;
  snapshot: SeoSearchConsoleSnapshot;
};

type NormalizeSnapshotsInput = {
  searchConsole?: SeoSearchConsoleSnapshot | null;
  yandexWebmaster?: SeoSearchConsoleSnapshot | null;
};

function searchEngineForSource(source: SeoSearchPerformanceSource): SeoSearchEngine {
  return source === "gsc" ? "google" : "yandex";
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanValues(values: string[]): string[] {
  return values.map(cleanString).filter(Boolean);
}

function hasAnySnapshotData(snapshot: SeoSearchConsoleSnapshot): boolean {
  return Boolean(
    cleanString(snapshot.property) ||
      cleanString(snapshot.siteUrl) ||
      cleanString(snapshot.dateRange.startDate) ||
      cleanString(snapshot.dateRange.endDate) ||
      snapshot.dateRange.days !== null ||
      snapshot.clicks !== null ||
      snapshot.impressions !== null ||
      snapshot.ctr !== null ||
      snapshot.averagePosition !== null ||
      snapshot.topQueries.length > 0 ||
      snapshot.topPages.length > 0 ||
      snapshot.countries.length > 0 ||
      snapshot.devices.length > 0
  );
}

function baseRecord(input: NormalizeSnapshotInput): Omit<
  SeoSearchPerformanceRecord,
  "dimension" | "key" | "query" | "page" | "country" | "device" | "sourceRank"
> {
  return {
    source: input.source,
    searchEngine: searchEngineForSource(input.source),
    property: input.snapshot.property,
    siteUrl: input.snapshot.siteUrl,
    dateRange: { ...input.snapshot.dateRange },
    clicks: input.snapshot.clicks,
    impressions: input.snapshot.impressions,
    ctr: input.snapshot.ctr,
    averagePosition: input.snapshot.averagePosition,
  };
}

function dimensionRecord(input: {
  base: Omit<SeoSearchPerformanceRecord, "dimension" | "key" | "query" | "page" | "country" | "device" | "sourceRank">;
  dimension: SeoSearchPerformanceDimension;
  key: string;
  sourceRank: number;
}): SeoSearchPerformanceRecord {
  return {
    ...input.base,
    dimension: input.dimension,
    key: input.key,
    query: input.dimension === "query" ? input.key : null,
    page: input.dimension === "page" ? input.key : null,
    country: input.dimension === "country" ? input.key : null,
    device: input.dimension === "device" ? input.key : null,
    sourceRank: input.sourceRank,
    // Current snapshots only expose aggregate metrics plus ordered dimension values.
    // Per-query/page metrics should be filled only after raw rows are available.
    clicks: null,
    impressions: null,
    ctr: null,
    averagePosition: null,
  };
}

function dimensionRecords(input: {
  base: Omit<SeoSearchPerformanceRecord, "dimension" | "key" | "query" | "page" | "country" | "device" | "sourceRank">;
  dimension: SeoSearchPerformanceDimension;
  values: string[];
}): SeoSearchPerformanceRecord[] {
  return cleanValues(input.values).map((value, index) =>
    dimensionRecord({
      base: input.base,
      dimension: input.dimension,
      key: value,
      sourceRank: index + 1,
    })
  );
}

export function normalizeSearchPerformanceSnapshot(input: NormalizeSnapshotInput): SeoSearchPerformanceRecord[] {
  if (!hasAnySnapshotData(input.snapshot)) return [];
  const base = baseRecord(input);
  return [
    {
      ...base,
      dimension: "summary",
      key: null,
      query: null,
      page: null,
      country: null,
      device: null,
      sourceRank: null,
    },
    ...dimensionRecords({ base, dimension: "query", values: input.snapshot.topQueries }),
    ...dimensionRecords({ base, dimension: "page", values: input.snapshot.topPages }),
    ...dimensionRecords({ base, dimension: "country", values: input.snapshot.countries }),
    ...dimensionRecords({ base, dimension: "device", values: input.snapshot.devices }),
  ];
}

export function normalizeSearchPerformanceSnapshots(input: NormalizeSnapshotsInput): SeoSearchPerformanceRecord[] {
  return [
    ...(input.searchConsole
      ? normalizeSearchPerformanceSnapshot({ source: "gsc", snapshot: input.searchConsole })
      : []),
    ...(input.yandexWebmaster
      ? normalizeSearchPerformanceSnapshot({ source: "yandex_webmaster", snapshot: input.yandexWebmaster })
      : []),
  ];
}
