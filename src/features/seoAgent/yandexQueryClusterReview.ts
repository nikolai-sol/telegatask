import type { SeoSearchPerformanceRecord } from "./searchPerformanceNormalizer";
import { generateSearchPerformanceOpportunities } from "./searchPerformanceOpportunityEngine";
import type { SeoOpportunity } from "./types";
import {
  classifySemanticIntent,
  SEMANTIC_INTENT_CLASS_PRIORITY,
  type SeoSemanticIntentClass,
  type SeoSemanticIntentClassifierConfig,
} from "./semanticIntentClassifier";
import { evaluateYandexSerpUrlEvidenceQualityGate } from "./yandexSerpUrlEvidenceQualityGate";
import type {
  YandexSerpQueryUrlEvidenceMetadata,
  YandexSerpQueryUrlEvidenceRecord,
} from "./yandexSerpQueryUrlEvidenceMapper";

export type YandexQueryClusterConfig = {
  jaccardThreshold: number;
  sharedHeadTokenCount: number;
  ignoredTokens: readonly string[];
  normalization: {
    lowercase: boolean;
    replaceYo: boolean;
    stripPunctuation: boolean;
    collapseWhitespace: boolean;
  };
};

export type YandexQueryClusterMember = {
  query: string;
  normalizedQuery: string;
  tokens: string[];
  sourceRank: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  averagePosition: number | null;
  intentClass: SeoSemanticIntentClass;
  matchedUrl: string | null;
  serpPosition: number | null;
};

export type YandexQueryClusterUrlEvidence = {
  matchedUrl: string;
  sourceQuery: string;
  sourceRank: number | null;
  serpPosition: number | null;
};

export type YandexQueryCluster = {
  clusterId: string;
  primaryQuery: string;
  intentClass: SeoSemanticIntentClass;
  mixedIntentClasses: SeoSemanticIntentClass[];
  mixedIntentFlag: boolean;
  memberQueries: string[];
  members: YandexQueryClusterMember[];
  urlEvidence: YandexQueryClusterUrlEvidence | null;
  aggregate: {
    impressions: number | null;
    clicks: number | null;
    ctr: number | null;
    averagePosition: number | null;
    sourceRank: number | null;
  };
};

export type YandexQueryClusterReview = {
  schemaVersion: "seo_os_yandex_query_cluster_review_v1";
  source: "local_review";
  searchEngine: "yandex";
  config: YandexQueryClusterConfig;
  summary: {
    inputRecords: number;
    clusters: number;
    clusteredRecords: number;
    clustersWithUrl: number;
    mixedClassClusters: number;
    opportunities: number;
    opportunitiesWithTargetUrl: number;
  };
  clusters: YandexQueryCluster[];
  clusterRecords: YandexSerpQueryUrlEvidenceRecord[];
  opportunities: SeoOpportunity[];
  qualityGate: ReturnType<typeof evaluateYandexSerpUrlEvidenceQualityGate>;
  notes: string[];
};

export type YandexQueryClusterReviewInput = {
  records: YandexSerpQueryUrlEvidenceRecord[];
  classifierConfig: SeoSemanticIntentClassifierConfig;
  clusterConfig: YandexQueryClusterConfig;
  targetDomain: string;
  targetDomainAliases?: string[];
  market?: string | null;
  language?: string | null;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeQuery(value: unknown, config: YandexQueryClusterConfig): string {
  let output = cleanString(value);
  if (config.normalization.lowercase) output = output.toLowerCase();
  if (config.normalization.replaceYo) output = output.replace(/ё/g, "е");
  if (config.normalization.stripPunctuation) output = output.replace(/[^\p{L}\p{N}]+/gu, " ");
  if (config.normalization.collapseWhitespace) output = output.replace(/\s+/g, " ").trim();
  return output;
}

function tokensForQuery(value: unknown, config: YandexQueryClusterConfig): string[] {
  const ignored = new Set(config.ignoredTokens.map((token) => normalizeQuery(token, config)).filter(Boolean));
  return normalizeQuery(value, config)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token && !ignored.has(token));
}

