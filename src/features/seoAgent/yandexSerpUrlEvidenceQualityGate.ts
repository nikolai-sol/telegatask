import type { SeoSearchPerformanceRecord } from "./searchPerformanceNormalizer";
import type { SeoOpportunity } from "./types";
import type { YandexSerpQueryUrlEvidenceRecord } from "./yandexSerpQueryUrlEvidenceMapper";
import { isMatchingTargetDomain } from "./providers/serpMatching";

export type YandexSerpUrlEvidenceQualityGateStatus = "ready" | "review_required" | "blocked";
export type YandexSerpUrlEvidenceQualityCheckStatus = "pass" | "fail";
export type YandexSerpUrlEvidencePageType = "homepage" | "map_directory" | "content_page" | "other" | "invalid_url";

export type YandexSerpUrlEvidenceQualityGateConfig = {
  minRecordUrlCoverageRatio: number;
  minOpportunityUrlCoverageRatio: number;
  maxMismatchedDomainRecords: number;
};

export type YandexSerpUrlEvidenceQualityGateInput = {
  records: YandexSerpQueryUrlEvidenceRecord[];
  opportunities: SeoOpportunity[];
  targetDomain: string;
  targetDomainAliases?: string[];
  config?: Partial<YandexSerpUrlEvidenceQualityGateConfig>;
};

export type YandexSerpUrlEvidenceQualityCheck = {
  name: "record_url_coverage" | "opportunity_url_coverage" | "matched_url_domain";
  status: YandexSerpUrlEvidenceQualityCheckStatus;
  actual: number;
  expected: number;
  message: string;
};

export type YandexSerpUrlEvidenceQualityRecord = {
  query: string;
  url: string;
  pageType: YandexSerpUrlEvidencePageType;
  sourceRank: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  webmasterAveragePosition: number | null;
  serpPosition: number | null;
  positionDelta: number | null;
  targetDomainMatch: boolean;
};

export type YandexSerpUrlEvidenceQualityGateReport = {
  schemaVersion: "seo_os_yandex_serp_url_evidence_quality_gate_v1";
  source: "local_review";
  searchEngine: "yandex";
  status: YandexSerpUrlEvidenceQualityGateStatus;
  config: YandexSerpUrlEvidenceQualityGateConfig;
  summary: {
    eligibleQueryRecords: number;
    matchedUrlRecords: number;
    missingUrlRecords: number;
    recordUrlCoverageRatio: number;
    opportunityCount: number;
    opportunitiesWithTargetUrl: number;
    opportunityUrlCoverageRatio: number;
    mismatchedDomainRecords: number;
    pageTypeCounts: Record<YandexSerpUrlEvidencePageType, number>;
  };
  checks: YandexSerpUrlEvidenceQualityCheck[];
  matchedRecords: YandexSerpUrlEvidenceQualityRecord[];
  opportunityTargets: Array<{
    title: string | null;
    query: string | null;
    targetUrl: string | null;
    hasTargetUrl: boolean;
  }>;
  notes: string[];
};

export const DEFAULT_YANDEX_SERP_URL_EVIDENCE_QUALITY_GATE_CONFIG: YandexSerpUrlEvidenceQualityGateConfig = {
  minRecordUrlCoverageRatio: 0.5,
  minOpportunityUrlCoverageRatio: 0.8,
  maxMismatchedDomainRecords: 0,
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function isEligibleYandexQueryRecord(record: SeoSearchPerformanceRecord): boolean {
  return record.source === "yandex_webmaster" && record.dimension === "query" && Boolean(cleanString(record.query));
}

function classifyUrl(url: string): YandexSerpUrlEvidencePageType {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    if (path === "/") return "homepage";
    if (path === "/map" || path.startsWith("/map/")) return "map_directory";
    if (path.split("/").filter(Boolean).length >= 1) return "content_page";
    return "other";
  } catch {
    return "invalid_url";
  }
}

function positionDelta(input: {
  webmasterAveragePosition: number | null;
  serpPosition: number | null;
}): number | null {
  if (typeof input.webmasterAveragePosition !== "number" || typeof input.serpPosition !== "number") return null;
  return Number(Math.abs(input.webmasterAveragePosition - input.serpPosition).toFixed(4));
}

function buildConfig(
  config?: Partial<YandexSerpUrlEvidenceQualityGateConfig>
): YandexSerpUrlEvidenceQualityGateConfig {
  return {
    ...DEFAULT_YANDEX_SERP_URL_EVIDENCE_QUALITY_GATE_CONFIG,
    ...(config || {}),
  };
}

function qualityCheck(input: {
  name: YandexSerpUrlEvidenceQualityCheck["name"];
  actual: number;
  expected: number;
  pass: boolean;
  message: string;
}): YandexSerpUrlEvidenceQualityCheck {
  return {
    name: input.name,
    status: input.pass ? "pass" : "fail",
    actual: input.actual,
    expected: input.expected,
    message: input.message,
  };
}

