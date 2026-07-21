import type { SeoOpportunity } from "./types";
import type { SeoSearchPerformanceRecord } from "./searchPerformanceNormalizer";
import { generateSearchPerformanceOpportunities } from "./searchPerformanceOpportunityEngine";
import {
  mapYandexPopularQueriesToSearchPerformanceRecords,
  reviewYandexPopularQueriesSearchPerformanceMapping,
  type YandexPopularQueriesSearchPerformanceReview,
  type YandexPopularQueryMetricRow,
} from "./yandexPopularQueriesSearchPerformanceMapper";
import {
  reviewYandexQueryToPageEvidence,
  type YandexQueryToPageEvidenceReview,
  type YandexQueryToPageSnapshotInput,
} from "./yandexQueryToPageEvidenceReview";
import type { YandexRankCheck } from "./types";

export type YandexOpportunityReviewCliOptions = {
  reportPath: string;
  outputPath: string;
  now: string | null;
  market: string | null;
  language: string | null;
};

export type YandexOpportunityReviewArtifact = {
  schemaVersion: "seo_os_yandex_opportunity_review_v1";
  generatedAt: string;
  sourceReportPath: string;
  runId: string | null;
  domain: string | null;
  sideEffects: {
    persisted: false;
    sent: false;
    productionPipelineRun: false;
  };
  input: {
    yandexQueries: number;
    property: string | null;
    siteUrl: string | null;
    dateRange: {
      startDate: string | null;
      endDate: string | null;
      days: number | null;
    };
  };
  searchPerformance: {
    recordCount: number;
    records: SeoSearchPerformanceRecord[];
    mappingReview: YandexPopularQueriesSearchPerformanceReview;
  };
  queryToPageEvidence: YandexQueryToPageEvidenceReview;
  opportunityCount: number;
  opportunities: SeoOpportunity[];
  notes: string[];
};

type BuildYandexOpportunityReviewArtifactInput = {
  report: unknown;
  reportPath: string;
  now?: string | null;
  market?: string | null;
  language?: string | null;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  return cleanString(args[index + 1]) || null;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readDateRange(value: unknown): YandexOpportunityReviewArtifact["input"]["dateRange"] {
  const data = readObject(value);
  return {
    startDate: cleanString(data.startDate) || null,
    endDate: cleanString(data.endDate) || null,
    days: cleanNumber(data.days),
  };
}

function readYandexQueryRows(value: unknown): YandexPopularQueryMetricRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const data = readObject(item);
    return {
      query: cleanString(data.query),
      impressions: cleanNumber(data.impressions),
      clicks: cleanNumber(data.clicks),
      ctr: cleanNumber(data.ctr),
      averagePosition: cleanNumber(data.averagePosition),
    };
  });
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanString).filter(Boolean);
}

function readPageSnapshot(value: unknown): YandexQueryToPageSnapshotInput | null {
  const data = readObject(value);
  if (!Object.keys(data).length) return null;
  return {
    url: cleanString(data.url) || null,
    finalUrl: cleanString(data.finalUrl) || null,
    title: cleanString(data.title) || null,
    description: cleanString(data.description) || null,
    h1: cleanString(data.h1) || null,
    bodySample: cleanString(data.bodySample) || null,
    internalLinks: readStringArray(data.internalLinks),
  };
}

function readYandexRankChecks(value: unknown): YandexRankCheck[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const data = readObject(item);
    const check: YandexRankCheck = {
      query: cleanString(data.query),
      searchEngine: "yandex",
      provider: "yandex_search_api",
      targetDomain: cleanString(data.targetDomain),
      found: Boolean(data.found),
      ...(cleanNumber(data.position) !== null ? { position: cleanNumber(data.position) as number } : {}),
      ...(cleanString(data.matchedUrl) ? { matchedUrl: cleanString(data.matchedUrl) } : {}),
      ...(cleanString(data.title) ? { title: cleanString(data.title) } : {}),
      ...(cleanString(data.snippet) ? { snippet: cleanString(data.snippet) } : {}),
      ...(readStringArray(data.serpFeatures).length ? { serpFeatures: readStringArray(data.serpFeatures) } : {}),
      ...(readStringArray(data.topResultDomains).length ? { topResultDomains: readStringArray(data.topResultDomains) } : {}),
      ...(cleanString(data.region) ? { region: cleanString(data.region) } : {}),
      ...(cleanString(data.language) ? { language: cleanString(data.language) } : {}),
      device: cleanString(data.device) === "mobile" ? "mobile" : "desktop",
      checkedAt: cleanString(data.checkedAt),
    };
    return check;
  }).filter((item) => item.query);
}

export function parseYandexOpportunityReviewCliOptions(args: string[]): YandexOpportunityReviewCliOptions {
  const reportPath = readFlag(args, "--report");
  const outputPath = readFlag(args, "--out");
  if (!reportPath || !outputPath) {
    throw new Error(
      "Usage: runYandexOpportunityReview --report <wgd-report.json> --out <review.json> [--now <iso>] [--market <market>] [--language <language>]"
    );
  }

  return {
    reportPath,
    outputPath,
    now: readFlag(args, "--now"),
    market: readFlag(args, "--market"),
    language: readFlag(args, "--language"),
  };
}

export function buildYandexOpportunityReviewArtifact(
  input: BuildYandexOpportunityReviewArtifactInput
): YandexOpportunityReviewArtifact {
  const report = readObject(input.report);
  const run = readObject(report.run);
  const yandexWebmaster = readObject(run.yandexWebmaster);
  const yandexQueries = readYandexQueryRows(report.yandexQueries);
  const dateRange = readDateRange(yandexWebmaster.dateRange);
  const property = cleanString(yandexWebmaster.property) || null;
  const siteUrl = cleanString(yandexWebmaster.siteUrl) || null;
  const generatedAt = cleanString(input.now) || new Date().toISOString();
  const mappingInput = {
    queries: yandexQueries,
    property,
    siteUrl,
    dateRange,
  };
  const records = mapYandexPopularQueriesToSearchPerformanceRecords(mappingInput);
  const queryToPageEvidence = reviewYandexQueryToPageEvidence({
    records,
    rankChecks: readYandexRankChecks(readObject(readObject(run.rankTracking).yandex).checks),
    page: readPageSnapshot(report.page),
  });
  const opportunities = generateSearchPerformanceOpportunities(records, {
    market: cleanString(input.market) || null,
    language: cleanString(input.language) || null,
  });

  return {
    schemaVersion: "seo_os_yandex_opportunity_review_v1",
    generatedAt,
    sourceReportPath: input.reportPath,
    runId: cleanString(run.id) || null,
    domain: cleanString(run.domain) || null,
    sideEffects: {
      persisted: false,
      sent: false,
      productionPipelineRun: false,
    },
    input: {
      yandexQueries: yandexQueries.length,
      property,
      siteUrl,
      dateRange,
    },
    searchPerformance: {
      recordCount: records.length,
      records,
      mappingReview: reviewYandexPopularQueriesSearchPerformanceMapping(mappingInput),
    },
    queryToPageEvidence,
    opportunityCount: opportunities.length,
    opportunities,
    notes: [
      "Local review artifact only.",
      "No Firestore writes, Telegram sends, scheduler actions or production pipeline execution.",
      "Opportunity Engine thresholds are not overridden by this review script.",
      "Query-to-page evidence is reviewed locally and does not alter opportunity target URLs.",
    ],
  };
}
