import type { SeoDeviceType, YandexRankCheck } from "./types";

export type SeoSectionRankTrackingSeedCluster = {
  clusterId: string;
  section: string;
  query: string;
  priority: number;
  intentClass: string;
};

export type SeoSectionRankTrackingConfig = {
  seedClusters: readonly SeoSectionRankTrackingSeedCluster[];
  maxSerpRequestsPerRun: number;
  alertDropThreshold: number;
  estimatedCostPerRequestRub: number | null;
  regionContract: {
    facilityFallbackRegion: string;
    regionByIntent: {
      medical_informational: string;
      facility_navigational: string;
      supportive_trust: string;
      own_brand: string;
    };
    facilityRegionMap: readonly {
      geoToken: string;
      region: string;
    }[];
  };
};

export type SeoSectionRankTrackingLiveCluster = {
  clusterId: string;
  primaryQuery: string;
  intentClass: string;
  memberQueries: string[];
};

export type SeoSectionRankTrackingListItem = {
  clusterId: string;
  query: string;
  section: string;
  intentClass: string;
  priority: number;
  source: "seed" | "live_cluster" | "seed_and_live_cluster";
  region: string;
  regionSource: "intent_default" | "facility_geo" | "facility_fallback";
  regionFallback: boolean;
};

export type SeoRankHistoryRecord = {
  id: string;
  teamId: string;
  runId: string;
  domain: string;
  searchEngine: "yandex";
  provider: "yandex_search_api";
  clusterId: string;
  query: string;
  section: string;
  intentClass: string;
  checkedAt: string;
  serpPosition: number | null;
  found: boolean;
  matchedUrl: string | null;
  topResultDomains: string[];
  region: string | null;
  language: string | null;
  device: SeoDeviceType | null;
};

export type SeoRankDashboardSection = {
  section: string;
  trackedClusters: number;
  foundClusters: number;
  coverageRatio: number;
  items: Array<{
    clusterId: string;
    query: string;
    currentPosition: number | null;
    previousPosition: number | null;
    delta: number | null;
    region: string | null;
    matchedUrl: string | null;
    deltaStatus: "ok" | "no_data";
  }>;
};

export type SeoRankDropAlert = {
  type: "rank_drop_alert";
  clusterId: string;
  query: string;
  section: string;
  previousPosition: number;
  currentPosition: number;
  delta: number;
  threshold: number;
};

