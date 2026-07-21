import type { SeoSearchPerformanceRecord } from "./searchPerformanceNormalizer";
import { generateSearchPerformanceOpportunities } from "./searchPerformanceOpportunityEngine";
import type { SeoOpportunity } from "./types";
import {
  classifySemanticIntent,
  SEMANTIC_INTENT_CLASS_PRIORITY,
  type SeoSemanticIntentClassification,
  type SeoSemanticIntentClass,
  type SeoSemanticIntentClassifierConfig,
} from "./semanticIntentClassifier";

export type YandexIntentFilteredRecord = {
  record: SeoSearchPerformanceRecord;
  classification: SeoSemanticIntentClassification;
};

export type YandexIntentFilteredBucketItem = {
  query: string;
  sourceRank: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  averagePosition: number | null;
  matchedTokens: string[];
};

export type YandexIntentFilteredOpportunityReview = {
  schemaVersion: "seo_os_yandex_intent_filtered_opportunity_review_v1";
  source: "local_review";
  searchEngine: "yandex";
  summary: {
    inputRecords: number;
    queryRecords: number;
    targetQueryRecords: number;
    excludedQueryRecords: number;
    opportunitiesBeforeFilter: number;
    opportunitiesAfterFilter: number;
  };
  classCounts: Record<SeoSemanticIntentClass, number>;
  targetIntentClasses: SeoSemanticIntentClass[];
  classifications: Array<{
    query: string;
    sourceRank: number | null;
    impressions: number | null;
    intentClass: SeoSemanticIntentClass;
    isTarget: boolean;
    rule: string;
  }>;
  monitoringBuckets: {
    competitor_brand: YandexIntentFilteredBucketItem[];
    drug_compliance: YandexIntentFilteredBucketItem[];
    own_brand: YandexIntentFilteredBucketItem[];
    off_mission: YandexIntentFilteredBucketItem[];
  };
  serpKeywordExpansion: {
    topN: number;
    topQueryKeywords: string[];
    excludedCandidateCount: number;
    requestCount: number;
  };
  opportunitiesBeforeFilter: SeoOpportunity[];
  opportunities: SeoOpportunity[];
  notes: string[];
};

export type YandexIntentFilteredOpportunityReviewInput = {
  records: SeoSearchPerformanceRecord[];
  classifierConfig: SeoSemanticIntentClassifierConfig;
  topN: number;
  market?: string | null;
  language?: string | null;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isYandexQueryRecord(record: SeoSearchPerformanceRecord): boolean {
  return record.source === "yandex_webmaster" && record.dimension === "query" && Boolean(cleanString(record.query));
}

function emptyClassCounts(): Record<SeoSemanticIntentClass, number> {
  return {
    drug_compliance: 0,
    competitor_brand: 0,
    own_brand: 0,
    facility_navigational: 0,
    medical_informational: 0,
    supportive_trust: 0,
    off_mission: 0,
  };
}

function uniqueClean(values: unknown[]): string[] {
  return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function bucketItem(item: YandexIntentFilteredRecord): YandexIntentFilteredBucketItem {
  return {
    query: cleanString(item.record.query),
    sourceRank: item.record.sourceRank,
    impressions: item.record.impressions,
    clicks: item.record.clicks,
    ctr: item.record.ctr,
    averagePosition: item.record.averagePosition,
    matchedTokens: [
      ...item.classification.matchedTokens.competitorBrandTokens,
      ...item.classification.matchedTokens.drugComplianceTokens,
      ...item.classification.matchedTokens.ownBrandTokens,
    ],
  };
}

export function classifyYandexSearchPerformanceRecords(input: {
  records: SeoSearchPerformanceRecord[];
  classifierConfig: SeoSemanticIntentClassifierConfig;
}): YandexIntentFilteredRecord[] {
  return input.records
    .filter(isYandexQueryRecord)
    .map((record) => ({
      record,
      classification: classifySemanticIntent(record.query, input.classifierConfig),
    }));
}

export function selectTargetSerpTopQueryKeywords(input: {
  classifiedRecords: YandexIntentFilteredRecord[];
  topN: number;
}): string[] {
  return uniqueClean(
    input.classifiedRecords
      .filter((item) => item.classification.isTarget)
      .slice(0, input.topN)
      .map((item) => item.record.query)
  );
}

export function buildYandexIntentFilteredOpportunityReview(
  input: YandexIntentFilteredOpportunityReviewInput
): YandexIntentFilteredOpportunityReview {
  const classifiedRecords = classifyYandexSearchPerformanceRecords({
    records: input.records,
    classifierConfig: input.classifierConfig,
  });
  const classCounts = emptyClassCounts();
  for (const item of classifiedRecords) {
    classCounts[item.classification.intentClass] += 1;
  }

  const targetRecords = classifiedRecords
    .filter((item) => item.classification.isTarget)
    .map((item) => item.record);
  const opportunitiesBeforeFilter = generateSearchPerformanceOpportunities(input.records, {
    market: input.market,
    language: input.language,
  });
  const opportunities = generateSearchPerformanceOpportunities(targetRecords, {
    market: input.market,
    language: input.language,
  });
  const topQueryKeywords = selectTargetSerpTopQueryKeywords({
    classifiedRecords,
    topN: input.topN,
  });
  const excludedCandidateCount = classifiedRecords
    .slice(0, input.topN)
    .filter((item) => !item.classification.isTarget).length;

  return {
    schemaVersion: "seo_os_yandex_intent_filtered_opportunity_review_v1",
    source: "local_review",
    searchEngine: "yandex",
    summary: {
      inputRecords: input.records.length,
      queryRecords: classifiedRecords.length,
      targetQueryRecords: targetRecords.length,
      excludedQueryRecords: classifiedRecords.length - targetRecords.length,
      opportunitiesBeforeFilter: opportunitiesBeforeFilter.length,
      opportunitiesAfterFilter: opportunities.length,
    },
    classCounts,
    targetIntentClasses: [...input.classifierConfig.targetIntentClasses],
    classifications: classifiedRecords.map((item) => ({
      query: cleanString(item.record.query),
      sourceRank: item.record.sourceRank,
      impressions: item.record.impressions,
      intentClass: item.classification.intentClass,
      isTarget: item.classification.isTarget,
      rule: item.classification.rule,
    })),
    monitoringBuckets: {
      competitor_brand: classifiedRecords
        .filter((item) => item.classification.intentClass === "competitor_brand")
        .map(bucketItem),
      drug_compliance: classifiedRecords
        .filter((item) => item.classification.intentClass === "drug_compliance")
        .map(bucketItem),
      own_brand: classifiedRecords
        .filter((item) => item.classification.intentClass === "own_brand")
        .map(bucketItem),
      off_mission: classifiedRecords
        .filter((item) => item.classification.intentClass === "off_mission")
        .map(bucketItem),
    },
    serpKeywordExpansion: {
      topN: input.topN,
      topQueryKeywords,
      excludedCandidateCount,
      requestCount: topQueryKeywords.length,
    },
    opportunitiesBeforeFilter,
    opportunities,
    notes: [
      "Local read-only intent-filtered opportunity review only.",
      `Classification conflict priority: ${SEMANTIC_INTENT_CLASS_PRIORITY.join(" > ")}.`,
      "Target classes only are passed to Opportunity Engine and SERP top-N expansion.",
      "Competitor, drug compliance, own brand and off-mission queries are kept in monitoring buckets and do not produce opportunities.",
      "No LLM classification, lemmatization, threshold changes, production writes or task creation are performed.",
    ],
  };
}
