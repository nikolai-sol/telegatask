import type { SeoSearchPerformanceRecord } from "./searchPerformanceNormalizer";
import type { YandexRankCheck } from "./types";

export type YandexSerpQueryUrlEvidenceMetadata = {
  source: "yandex_serp_rank";
  provider: "yandex_search_api";
  matchedUrl: string;
  serpPosition: number | null;
  checkedAt: string | null;
  note: string;
};

export type YandexSerpQueryUrlEvidenceRecord = SeoSearchPerformanceRecord & {
  serpUrlEvidence?: YandexSerpQueryUrlEvidenceMetadata;
};

export type YandexSerpQueryUrlEvidenceReview = {
  schemaVersion: "seo_os_yandex_serp_query_url_evidence_v1";
  source: "local_review";
  searchEngine: "yandex";
  summary: {
    inputRecords: number;
    eligibleQueryRecords: number;
    rankChecks: number;
    matchedUrlRecords: number;
    missingUrlRecords: number;
  };
  records: YandexSerpQueryUrlEvidenceRecord[];
  notes: string[];
};

export type YandexSerpQueryUrlEvidenceInput = {
  records: SeoSearchPerformanceRecord[];
  rankChecks: YandexRankCheck[];
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalized(value: unknown): string {
  return cleanString(value).toLowerCase();
}

function isEligibleYandexQueryRecord(record: SeoSearchPerformanceRecord): boolean {
  return record.source === "yandex_webmaster" && record.dimension === "query" && Boolean(cleanString(record.query));
}

function rankCheckByQuery(rankChecks: YandexRankCheck[]): Map<string, YandexRankCheck> {
  const byQuery = new Map<string, YandexRankCheck>();
  for (const check of rankChecks) {
    const query = normalized(check.query);
    if (query && !byQuery.has(query)) byQuery.set(query, check);
  }
  return byQuery;
}

function applyEvidenceToRecord(input: {
  record: SeoSearchPerformanceRecord;
  rankCheck?: YandexRankCheck;
}): YandexSerpQueryUrlEvidenceRecord {
  const matchedUrl = cleanString(input.rankCheck?.matchedUrl);
  if (!input.rankCheck?.found || !matchedUrl) return { ...input.record };

  return {
    ...input.record,
    page: matchedUrl,
    serpUrlEvidence: {
      source: "yandex_serp_rank",
      provider: "yandex_search_api",
      matchedUrl,
      serpPosition: typeof input.rankCheck.position === "number" ? input.rankCheck.position : null,
      checkedAt: cleanString(input.rankCheck.checkedAt) || null,
      note: "SERP position is stored as evidence and is not merged with Yandex Webmaster averagePosition.",
    },
  };
}

export function applyYandexSerpQueryUrlEvidence(
  input: YandexSerpQueryUrlEvidenceInput
): YandexSerpQueryUrlEvidenceReview {
  const checksByQuery = rankCheckByQuery(input.rankChecks);
  const records = input.records.map((record) => {
    if (!isEligibleYandexQueryRecord(record)) return { ...record };
    return applyEvidenceToRecord({
      record,
      rankCheck: checksByQuery.get(normalized(record.query)),
    });
  });
  const eligibleQueryRecords = input.records.filter(isEligibleYandexQueryRecord).length;
  const matchedUrlRecords = records.filter((record) => Boolean(record.serpUrlEvidence?.matchedUrl)).length;

  return {
    schemaVersion: "seo_os_yandex_serp_query_url_evidence_v1",
    source: "local_review",
    searchEngine: "yandex",
    summary: {
      inputRecords: input.records.length,
      eligibleQueryRecords,
      rankChecks: input.rankChecks.length,
      matchedUrlRecords,
      missingUrlRecords: Math.max(0, eligibleQueryRecords - matchedUrlRecords),
    },
    records,
    notes: [
      "Local read-only SERP query-to-URL evidence mapping only.",
      "Matched URLs from yandex_serp_rank populate record.page for matching Yandex Webmaster query records.",
      "SERP position is kept in serpUrlEvidence and is not merged with Yandex Webmaster averagePosition.",
      "No URL heuristics, lemmatization, production writes or task creation are performed.",
    ],
  };
}
