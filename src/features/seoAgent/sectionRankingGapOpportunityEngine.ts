import type { SeoConfidence, SeoOpportunity, SeoPriority } from "./types";
import type { SeoRankHistoryRecord } from "./sectionRankTracking";
import type { WeeklyTop10ApprovalDecisionRecord } from "./weeklyTop10ApprovalDecision";
import {
  resolvePageInventoryCoverage,
  type SeoPageInventoryItem,
} from "./pageInventoryCoverageResolver";

export type SectionRankingGapConfig = {
  sectionRankingGapMaxPosition: number;
  rankSmoothingRuns: number;
  decisionCooldownDays: number;
  sectionPriorities: Record<string, number>;
  targetUrlBindingMinSharedTokens: number;
  inventoryCoverageMinCoveredTitleTokens: number;
  inventoryCoverageMinPartialTitleTokens: number;
};

export type SectionRankingGapReview = {
  schemaVersion: "seo_os_section_ranking_gap_review_v1";
  generatedAt: string;
  domain: string;
  config: {
    sectionRankingGapMaxPosition: number;
    rankSmoothingRuns: number;
    decisionCooldownDays: number;
  };
  opportunities: SeoOpportunity[];
  summary: {
    totalClusters: number;
    generated: number;
    cooldownSkipped: number;
    bySection: Record<string, number>;
  };
  notes: string[];
};

export const DEFAULT_SECTION_RANKING_GAP_CONFIG: SectionRankingGapConfig = {
  sectionRankingGapMaxPosition: 20,
  rankSmoothingRuns: 2,
  decisionCooldownDays: 30,
  sectionPriorities: {},
  targetUrlBindingMinSharedTokens: 2,
  inventoryCoverageMinCoveredTitleTokens: 2,
  inventoryCoverageMinPartialTitleTokens: 1,
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function latestFirst(records: SeoRankHistoryRecord[]): SeoRankHistoryRecord[] {
  return [...records].sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt));
}

function daysBetween(start: string, end: string): number | null {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.floor((endMs - startMs) / 86_400_000);
}

function sectionPriority(config: SectionRankingGapConfig, section: string): number {
  return config.sectionPriorities[section] || 9;
}

function priorityForSection(config: SectionRankingGapConfig, section: string): SeoPriority {
  const priority = sectionPriority(config, section);
  if (priority <= 1) return "high";
  if (priority <= 2) return "medium";
  return "low";
}

function confidenceForReason(reason: "missing" | "worse_than_threshold"): SeoConfidence {
  return reason === "worse_than_threshold" ? "high" : "medium";
}

function latestByCluster(records: SeoRankHistoryRecord[]): Map<string, SeoRankHistoryRecord[]> {
  const byCluster = new Map<string, SeoRankHistoryRecord[]>();
  for (const record of records) {
    const clusterId = cleanString(record.clusterId);
    if (!clusterId) continue;
    byCluster.set(clusterId, [...(byCluster.get(clusterId) || []), record]);
  }
  for (const [clusterId, clusterRecords] of byCluster.entries()) {
    byCluster.set(clusterId, latestFirst(clusterRecords));
  }
  return byCluster;
}