function pageTypeCounts(records: YandexSerpUrlEvidenceQualityRecord[]): Record<YandexSerpUrlEvidencePageType, number> {
  return {
    homepage: records.filter((record) => record.pageType === "homepage").length,
    map_directory: records.filter((record) => record.pageType === "map_directory").length,
    content_page: records.filter((record) => record.pageType === "content_page").length,
    other: records.filter((record) => record.pageType === "other").length,
    invalid_url: records.filter((record) => record.pageType === "invalid_url").length,
  };
}

export function evaluateYandexSerpUrlEvidenceQualityGate(
  input: YandexSerpUrlEvidenceQualityGateInput
): YandexSerpUrlEvidenceQualityGateReport {
  const config = buildConfig(input.config);
  const eligibleRecords = input.records.filter(isEligibleYandexQueryRecord);
  const matchedRecords: YandexSerpUrlEvidenceQualityRecord[] = eligibleRecords
    .filter((record) => Boolean(record.serpUrlEvidence?.matchedUrl))
    .map((record) => {
      const url = cleanString(record.serpUrlEvidence?.matchedUrl);
      const serpPosition = typeof record.serpUrlEvidence?.serpPosition === "number"
        ? record.serpUrlEvidence.serpPosition
        : null;
      return {
        query: cleanString(record.query),
        url,
        pageType: classifyUrl(url),
        sourceRank: record.sourceRank,
        impressions: record.impressions,
        clicks: record.clicks,
        ctr: record.ctr,
        webmasterAveragePosition: record.averagePosition,
        serpPosition,
        positionDelta: positionDelta({
          webmasterAveragePosition: record.averagePosition,
          serpPosition,
        }),
        targetDomainMatch: isMatchingTargetDomain({
          targetDomain: input.targetDomain,
          targetDomainAliases: input.targetDomainAliases,
          resultUrl: url,
        }),
      };
    });
  const opportunityTargets = input.opportunities.map((opportunity) => ({
    title: cleanString(opportunity.title) || null,
    query: cleanString(opportunity.targetKeywords?.[0]) || null,
    targetUrl: cleanString(opportunity.targetUrl) || null,
    hasTargetUrl: Boolean(cleanString(opportunity.targetUrl)),
  }));
  const matchedUrlRecords = matchedRecords.length;
  const missingUrlRecords = Math.max(0, eligibleRecords.length - matchedUrlRecords);
  const recordUrlCoverageRatio = ratio(matchedUrlRecords, eligibleRecords.length);
  const opportunitiesWithTargetUrl = opportunityTargets.filter((item) => item.hasTargetUrl).length;
  const opportunityUrlCoverageRatio = ratio(opportunitiesWithTargetUrl, input.opportunities.length);
  const mismatchedDomainRecords = matchedRecords.filter((record) => !record.targetDomainMatch).length;
  const checks = [
    qualityCheck({
      name: "record_url_coverage",
      actual: recordUrlCoverageRatio,
      expected: config.minRecordUrlCoverageRatio,
      pass: recordUrlCoverageRatio >= config.minRecordUrlCoverageRatio,
      message: "Share of eligible Yandex query records with deterministic SERP matched URLs.",
    }),
    qualityCheck({
      name: "opportunity_url_coverage",
      actual: opportunityUrlCoverageRatio,
      expected: config.minOpportunityUrlCoverageRatio,
      pass: opportunityUrlCoverageRatio >= config.minOpportunityUrlCoverageRatio,
      message: "Share of generated opportunities carrying targetUrl after SERP URL evidence is applied.",
    }),
    qualityCheck({
      name: "matched_url_domain",
      actual: mismatchedDomainRecords,
      expected: config.maxMismatchedDomainRecords,
      pass: mismatchedDomainRecords <= config.maxMismatchedDomainRecords,
      message: "Matched SERP URLs must belong to the configured target domain or aliases.",
    }),
  ];
  const status = mismatchedDomainRecords > config.maxMismatchedDomainRecords
    ? "blocked"
    : checks.every((check) => check.status === "pass")
      ? "ready"
      : "review_required";

  return {
    schemaVersion: "seo_os_yandex_serp_url_evidence_quality_gate_v1",
    source: "local_review",
    searchEngine: "yandex",
    status,
    config,
    summary: {
      eligibleQueryRecords: eligibleRecords.length,
      matchedUrlRecords,
      missingUrlRecords,
      recordUrlCoverageRatio,
      opportunityCount: input.opportunities.length,
      opportunitiesWithTargetUrl,
      opportunityUrlCoverageRatio,
      mismatchedDomainRecords,
      pageTypeCounts: pageTypeCounts(matchedRecords),
    },
    checks,
    matchedRecords,
    opportunityTargets,
    notes: [
      "Local read-only SERP URL evidence quality gate only.",
      "The gate evaluates readiness for later automation but does not create or approve tasks.",
      "SERP position is compared as a separate evidence field and is not merged with Webmaster averagePosition.",
      "No API calls, Firestore writes, Telegram sends, scheduler actions or production pipeline execution are performed.",
    ],
  };
}