function jaccard(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  const intersection = Array.from(left).filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function sharedHead(a: string[], b: string[], count: number): boolean {
  if (count <= 0 || a.length < count || b.length < count) return false;
  return a.slice(0, count).join(" ") === b.slice(0, count).join(" ");
}

function shouldCluster(input: {
  candidate: YandexQueryClusterMember;
  existing: YandexQueryClusterMember;
  config: YandexQueryClusterConfig;
}): boolean {
  return (
    jaccard(input.candidate.tokens, input.existing.tokens) >= input.config.jaccardThreshold ||
    sharedHead(input.candidate.tokens, input.existing.tokens, input.config.sharedHeadTokenCount)
  );
}

function resolveIntent(classes: SeoSemanticIntentClass[]): {
  intentClass: SeoSemanticIntentClass;
  mixedIntentClasses: SeoSemanticIntentClass[];
  mixedIntentFlag: boolean;
} {
  const uniqueClasses = Array.from(new Set(classes));
  return {
    intentClass:
      SEMANTIC_INTENT_CLASS_PRIORITY.find((intentClass) => uniqueClasses.includes(intentClass)) || "off_mission",
    mixedIntentClasses: uniqueClasses,
    mixedIntentFlag: uniqueClasses.length > 1,
  };
}

function sumNumbers(values: Array<number | null>): number | null {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : null;
}

function aggregateAveragePosition(members: YandexQueryClusterMember[]): number | null {
  const weighted = members.filter(
    (member) => typeof member.averagePosition === "number" && typeof member.impressions === "number" && member.impressions > 0
  );
  if (weighted.length > 0) {
    const impressions = weighted.reduce((sum, member) => sum + (member.impressions || 0), 0);
    const weightedSum = weighted.reduce(
      (sum, member) => sum + (member.averagePosition || 0) * (member.impressions || 0),
      0
    );
    return Number((weightedSum / impressions).toFixed(6));
  }
  const positions = members
    .map((member) => member.averagePosition)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (positions.length === 0) return null;
  return Number((positions.reduce((sum, value) => sum + value, 0) / positions.length).toFixed(6));
}

function urlEvidence(members: YandexQueryClusterMember[]): YandexQueryClusterUrlEvidence | null {
  const membersWithUrl = members.filter((member) => member.matchedUrl);
  if (membersWithUrl.length === 0) return null;
  const best = [...membersWithUrl].sort((a, b) => {
    const impressionDiff = (b.impressions || 0) - (a.impressions || 0);
    if (impressionDiff) return impressionDiff;
    return (a.sourceRank || Number.MAX_SAFE_INTEGER) - (b.sourceRank || Number.MAX_SAFE_INTEGER);
  })[0];
  return {
    matchedUrl: best.matchedUrl || "",
    sourceQuery: best.query,
    sourceRank: best.sourceRank,
    serpPosition: best.serpPosition,
  };
}

function toMember(input: {
  record: YandexSerpQueryUrlEvidenceRecord;
  classifierConfig: SeoSemanticIntentClassifierConfig;
  clusterConfig: YandexQueryClusterConfig;
}): YandexQueryClusterMember {
  const classification = classifySemanticIntent(input.record.query, input.classifierConfig);
  return {
    query: cleanString(input.record.query),
    normalizedQuery: normalizeQuery(input.record.query, input.clusterConfig),
    tokens: tokensForQuery(input.record.query, input.clusterConfig),
    sourceRank: input.record.sourceRank,
    impressions: input.record.impressions,
    clicks: input.record.clicks,
    ctr: input.record.ctr,
    averagePosition: input.record.averagePosition,
    intentClass: classification.intentClass,
    matchedUrl: cleanString(input.record.serpUrlEvidence?.matchedUrl) || null,
    serpPosition:
      typeof input.record.serpUrlEvidence?.serpPosition === "number"
        ? input.record.serpUrlEvidence.serpPosition
        : null,
  };
}

function aggregateCluster(input: {
  clusterId: string;
  members: YandexQueryClusterMember[];
}): YandexQueryCluster {
  const clicks = sumNumbers(input.members.map((member) => member.clicks));
  const impressions = sumNumbers(input.members.map((member) => member.impressions));
  const ctr = clicks !== null && impressions !== null && impressions > 0
    ? Number(((clicks / impressions) * 100).toFixed(6))
    : null;
  const resolved = resolveIntent(input.members.map((member) => member.intentClass));
  const evidence = urlEvidence(input.members);
  return {
    clusterId: input.clusterId,
    primaryQuery: input.members[0]?.query || input.clusterId,
    ...resolved,
    memberQueries: input.members.map((member) => member.query),
    members: input.members,
    urlEvidence: evidence,
    aggregate: {
      impressions,
      clicks,
      ctr,
      averagePosition: aggregateAveragePosition(input.members),
      sourceRank: Math.min(...input.members.map((member) => member.sourceRank || Number.MAX_SAFE_INTEGER)),
    },
  };
}

export function buildYandexQueryClusters(input: {
  records: YandexSerpQueryUrlEvidenceRecord[];
  classifierConfig: SeoSemanticIntentClassifierConfig;
  clusterConfig: YandexQueryClusterConfig;
}): YandexQueryCluster[] {
  const grouped: YandexQueryClusterMember[][] = [];
  for (const record of input.records) {
    const query = cleanString(record.query);
    if (!query) continue;
    const member = toMember({
      record,
      classifierConfig: input.classifierConfig,
      clusterConfig: input.clusterConfig,
    });
    const matchingCluster = grouped.find((cluster) =>
      cluster.some((existing) => shouldCluster({ candidate: member, existing, config: input.clusterConfig }))
    );
    if (matchingCluster) {
      matchingCluster.push(member);
    } else {
      grouped.push([member]);
    }
  }
  return grouped.map((members, index) =>
    aggregateCluster({
      clusterId: `query_cluster_${String(index + 1).padStart(3, "0")}`,
      members,
    })
  );
}

function clusterRecord(cluster: YandexQueryCluster, template: SeoSearchPerformanceRecord): YandexSerpQueryUrlEvidenceRecord {
  const evidence: YandexSerpQueryUrlEvidenceMetadata | undefined = cluster.urlEvidence
    ? {
        source: "yandex_serp_rank",
        provider: "yandex_search_api",
        matchedUrl: cluster.urlEvidence.matchedUrl,
        serpPosition: cluster.urlEvidence.serpPosition,
        checkedAt: null,
        note: `Cluster-level URL evidence propagated from query "${cluster.urlEvidence.sourceQuery}". SERP position is not merged with Webmaster averagePosition.`,
      }
    : undefined;
  return {
    ...template,
    dimension: "query",
    key: cluster.primaryQuery,
    query: cluster.primaryQuery,
    page: cluster.urlEvidence?.matchedUrl || null,
    sourceRank: cluster.aggregate.sourceRank,
    impressions: cluster.aggregate.impressions,
    clicks: cluster.aggregate.clicks,
    ctr: cluster.aggregate.ctr,
    averagePosition: cluster.aggregate.averagePosition,
    ...(evidence ? { serpUrlEvidence: evidence } : {}),
  };
}

export function buildYandexQueryClusterReview(input: YandexQueryClusterReviewInput): YandexQueryClusterReview {
  const clusters = buildYandexQueryClusters({
    records: input.records,
    classifierConfig: input.classifierConfig,
    clusterConfig: input.clusterConfig,
  });
  const template = input.records[0];
  const clusterRecords = template ? clusters.map((cluster) => clusterRecord(cluster, template)) : [];
  const opportunities = generateSearchPerformanceOpportunities(clusterRecords, {
    market: input.market,
    language: input.language,
  });
  const qualityGate = evaluateYandexSerpUrlEvidenceQualityGate({
    records: clusterRecords,
    opportunities,
    targetDomain: input.targetDomain,
    targetDomainAliases: input.targetDomainAliases,
  });
  return {
    schemaVersion: "seo_os_yandex_query_cluster_review_v1",
    source: "local_review",
    searchEngine: "yandex",
    config: input.clusterConfig,
    summary: {
      inputRecords: input.records.length,
      clusters: clusters.length,
      clusteredRecords: clusterRecords.length,
      clustersWithUrl: clusters.filter((cluster) => Boolean(cluster.urlEvidence)).length,
      mixedClassClusters: clusters.filter((cluster) => cluster.mixedIntentFlag).length,
      opportunities: opportunities.length,
      opportunitiesWithTargetUrl: opportunities.filter((opportunity) => Boolean(opportunity.targetUrl)).length,
    },
    clusters,
    clusterRecords,
    opportunities,
    qualityGate,
    notes: [
      "Local deterministic QueryCluster v1 review only.",
      "Clustering uses config-driven normalization, token-set Jaccard threshold and shared head term.",
      "URL evidence is propagated only when a cluster member has deterministic SERP matched URL evidence.",
      "Cluster average position is an impressions-weighted aggregate; member positions remain listed in the artifact.",
      "No lemmatization, transliteration, LLM, threshold changes, production writes or task creation are performed.",
    ],
  };
}