function normalizedQuery(value: unknown): string {
  return cleanString(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryTokens(value: unknown): string[] {
  return normalizedQuery(value).split(" ").filter(Boolean);
}

function sharedTokenCount(a: unknown, b: unknown): number {
  const left = new Set(queryTokens(a));
  const right = new Set(queryTokens(b));
  return Array.from(left).filter((token) => right.has(token)).length;
}

type RankingGapBindingGroup = {
  records: SeoRankHistoryRecord[];
};

function belongsToBindingGroup(input: {
  record: SeoRankHistoryRecord;
  group: RankingGapBindingGroup;
  minSharedTokens: number;
}): boolean {
  return input.group.records.some((candidate) => {
    if (cleanString(candidate.clusterId) === cleanString(input.record.clusterId)) return true;
    if (cleanString(candidate.section) !== cleanString(input.record.section)) return false;
    return sharedTokenCount(candidate.query, input.record.query) >= input.minSharedTokens;
  });
}

function bindingGroups(input: {
  records: SeoRankHistoryRecord[];
  minSharedTokens: number;
}): RankingGapBindingGroup[] {
  const groups: RankingGapBindingGroup[] = [];
  for (const record of input.records) {
    const existing = groups.find((group) =>
      belongsToBindingGroup({ record, group, minSharedTokens: input.minSharedTokens })
    );
    if (existing) {
      existing.records.push(record);
    } else {
      groups.push({ records: [record] });
    }
  }
  return groups;
}

function recordsByCluster(records: SeoRankHistoryRecord[]): Map<string, SeoRankHistoryRecord[]> {
  const byCluster = new Map<string, SeoRankHistoryRecord[]>();
  for (const record of records) {
    const clusterId = cleanString(record.clusterId);
    if (!clusterId) continue;
    byCluster.set(clusterId, [...(byCluster.get(clusterId) || []), record]);
  }
  for (const [clusterId, clusterRecords] of byCluster.entries()) {
    byCluster.set(clusterId, latestFirst(clusterRecords));
  }
  return byCluster;
}

function isInCooldown(input: {
  clusterId: string;
  decisions: WeeklyTop10ApprovalDecisionRecord[];
  generatedAt: string;
  cooldownDays: number;
}): boolean {
  return input.decisions.some((decision) => {
    if (decision.clusterId !== input.clusterId) return false;
    const age = daysBetween(decision.decidedAt, input.generatedAt);
    return age !== null && age >= 0 && age <= input.cooldownDays;
  });
}

function isAnyClusterInCooldown(input: {
  clusterIds: string[];
  decisions: WeeklyTop10ApprovalDecisionRecord[];
  generatedAt: string;
  cooldownDays: number;
}): boolean {
  return input.clusterIds.some((clusterId) =>
    isInCooldown({
      clusterId,
      decisions: input.decisions,
      generatedAt: input.generatedAt,
      cooldownDays: input.cooldownDays,
    })
  );
}

function positionInWindow(records: SeoRankHistoryRecord[]): number | null {
  const found = records.find((record) => record.found && typeof record.serpPosition === "number");
  return found?.serpPosition ?? null;
}

function bySectionCount(opportunities: SeoOpportunity[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const opportunity of opportunities) {
    const section = cleanString(opportunity.evidence?.find((item) => item.metric === "section")?.value) || "unknown";
    counts[section] = (counts[section] || 0) + 1;
  }
  return counts;
}

function gapReasonForRecords(input: {
  records: SeoRankHistoryRecord[];
  config: SectionRankingGapConfig;
}): {
  reason: "missing" | "worse_than_threshold";
  latestPosition: number | null;
  window: SeoRankHistoryRecord[];
} | null {
  const window = input.records.slice(0, Math.max(1, input.config.rankSmoothingRuns));
  const latestPosition = positionInWindow(window.slice(0, 1));
  const smoothedPosition = positionInWindow(window);
  const reason = smoothedPosition === null
    ? "missing"
    : latestPosition !== null && latestPosition > input.config.sectionRankingGapMaxPosition
      ? "worse_than_threshold"
      : null;
  if (!reason) return null;
  return { reason, latestPosition, window };
}

function bestUrlEvidence(records: SeoRankHistoryRecord[]): SeoRankHistoryRecord | null {
  const found = records.filter((record) => cleanString(record.matchedUrl));
  if (found.length === 0) return null;
  return [...found].sort((a, b) => {
    const aPosition = typeof a.serpPosition === "number" ? a.serpPosition : Number.MAX_SAFE_INTEGER;
    const bPosition = typeof b.serpPosition === "number" ? b.serpPosition : Number.MAX_SAFE_INTEGER;
    if (aPosition !== bPosition) return aPosition - bPosition;
    return Date.parse(b.checkedAt) - Date.parse(a.checkedAt);
  })[0];
}

function stableQueries(records: SeoRankHistoryRecord[]): string[] {
  const queries: string[] = [];
  for (const record of records) {
    const query = cleanString(record.query);
    if (query && !queries.includes(query)) queries.push(query);
  }
  return queries;
}

function representativeGapCluster(input: {
  groupRecords: SeoRankHistoryRecord[];
  byCluster: Map<string, SeoRankHistoryRecord[]>;
  config: SectionRankingGapConfig;
}): {
  clusterId: string;
  records: SeoRankHistoryRecord[];
  reason: "missing" | "worse_than_threshold";
  latestPosition: number | null;
  window: SeoRankHistoryRecord[];
} | null {
  const gapClusters = Array.from(input.byCluster.entries())
    .map(([clusterId, records]) => {
      const gap = gapReasonForRecords({ records, config: input.config });
      return gap ? { clusterId, records, ...gap } : null;
    })
    .filter(Boolean) as Array<{
      clusterId: string;
      records: SeoRankHistoryRecord[];
      reason: "missing" | "worse_than_threshold";
      latestPosition: number | null;
      window: SeoRankHistoryRecord[];
    }>;
  if (gapClusters.length === 0) return null;
  const inputOrder = new Map(input.groupRecords.map((record, index) => [cleanString(record.clusterId), index]));
  return [...gapClusters].sort((a, b) => {
    const seedDiff = Number(a.clusterId.startsWith("seed_")) - Number(b.clusterId.startsWith("seed_"));
    if (seedDiff) return seedDiff;
    return (inputOrder.get(a.clusterId) ?? 0) - (inputOrder.get(b.clusterId) ?? 0);
  })[0];
}

export function buildSectionRankingGapOpportunities(input: {
  generatedAt: string;
  domain: string;
  records: SeoRankHistoryRecord[];
  decisions: WeeklyTop10ApprovalDecisionRecord[];
  inventoryPages?: readonly SeoPageInventoryItem[];
  config?: Partial<SectionRankingGapConfig>;
}): SectionRankingGapReview {
  const config = {
    ...DEFAULT_SECTION_RANKING_GAP_CONFIG,
    ...(input.config || {}),
    sectionPriorities: {
      ...DEFAULT_SECTION_RANKING_GAP_CONFIG.sectionPriorities,
      ...(input.config?.sectionPriorities || {}),
    },
  };
  const grouped = bindingGroups({
    records: input.records,
    minSharedTokens: config.targetUrlBindingMinSharedTokens,
  });
  const opportunities: SeoOpportunity[] = [];
  let cooldownSkipped = 0;

  for (const group of grouped) {
    const byCluster = recordsByCluster(group.records);
    const clusterIds = Array.from(byCluster.keys());
    if (isAnyClusterInCooldown({ clusterIds, decisions: input.decisions, generatedAt: input.generatedAt, cooldownDays: config.decisionCooldownDays })) {
      cooldownSkipped += 1;
      continue;
    }
    const gap = representativeGapCluster({
      groupRecords: group.records,
      byCluster,
      config,
    });
    if (!gap) continue;
    const clusterId = gap.clusterId;
    const records = gap.records;
    const window = gap.window;
    const latest = records[0];
    if (!latest) continue;

    const latestPosition = gap.latestPosition;
    const reason = gap.reason;
    const queries = stableQueries(group.records);
    const section = cleanString(latest.section) || "/content/";
    const title = reason === "missing"
      ? `Закрыть ranking gap: ${queries[0]} не найден в выдаче`
      : `Поднять кластер ${queries[0]} выше позиции ${config.sectionRankingGapMaxPosition}`;
    const urlRecord = bestUrlEvidence(group.records);
    const serpMatchedUrl = cleanString(urlRecord?.matchedUrl) || null;
    const inventoryCoverage = serpMatchedUrl || !input.inventoryPages?.length
      ? null
      : resolvePageInventoryCoverage({
        cluster: {
          clusterId,
          query: queries.join(" "),
          section,
        },
        inventory: input.inventoryPages,
        config: {
          minCoveredTitleTokens: config.inventoryCoverageMinCoveredTitleTokens,
          minPartialTitleTokens: config.inventoryCoverageMinPartialTitleTokens,
        },
      });
    const inventoryMatchedUrl =
      inventoryCoverage && inventoryCoverage.verdict !== "gap" ? inventoryCoverage.matchingArticleUrl : null;
    const matchedUrl = serpMatchedUrl || inventoryMatchedUrl;
    const urlBindingMessage = serpMatchedUrl && urlRecord
      ? `Target URL inherited from query variant "${urlRecord.query}" at Yandex SERP position ${urlRecord.serpPosition ?? "n/a"}.`
      : null;
    const inventoryBindingMessage = !serpMatchedUrl && inventoryCoverage && inventoryMatchedUrl
      ? `Target URL candidate resolved from sitemap inventory with ${inventoryCoverage.verdict} coverage; matched title/H1 tokens: ${inventoryCoverage.matchedTitleTokens.join(", ") || "n/a"}.`
      : null;

    opportunities.push({
      type: "keyword",
      opportunityType: "section_ranking_gap",
      title,
      description:
        reason === "missing"
          ? `Целевой кластер раздела ${section} не имеет найденной позиции zaruku.ru в последних ${config.rankSmoothingRuns} проверках.`
          : `Целевой кластер раздела ${section} найден хуже допустимого порога: позиция ${latestPosition}, порог ${config.sectionRankingGapMaxPosition}.`,
      targetUrl: matchedUrl,
      targetKeywords: queries.slice(0, 10),
      market: "RU",
      language: latest.language,
      impact: priorityForSection(config, section) === "high" ? "high" : "medium",
      effort: "medium",
      urgency: "medium",
      priority: priorityForSection(config, section),
      confidence: confidenceForReason(reason),
      source: "provider",
      recommendedAction:
        matchedUrl
          ? "Доработать существующую страницу под кластер: усилить интент, сниппет и внутренние ссылки."
          : "Проверить покрытие кластера в разделе и выбрать существующую страницу или создать новый контент.",
      reasoning: "Generated from RankHistory section-level SERP tracking; query variants are grouped for target page binding, while SERP provenance remains per record.",
      sourceFindingId: `rank_gap_${clusterId}`,
      evidence: [
        {
          source: "yandex_serp_rank",
          metric: "section",
          value: section,
          query: queries[0] || null,
          url: matchedUrl,
          message: `Section target cluster: ${section}`,
          collectedAt: latest.checkedAt,
        },
        ...(urlBindingMessage && urlRecord ? [{
          source: "yandex_serp_rank" as const,
          metric: "target_url_binding",
          value: urlRecord.query,
          query: urlRecord.query,
          url: matchedUrl,
          message: urlBindingMessage,
          collectedAt: urlRecord.checkedAt,
        }, {
          source: "yandex_serp_rank" as const,
          metric: "target_url_binding_serp_position",
          value: typeof urlRecord.serpPosition === "number" ? urlRecord.serpPosition : null,
          query: urlRecord.query,
          url: matchedUrl,
          message: urlBindingMessage,
          collectedAt: urlRecord.checkedAt,
        }] : []),
        ...(inventoryBindingMessage && inventoryCoverage && inventoryMatchedUrl ? [{
          source: "crawler" as const,
          metric: "target_url_candidate",
          value: inventoryCoverage.verdict,
          query: queries[0] || null,
          url: inventoryMatchedUrl,
          message: inventoryBindingMessage,
          collectedAt: latest.checkedAt,
        }] : []),
        {
          source: "yandex_serp_rank",
          metric: reason === "missing" ? "not_found_last_runs" : "serp_position",
          value: reason === "missing" ? window.length : latestPosition,
          query: queries[0] || null,
          url: matchedUrl,
          message:
            reason === "missing"
              ? `No matched position in the last ${window.length} RankHistory record(s).`
              : `Latest SERP position ${latestPosition} is worse than configured max ${config.sectionRankingGapMaxPosition}.`,
          collectedAt: latest.checkedAt,
        },
      ],
    });
  }

  opportunities.sort((a, b) => {
    const priorityDiff = sectionPriority(config, cleanString(a.evidence?.[0]?.value)) - sectionPriority(config, cleanString(b.evidence?.[0]?.value));
    if (priorityDiff) return priorityDiff;
    return a.title.localeCompare(b.title);
  });

  return {
    schemaVersion: "seo_os_section_ranking_gap_review_v1",
    generatedAt: input.generatedAt,
    domain: input.domain,
    config: {
      sectionRankingGapMaxPosition: config.sectionRankingGapMaxPosition,
      rankSmoothingRuns: config.rankSmoothingRuns,
      decisionCooldownDays: config.decisionCooldownDays,
    },
    opportunities,
    summary: {
      totalClusters: grouped.length,
      generated: opportunities.length,
      cooldownSkipped,
      bySection: bySectionCount(opportunities),
    },
    notes: [
      "section_ranking_gap is generated only from RankHistory records.",
      "not_found is a proactive ranking gap signal, but it is not treated as a rank_drop_alert.",
      "When SERP does not expose a target URL, sitemap inventory may provide a non-destructive target page candidate.",
      "Decided clusters are suppressed during the configured cooldown window.",
    ],
  };
}