export type SeoRankDashboardExport = {
  schemaVersion: "seo_os_rank_history_dashboard_export_v1";
  generatedAt: string;
  domain: string;
  runId: string;
  searchEngine: "yandex";
  summary: {
    trackedClusters: number;
    foundClusters: number;
    coverageRatio: number;
    alertCount: number;
  };
  sections: SeoRankDashboardSection[];
  alerts: SeoRankDropAlert[];
  notes: string[];
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalized(value: unknown): string {
  return cleanString(value).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

function inferSection(query: string): string {
  const text = normalized(query);
  if (text.includes("меланома")) return "/melanoma/";
  if (text.includes("молочной желез") || text.includes("рмж")) return "/rak-molochnoj-zhelezy/";
  if (text.includes("легк")) return "/rak-lyogkogo/";
  if (text.includes("печен")) return "/rak-pecheni/";
  if (text.includes("цаоп") || text.includes("онкологический центр") || text.includes("онкоцентр")) return "/map/";
  return "/content/";
}

function defaultPriorityForIntent(intentClass: string): number {
  if (intentClass === "medical_informational") return 1;
  if (intentClass === "facility_navigational") return 2;
  if (intentClass === "supportive_trust") return 3;
  return 9;
}

function itemKey(query: string): string {
  return normalized(query);
}

function buildNormalizedToken(token: string): string {
  return normalized(token).toLowerCase();
}

function resolveFacilityRegion(input: {
  query: string;
  facilityRegionMap: readonly { geoToken: string; region: string }[];
  facilityFallbackRegion: string;
}): { region: string; source: "facility_geo" | "facility_fallback" } {
  const normalizedQuery = normalized(input.query);
  const rules = [...input.facilityRegionMap].sort(
    (a, b) => buildNormalizedToken(b.geoToken).length - buildNormalizedToken(a.geoToken).length
  );
  for (const rule of rules) {
    const token = buildNormalizedToken(rule.geoToken);
    if (!token) continue;
    if (normalizedQuery.includes(token)) {
      return {
        region: cleanString(rule.region) || input.facilityFallbackRegion,
        source: "facility_geo",
      };
    }
  }
  return {
    region: input.facilityFallbackRegion,
    source: "facility_fallback",
  };
}

function resolveTrackingRegion(input: {
  query: string;
  intentClass: string;
  regionContract: SeoSectionRankTrackingConfig["regionContract"];
}): { region: string; source: SeoSectionRankTrackingListItem["regionSource"]; fallback: boolean } {
  if (input.intentClass === "facility_navigational") {
    const resolved = resolveFacilityRegion({
      query: input.query,
      facilityRegionMap: input.regionContract.facilityRegionMap,
      facilityFallbackRegion: input.regionContract.facilityFallbackRegion,
    });
    return {
      region: resolved.region,
      source: resolved.source,
      fallback: resolved.source === "facility_fallback",
    };
  }

  const region =
    input.regionContract.regionByIntent[input.intentClass as keyof typeof input.regionContract.regionByIntent]
    || input.regionContract.regionByIntent.medical_informational
    || input.regionContract.facilityFallbackRegion;
  return {
    region,
    source: "intent_default",
    fallback: false,
  };
}

export function buildSeoSectionRankTrackingList(input: {
  config: SeoSectionRankTrackingConfig;
  liveClusters: SeoSectionRankTrackingLiveCluster[];
  targetIntentClasses: readonly string[];
}): SeoSectionRankTrackingListItem[] {
  const byQuery = new Map<string, SeoSectionRankTrackingListItem>();
  for (const seed of input.config.seedClusters) {
    const query = cleanString(seed.query);
    if (!query) continue;
    const regionResolved = resolveTrackingRegion({
      query,
      intentClass: seed.intentClass,
      regionContract: input.config.regionContract,
    });
    byQuery.set(itemKey(query), {
      clusterId: seed.clusterId,
      query,
      section: seed.section,
      intentClass: seed.intentClass,
      priority: seed.priority,
      region: regionResolved.region,
      regionSource: regionResolved.source,
      regionFallback: regionResolved.fallback,
      source: "seed",
    });
  }

  const targetClasses = new Set(input.targetIntentClasses);
  for (const cluster of input.liveClusters) {
    if (!targetClasses.has(cluster.intentClass)) continue;
    const query = cleanString(cluster.primaryQuery);
    if (!query) continue;
    const key = itemKey(query);
    const existing = byQuery.get(key);
    if (existing) {
      byQuery.set(key, {
        ...existing,
        clusterId: existing.clusterId || cluster.clusterId,
        source: "seed_and_live_cluster",
      });
      continue;
    }
    const regionResolved = resolveTrackingRegion({
      query,
      intentClass: cluster.intentClass,
      regionContract: input.config.regionContract,
    });
    byQuery.set(key, {
      clusterId: cluster.clusterId,
      query,
      section: inferSection(query),
      intentClass: cluster.intentClass,
      priority: defaultPriorityForIntent(cluster.intentClass),
      region: regionResolved.region,
      regionSource: regionResolved.source,
      regionFallback: regionResolved.fallback,
      source: "live_cluster",
    });
  }

  return Array.from(byQuery.values())
    .sort((a, b) => {
      const priorityDiff = a.priority - b.priority;
      if (priorityDiff) return priorityDiff;
      return a.query.localeCompare(b.query);
    })
    .slice(0, Math.max(0, input.config.maxSerpRequestsPerRun));
}

export function buildSeoRankHistoryRecords(input: {
  teamId: string;
  runId: string;
  domain: string;
  trackingList: SeoSectionRankTrackingListItem[];
  rankChecks: YandexRankCheck[];
}): SeoRankHistoryRecord[] {
  const checksByQuery = new Map(input.rankChecks.map((check) => [normalized(check.query), check]));
  return input.trackingList.map((item) => {
    const check = checksByQuery.get(normalized(item.query));
    const checkedAt = cleanString(check?.checkedAt) || new Date().toISOString();
    const id = [
      input.teamId,
      input.runId,
      item.clusterId,
      normalized(item.query).replace(/[^a-zа-я0-9_-]+/gi, "_"),
    ].filter(Boolean).join("_");
    return {
      id,
      teamId: input.teamId,
      runId: input.runId,
      domain: input.domain,
      searchEngine: "yandex",
      provider: "yandex_search_api",
      clusterId: item.clusterId,
      query: item.query,
      section: item.section,
      intentClass: item.intentClass,
      checkedAt,
      serpPosition: typeof check?.position === "number" ? check.position : null,
      found: Boolean(check?.found),
      matchedUrl: cleanString(check?.matchedUrl) || null,
      topResultDomains: Array.isArray(check?.topResultDomains) ? [...(check?.topResultDomains || [])] : [],
      region: cleanString(check?.region) || cleanString(item.region) || null,
      language: cleanString(check?.language) || null,
      device: check?.device || null,
    };
  });
}

function coverageRatio(found: number, total: number): number {
  return total > 0 ? Number((found / total).toFixed(6)) : 0;
}

function recordBucketKey(input: { clusterId: string; region: string | null }): string {
  return `${input.clusterId}||${input.region || ""}`;
}

function latestRecordsByCluster(records: SeoRankHistoryRecord[]): Map<string, SeoRankHistoryRecord[]> {
  const byCluster = new Map<string, SeoRankHistoryRecord[]>();
  for (const record of records) {
    byCluster.set(
      recordBucketKey({ clusterId: record.clusterId, region: record.region }),
      [...(byCluster.get(recordBucketKey({ clusterId: record.clusterId, region: record.region })) || []), record]
    );
  }
  for (const [key, clusterRecords] of byCluster.entries()) {
    byCluster.set(key, [...clusterRecords].sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt)));
  }
  return byCluster;
}

