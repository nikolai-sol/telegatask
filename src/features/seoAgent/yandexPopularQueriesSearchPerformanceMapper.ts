import type { SeoSearchPerformanceRecord } from "./searchPerformanceNormalizer";
import { DEFAULT_SEARCH_PERFORMANCE_OPPORTUNITY_CONFIG } from "./searchPerformanceOpportunityEngine";

export type YandexPopularQueryMetricRow = {
  query: string;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  averagePosition: number | null;
};

export type YandexPopularQueriesSearchPerformanceInput = {
  queries: YandexPopularQueryMetricRow[];
  property?: string | null;
  siteUrl?: string | null;
  dateRange?: {
    startDate?: string | null;
    endDate?: string | null;
    days?: number | null;
  } | null;
};

export type YandexPopularQueriesSearchPerformanceReview = {
  source: "yandex_webmaster";
  searchEngine: "yandex";
  inputRows: number;
  mappedRecords: number;
  skippedRows: number;
  metricRichRecords: number;
  maxImpressions: number | null;
  defaultMinEvidenceImpressions: number;
  recordsAtOrAboveDefaultMinEvidenceImpressions: number;
  notes: string[];
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cleanDateRange(input: YandexPopularQueriesSearchPerformanceInput): SeoSearchPerformanceRecord["dateRange"] {
  return {
    startDate: cleanString(input.dateRange?.startDate) || null,
    endDate: cleanString(input.dateRange?.endDate) || null,
    days: cleanNumber(input.dateRange?.days),
  };
}

export function mapYandexPopularQueriesToSearchPerformanceRecords(
  input: YandexPopularQueriesSearchPerformanceInput
): SeoSearchPerformanceRecord[] {
  const records: SeoSearchPerformanceRecord[] = [];
  const dateRange = cleanDateRange(input);
  const property = cleanString(input.property) || null;
  const siteUrl = cleanString(input.siteUrl) || null;

  for (const row of input.queries) {
    const query = cleanString(row.query);
    if (!query) continue;

    records.push({
      source: "yandex_webmaster",
      searchEngine: "yandex",
      property,
      siteUrl,
      dateRange,
      dimension: "query",
      key: query,
      query,
      page: null,
      country: null,
      device: null,
      clicks: cleanNumber(row.clicks),
      impressions: cleanNumber(row.impressions),
      ctr: cleanNumber(row.ctr),
      averagePosition: cleanNumber(row.averagePosition),
      sourceRank: records.length + 1,
    });
  }

  return records;
}

function hasCompleteQueryMetrics(record: SeoSearchPerformanceRecord): boolean {
  return (
    record.impressions !== null &&
    record.clicks !== null &&
    record.ctr !== null &&
    record.averagePosition !== null
  );
}

export function reviewYandexPopularQueriesSearchPerformanceMapping(
  input: YandexPopularQueriesSearchPerformanceInput
): YandexPopularQueriesSearchPerformanceReview {
  const records = mapYandexPopularQueriesToSearchPerformanceRecords(input);
  const defaultMinEvidenceImpressions =
    DEFAULT_SEARCH_PERFORMANCE_OPPORTUNITY_CONFIG.thresholds.minEvidenceImpressions;
  const impressions = records
    .map((record) => record.impressions)
    .filter((value): value is number => value !== null);
  const recordsAtOrAboveDefaultMinEvidenceImpressions = records.filter(
    (record) => record.impressions !== null && record.impressions >= defaultMinEvidenceImpressions
  ).length;

  return {
    source: "yandex_webmaster",
    searchEngine: "yandex",
    inputRows: input.queries.length,
    mappedRecords: records.length,
    skippedRows: input.queries.length - records.length,
    metricRichRecords: records.filter(hasCompleteQueryMetrics).length,
    maxImpressions: impressions.length ? Math.max(...impressions) : null,
    defaultMinEvidenceImpressions,
    recordsAtOrAboveDefaultMinEvidenceImpressions,
    notes: [
      "This boundary maps existing Yandex popular-query rows to SearchPerformance records without persistence.",
      "Default Opportunity Engine thresholds are read for review only and are not changed.",
      "Production runner, collectors, reports and storage are not connected to this mapper.",
    ],
  };
}
