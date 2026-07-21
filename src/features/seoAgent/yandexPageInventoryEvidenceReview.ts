import type { SeoSearchPerformanceRecord } from "./searchPerformanceNormalizer";

export type YandexPageInventoryEvidenceConfidence = "medium" | "none";

export type YandexPageInventoryEvidenceItem = {
  source: "page_inventory";
  strength: "medium";
  query: string;
  url: string;
  message: string;
};

export type YandexPageInventoryEvidenceReviewItem = {
  query: string;
  sourceRank: number | null;
  impressions: number | null;
  averagePosition: number | null;
  candidateUrl: string | null;
  confidence: YandexPageInventoryEvidenceConfidence;
  evidence: YandexPageInventoryEvidenceItem[];
  missingEvidence: string[];
};

export type YandexPageInventoryEvidenceReview = {
  schemaVersion: "seo_os_yandex_page_inventory_evidence_review_v1";
  source: "local_review";
  searchEngine: "yandex";
  inventory: {
    urlCount: number;
    uniqueUrlCount: number;
  };
  summary: {
    reviewedQueries: number;
    withCandidateUrl: number;
    mediumConfidence: number;
    noCandidate: number;
  };
  items: YandexPageInventoryEvidenceReviewItem[];
  notes: string[];
};

export type YandexPageInventoryEvidenceReviewInput = {
  records: SeoSearchPerformanceRecord[];
  inventoryUrls: string[];
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizedPhrase(value: unknown): string {
  return decoded(cleanString(value))
    .toLowerCase()
    .replace(/https?:\/\//g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isYandexQueryRecord(record: SeoSearchPerformanceRecord): boolean {
  return record.source === "yandex_webmaster" && record.dimension === "query" && Boolean(cleanString(record.query));
}

function uniqueUrls(urls: string[]): string[] {
  return Array.from(new Set(urls.map(cleanString).filter(Boolean)));
}

function inventoryMatch(input: {
  query: string;
  urls: string[];
}): string | null {
  const query = normalizedPhrase(input.query);
  if (!query) return null;
  return input.urls.find((url) => normalizedPhrase(url).includes(query)) || null;
}

function reviewRecord(input: {
  record: SeoSearchPerformanceRecord;
  inventoryUrls: string[];
}): YandexPageInventoryEvidenceReviewItem {
  const query = cleanString(input.record.query);
  const candidateUrl = inventoryMatch({ query, urls: input.inventoryUrls });
  if (candidateUrl) {
    return {
      query,
      sourceRank: input.record.sourceRank,
      impressions: input.record.impressions,
      averagePosition: input.record.averagePosition,
      candidateUrl,
      confidence: "medium",
      evidence: [
        {
          source: "page_inventory",
          strength: "medium",
          query,
          url: candidateUrl,
          message: `Page inventory URL contains exact normalized query text for "${query}".`,
        },
      ],
      missingEvidence: [],
    };
  }

  return {
    query,
    sourceRank: input.record.sourceRank,
    impressions: input.record.impressions,
    averagePosition: input.record.averagePosition,
    candidateUrl: null,
    confidence: "none",
    evidence: [],
    missingEvidence: ["No exact page inventory URL match for this query."],
  };
}

export function reviewYandexPageInventoryEvidence(
  input: YandexPageInventoryEvidenceReviewInput
): YandexPageInventoryEvidenceReview {
  const inventoryUrls = uniqueUrls(input.inventoryUrls);
  const items = input.records
    .filter(isYandexQueryRecord)
    .map((record) => reviewRecord({ record, inventoryUrls }));

  return {
    schemaVersion: "seo_os_yandex_page_inventory_evidence_review_v1",
    source: "local_review",
    searchEngine: "yandex",
    inventory: {
      urlCount: input.inventoryUrls.length,
      uniqueUrlCount: inventoryUrls.length,
    },
    summary: {
      reviewedQueries: items.length,
      withCandidateUrl: items.filter((item) => Boolean(item.candidateUrl)).length,
      mediumConfidence: items.filter((item) => item.confidence === "medium").length,
      noCandidate: items.filter((item) => item.confidence === "none").length,
    },
    items,
    notes: [
      "Local read-only page inventory evidence review only.",
      "Candidate URLs require exact normalized query text inside a decoded inventory URL.",
      "No lemmatization, transliteration, fuzzy matching, section inference, production writes or task creation are performed.",
    ],
  };
}