function firstFoundPosition(records: SeoRankHistoryRecord[]): number | null {
  const found = records.find((record) => record.found && typeof record.serpPosition === "number");
  return found?.serpPosition ?? null;
}

function deltaWindow(input: {
  current: SeoRankHistoryRecord;
  previousRecords: SeoRankHistoryRecord[];
  rankSmoothingRuns: number;
}): {
  currentPosition: number | null;
  previousPosition: number | null;
  delta: number | null;
  deltaStatus: "ok" | "no_data";
} {
  if (!input.current.found || typeof input.current.serpPosition !== "number") {
    return {
      currentPosition: null,
      previousPosition: null,
      delta: null,
      deltaStatus: "no_data",
    };
  }

  const currentPosition = input.current.serpPosition;
  const previousPosition = firstFoundPosition(input.previousRecords.slice(0, Math.max(1, input.rankSmoothingRuns)));
  if (previousPosition === null) {
    return {
      currentPosition,
      previousPosition: null,
      delta: null,
      deltaStatus: "no_data",
    };
  }
  return {
    currentPosition,
    previousPosition,
    delta: currentPosition - previousPosition,
    deltaStatus: "ok",
  };
}

export function buildSeoRankDashboardExport(input: {
  generatedAt: string;
  domain: string;
  runId: string;
  currentRecords: SeoRankHistoryRecord[];
  previousRecords: SeoRankHistoryRecord[];
  alertDropThreshold: number;
  rankSmoothingRuns?: number;
}): SeoRankDashboardExport {
  const previous = latestRecordsByCluster(input.previousRecords);
  const rankSmoothingRuns = Math.max(1, input.rankSmoothingRuns || 1);
  const sectionNames = Array.from(new Set(input.currentRecords.map((record) => record.section))).sort();
  const sections = sectionNames.map((section) => {
    const records = input.currentRecords.filter((record) => record.section === section);
    const found = records.filter((record) => record.found).length;
    return {
      section,
      trackedClusters: records.length,
      foundClusters: found,
      coverageRatio: coverageRatio(found, records.length),
      items: records.map((record) => {
        const delta = deltaWindow({
          current: record,
          previousRecords:
            previous.get(recordBucketKey({ clusterId: record.clusterId, region: record.region })) || [],
          rankSmoothingRuns,
        });
        return {
          clusterId: record.clusterId,
          query: record.query,
          region: record.region,
          currentPosition: delta.currentPosition,
          previousPosition: delta.previousPosition,
          delta: delta.delta,
          deltaStatus: delta.deltaStatus,
          matchedUrl: record.matchedUrl,
        };
      }),
    };
  });
  const alerts = sections.flatMap((section) =>
    section.items
      .filter((item) => typeof item.delta === "number" && item.delta >= input.alertDropThreshold)
      .map((item) => ({
        type: "rank_drop_alert" as const,
        clusterId: item.clusterId,
        query: item.query,
        section: section.section,
        previousPosition: item.previousPosition as number,
        currentPosition: item.currentPosition as number,
        delta: item.delta as number,
        threshold: input.alertDropThreshold,
      }))
  );
  const found = input.currentRecords.filter((record) => record.found).length;
  return {
    schemaVersion: "seo_os_rank_history_dashboard_export_v1",
    generatedAt: input.generatedAt,
    domain: input.domain,
    runId: input.runId,
    searchEngine: "yandex",
    summary: {
      trackedClusters: input.currentRecords.length,
      foundClusters: found,
      coverageRatio: coverageRatio(found, input.currentRecords.length),
      alertCount: alerts.length,
    },
    sections,
    alerts,
    notes: [
      "Layer-1 global report contract for section-level Yandex SERP RankHistory.",
      "SERP positions are stored as provenance and are not merged with Yandex Webmaster averagePosition.",
      "rank_drop_alert records are dashboard alerts only; they are not opportunities.",
      "rank_drop_alert deltas use the configured smoothing window; not_found is treated as no_data, not as a ranking drop.",
    ],
  };
}
