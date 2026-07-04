import type { SeoConfidence, SeoEffort, SeoImpact, SeoOpportunity, SeoPriority, SeoUrgency } from "./types";
import type { SeoSearchPerformanceRecord, SeoSearchPerformanceSource } from "./searchPerformanceNormalizer";

export type SearchPerformanceOpportunityThresholds = {
  minEvidenceImpressions: number;
  highImpactImpressions: number;
  rankingWindowMin: number;
  rankingWindowMax: number;
  lowCtrMax: number;
  lowCtrPositionMin: number;
  lowCtrPositionMax: number;
};

export type SearchPerformanceOpportunityEngineConfig = {
  thresholds: SearchPerformanceOpportunityThresholds;
  maxOpportunities: number;
  market?: string | null;
  language?: string | null;
  defaultEffort: SeoEffort;
  defaultConfidence: SeoConfidence;
};

type OpportunityCandidate = {
  opportunity: SeoOpportunity;
  impressions: number;
  source: SeoSearchPerformanceSource;
  query: string;
};

export const DEFAULT_SEARCH_PERFORMANCE_OPPORTUNITY_CONFIG: SearchPerformanceOpportunityEngineConfig = {
  thresholds: {
    minEvidenceImpressions: 100,
    highImpactImpressions: 300,
    rankingWindowMin: 8,
    rankingWindowMax: 20,
    lowCtrMax: 2,
    lowCtrPositionMin: 1,
    lowCtrPositionMax: 5,
  },
  maxOpportunities: 10,
  market: null,
  language: null,
  defaultEffort: "medium",
  defaultConfidence: "medium",
};

export function buildSearchPerformanceOpportunityConfig(
  overrides: Partial<SearchPerformanceOpportunityEngineConfig> & {
    thresholds?: Partial<SearchPerformanceOpportunityThresholds>;
  } = {}
): SearchPerformanceOpportunityEngineConfig {
  return {
    ...DEFAULT_SEARCH_PERFORMANCE_OPPORTUNITY_CONFIG,
    ...overrides,
    thresholds: {
      ...DEFAULT_SEARCH_PERFORMANCE_OPPORTUNITY_CONFIG.thresholds,
      ...(overrides.thresholds || {}),
    },
  };
}

