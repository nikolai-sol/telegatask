import type { SeoSearchPerformanceRecord } from "./searchPerformanceNormalizer";
import type { YandexRankCheck } from "./types";

export type YandexQueryToPageEvidenceConfidence = "high" | "medium" | "low" | "none";
export type YandexQueryToPageEvidenceSource = "yandex_serp_rank" | "page_snapshot";

export type YandexQueryToPageSnapshotInput = {
  url?: string | null;
  finalUrl?: string | null;
  title?: string | null;
  description?: string | null;
  h1?: string | null;
  bodySample?: string | null;
  internalLinks?: string[];
};

export type YandexQueryToPageEvidenceItem = {
  source: YandexQueryToPageEvidenceSource;
  strength: Exclude<YandexQueryToPageEvidenceConfidence, "none"> | "negative";
  query: string;
  url: string | null;
  message: string;
};

export type YandexQueryToPageEvidenceReviewItem = {
  query: string;
  sourceRank: number | null;
  impressions: number | null;
  averagePosition: number | null;
  candidateUrl: string | null;
  confidence: YandexQueryToPageEvidenceConfidence;
  evidence: YandexQueryToPageEvidenceItem[];
  missingEvidence: string[];
};

export type YandexQueryToPageEvidenceReview = {
  schemaVersion: "seo_os_yandex_query_to_page_evidence_review_v1";
  source: "local_review";
  searchEngine: "yandex";
  summary: {
    reviewedQueries: number;
    withCandidateUrl: number;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    noCandidate: number;
  };
  items: YandexQueryToPageEvidenceReviewItem[];
  notes: string[];
};

export type YandexQueryToPageEvidenceReviewInput = {
  records: SeoSearchPerformanceRecord[];
  rankChecks?: YandexRankCheck[];
  page?: YandexQueryToPageSnapshotInput | null;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalized(value: unknown): string {
  return cleanString(value).toLowerCase();
}

function isYandexQueryRecord(record: SeoSearchPerformanceRecord): boolean {
  return record.source === "yandex_webmaster" && record.dimension === "query" && Boolean(cleanString(record.query));
}

function rankCheckByQuery(rankChecks: YandexRankCheck[] = []): Map<string, YandexRankCheck> {
  const byQuery = new Map<string, YandexRankCheck>();
  for (const check of rankChecks) {
    const query = normalized(check.query);
    if (query && !byQuery.has(query)) byQuery.set(query, check);
  }
  return byQuery;
}

function pageCandidate(input: {
  query: string;
  page?: YandexQueryToPageSnapshotInput | null;
}): { url: string; confidence: "medium" | "low"; evidence: YandexQueryToPageEvidenceItem } | null {
  const page = input.page;
  if (!page) return null;
  const query = normalized(input.query);
  const url = cleanString(page.finalUrl) || cleanString(page.url);
  if (!query || !url) return null;

  const fields: Array<{ name: string; value: unknown; confidence: "medium" | "low" }> = [
    { name: "title", value: page.title, confidence: "medium" },
    { name: "h1", value: page.h1, confidence: "medium" },
    { name: "description", value: page.description, confidence: "medium" },
    { name: "bodySample", value: page.bodySample, confidence: "low" },
  ];
  const match = fields.find((field) => normalized(field.value).includes(query));
  if (!match) return null;

  return {
    url,
    confidence: match.confidence,
    evidence: {
      source: "page_snapshot",
      strength: match.confidence,
      query: input.query,
      url,
      message: `Homepage snapshot ${match.name} contains exact query text for "${input.query}".`,
    },
  };
}

function reviewRecord(input: {
  record: SeoSearchPerformanceRecord;
  rankCheck?: YandexRankCheck;
  page?: YandexQueryToPageSnapshotInput | null;
}): YandexQueryToPageEvidenceReviewItem {
  const query = cleanString(input.record.query);
  const evidence: YandexQueryToPageEvidenceItem[] = [];
  const missingEvidence: string[] = [];
  const rankCheck = input.rankCheck;

  if (rankCheck) {
    if (rankCheck.found && cleanString(rankCheck.matchedUrl)) {
      const url = cleanString(rankCheck.matchedUrl);
      evidence.push({
        source: "yandex_serp_rank",
        strength: "high",
        query,
        url,
        message: `Yandex SERP rank check found target URL at position ${rankCheck.position ?? "unknown"} for "${query}".`,
      });
      return {
        query,
        sourceRank: input.record.sourceRank,
        impressions: input.record.impressions,
        averagePosition: input.record.averagePosition,
        candidateUrl: url,
        confidence: "high",
        evidence,
        missingEvidence,
      };
    }

    evidence.push({
      source: "yandex_serp_rank",
      strength: "negative",
      query,
      url: null,
      message: `Yandex SERP rank check did not find the target domain for "${query}".`,
    });
  } else {
    missingEvidence.push("No exact Yandex SERP rank check for this query.");
  }

  const pageMatch = pageCandidate({ query, page: input.page });
  if (pageMatch) {
    evidence.push(pageMatch.evidence);
    return {
      query,
      sourceRank: input.record.sourceRank,
      impressions: input.record.impressions,
      averagePosition: input.record.averagePosition,
      candidateUrl: pageMatch.url,
      confidence: pageMatch.confidence,
      evidence,
      missingEvidence,
    };
  }

  missingEvidence.push("No exact homepage snapshot text match for this query.");
  return {
    query,
    sourceRank: input.record.sourceRank,
    impressions: input.record.impressions,
    averagePosition: input.record.averagePosition,
    candidateUrl: null,
    confidence: "none",
    evidence,
    missingEvidence,
  };
}

export function reviewYandexQueryToPageEvidence(
  input: YandexQueryToPageEvidenceReviewInput
): YandexQueryToPageEvidenceReview {
  const rankChecks = rankCheckByQuery(input.rankChecks);
  const items = input.records
    .filter(isYandexQueryRecord)
    .map((record) =>
      reviewRecord({
        record,
        rankCheck: rankChecks.get(normalized(record.query)),
        page: input.page,
      })
    );

  return {
    schemaVersion: "seo_os_yandex_query_to_page_evidence_review_v1",
    source: "local_review",
    searchEngine: "yandex",
    summary: {
      reviewedQueries: items.length,
      withCandidateUrl: items.filter((item) => Boolean(item.candidateUrl)).length,
      highConfidence: items.filter((item) => item.confidence === "high").length,
      mediumConfidence: items.filter((item) => item.confidence === "medium").length,
      lowConfidence: items.filter((item) => item.confidence === "low").length,
      noCandidate: items.filter((item) => item.confidence === "none").length,
    },
    items,
    notes: [
      "Local read-only evidence review only.",
      "Exact Yandex SERP matched URLs are treated as high-confidence candidates.",
      "Exact homepage snapshot text matches are treated as medium or low confidence hints.",
      "No query lemmatization, URL inference, production writes or task creation are performed.",
    ],
  };
}