function cleanQuery(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sourceLabel(source: SeoSearchPerformanceSource): string {
  return source === "gsc" ? "GSC" : "Yandex Webmaster";
}

function priorityForImpressions(
  impressions: number,
  config: SearchPerformanceOpportunityEngineConfig
): SeoPriority {
  return impressions >= config.thresholds.highImpactImpressions ? "high" : "medium";
}

function impactForImpressions(
  impressions: number,
  config: SearchPerformanceOpportunityEngineConfig
): SeoImpact {
  return impressions >= config.thresholds.highImpactImpressions ? "high" : "medium";
}

function urgencyForPriority(priority: SeoPriority): SeoUrgency {
  return priority === "high" ? "high" : "medium";
}

function sourceRankMessage(record: SeoSearchPerformanceRecord): string {
  return record.sourceRank === null ? "" : ` Source rank: ${record.sourceRank}.`;
}

function evidenceMessage(input: {
  record: SeoSearchPerformanceRecord;
  query: string;
  rule: "ranking_window" | "low_ctr";
}): string {
  const label = sourceLabel(input.record.source);
  if (input.rule === "ranking_window") {
    return `${label} query "${input.query}" has ${input.record.impressions} impressions and average position ${input.record.averagePosition}.${sourceRankMessage(input.record)}`;
  }
  return `${label} query "${input.query}" has ${input.record.impressions} impressions, CTR ${input.record.ctr}, and average position ${input.record.averagePosition}.${sourceRankMessage(input.record)}`;
}

function commonOpportunityFields(input: {
  record: SeoSearchPerformanceRecord;
  config: SearchPerformanceOpportunityEngineConfig;
  query: string;
  priority: SeoPriority;
  impact: SeoImpact;
  urgency: SeoUrgency;
  reasoning: string;
  recommendedAction: string;
}): Pick<
  SeoOpportunity,
  "targetKeywords" | "market" | "language" | "impact" | "effort" | "urgency" | "priority" | "confidence" | "source" | "recommendedAction" | "reasoning" | "evidence"
> {
  return {
    targetKeywords: [input.query],
    market: input.config.market ?? null,
    language: input.config.language ?? null,
    impact: input.impact,
    effort: input.config.defaultEffort,
    urgency: input.urgency,
    priority: input.priority,
    confidence: input.config.defaultConfidence,
    source: "provider",
    recommendedAction: input.recommendedAction,
    reasoning: input.reasoning,
    evidence: [
      {
        source: input.record.source,
        metric: "search_performance",
        value: input.record.impressions,
        query: input.query,
        url: input.record.page,
        message: input.reasoning,
      },
    ],
  };
}

function rankingWindowOpportunity(input: {
  record: SeoSearchPerformanceRecord;
  config: SearchPerformanceOpportunityEngineConfig;
  query: string;
}): OpportunityCandidate | null {
  const { record, config, query } = input;
  if (record.impressions === null || record.averagePosition === null) return null;
  if (record.impressions < config.thresholds.minEvidenceImpressions) return null;
  if (record.averagePosition < config.thresholds.rankingWindowMin || record.averagePosition > config.thresholds.rankingWindowMax) return null;

  const priority = priorityForImpressions(record.impressions, config);
  const impact = impactForImpressions(record.impressions, config);
  const urgency = urgencyForPriority(priority);
  const label = sourceLabel(record.source);
  const recommendedAction = `Improve the page/query match for "${query}" and add internal links from relevant pages.`;
  const reasoning = evidenceMessage({ record, query, rule: "ranking_window" });

  return {
    impressions: record.impressions,
    source: record.source,
    query,
    opportunity: {
      type: "keyword",
      opportunityType: "keyword_quick_win",
      intent: "unknown",
      title: `Improve ${label} rankings for "${query}"`,
      description: `${recommendedAction} ${reasoning}`.trim(),
      targetUrl: record.page,
      ...commonOpportunityFields({
        record,
        config,
        query,
        priority,
        impact,
        urgency,
        reasoning,
        recommendedAction,
      }),
    },
  };
}

function lowCtrOpportunity(input: {
  record: SeoSearchPerformanceRecord;
  config: SearchPerformanceOpportunityEngineConfig;
  query: string;
}): OpportunityCandidate | null {
  const { record, config, query } = input;
  if (record.impressions === null || record.ctr === null || record.averagePosition === null) return null;
  if (record.impressions < config.thresholds.minEvidenceImpressions) return null;
  if (record.ctr >= config.thresholds.lowCtrMax) return null;
  if (record.averagePosition < config.thresholds.lowCtrPositionMin || record.averagePosition > config.thresholds.lowCtrPositionMax) return null;

  const priority = priorityForImpressions(record.impressions, config);
  const impact = impactForImpressions(record.impressions, config);
  const urgency = urgencyForPriority(priority);
  const label = sourceLabel(record.source);
  const recommendedAction = `Improve title, description, and snippet intent alignment for "${query}".`;
  const reasoning = evidenceMessage({ record, query, rule: "low_ctr" });

  return {
    impressions: record.impressions,
    source: record.source,
    query,
    opportunity: {
      type: "content",
      opportunityType: "content_optimization",
      intent: "unknown",
      title: `Improve ${label} CTR for "${query}"`,
      description: `${recommendedAction} ${reasoning}`.trim(),
      targetUrl: record.page,
      ...commonOpportunityFields({
        record,
        config,
        query,
        priority,
        impact,
        urgency,
        reasoning,
        recommendedAction,
      }),
    },
  };
}

function isQueryRecord(record: SeoSearchPerformanceRecord): boolean {
  return record.dimension === "query" && Boolean(cleanQuery(record.query));
}

function priorityWeight(priority: SeoPriority): number {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function dedupeCandidates(candidates: OpportunityCandidate[]): OpportunityCandidate[] {
  const byKey = new Map<string, OpportunityCandidate>();
  for (const candidate of candidates) {
    const key = [
      candidate.opportunity.opportunityType || "",
      candidate.source,
      candidate.query.toLowerCase(),
    ].join("|");
    const existing = byKey.get(key);
    if (!existing || candidate.impressions > existing.impressions) {
      byKey.set(key, candidate);
    }
  }
  return Array.from(byKey.values());
}

export function generateSearchPerformanceOpportunities(
  records: SeoSearchPerformanceRecord[],
  configInput: Partial<SearchPerformanceOpportunityEngineConfig> & {
    thresholds?: Partial<SearchPerformanceOpportunityThresholds>;
  } = {}
): SeoOpportunity[] {
  const config = buildSearchPerformanceOpportunityConfig(configInput);
  const candidates = dedupeCandidates(
    records
      .filter(isQueryRecord)
      .flatMap((record) => {
        const query = cleanQuery(record.query);
        return [
          rankingWindowOpportunity({ record, config, query }),
          lowCtrOpportunity({ record, config, query }),
        ].filter(Boolean) as OpportunityCandidate[];
      })
  );

  return candidates
    .sort((a, b) => {
      const priorityDiff = priorityWeight(b.opportunity.priority) - priorityWeight(a.opportunity.priority);
      if (priorityDiff) return priorityDiff;
      const impressionsDiff = b.impressions - a.impressions;
      if (impressionsDiff) return impressionsDiff;
      const sourceDiff = a.source.localeCompare(b.source);
      if (sourceDiff) return sourceDiff;
      return a.query.localeCompare(b.query);
    })
    .slice(0, config.maxOpportunities)
    .map((candidate) => candidate.opportunity);
}
