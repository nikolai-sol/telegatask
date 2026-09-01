import "dotenv/config";
import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import "../src/config/firebase";
import { YandexSerpRankSource } from "../src/features/seoAgent/providers/yandexSerpRankSource";
import { zarukuSeoProductionConfig } from "../src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig";
import {
  buildSeoRankDashboardExport,
  buildSeoRankHistoryRecords,
  buildSeoSectionRankTrackingList,
  type SeoSectionRankTrackingListItem,
  type SeoSectionRankTrackingLiveCluster,
} from "../src/features/seoAgent/sectionRankTracking";
import {
  listPreviousSeoRankHistoryRecords,
  persistSeoRankHistoryRecords,
  seoRankHistoryWritesEnabled,
} from "../src/features/seoAgent/sectionRankHistoryRepository";

type QueryClusterReviewArtifact = {
  clusterReview?: {
    clusters?: SeoSectionRankTrackingLiveCluster[];
  };
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  return cleanString(args[index + 1]) || null;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function buildRegionTrackingMap(trackingList: SeoSectionRankTrackingListItem[]): Map<string, SeoSectionRankTrackingListItem[]> {
  const map = new Map<string, SeoSectionRankTrackingListItem[]>();
  for (const item of trackingList) {
    const region = cleanString(item.region) || "225";
    map.set(region, [...(map.get(region) || []), item]);
  }
  return map;
}

function buildTrackingSetVersion(input: {
  runId: string;
  runWeekKey?: string;
  dataWeekKey?: string;
  trackingList: SeoSectionRankTrackingListItem[];
  requestCount: number;
  regionSummaries: Array<{ region: string; requestCount: number; checkedCount: number; state: string }>;
}) {
  const items = input.trackingList
    .map((item) => ({
      clusterId: item.clusterId,
      query: item.query,
      section: item.section,
      intentClass: item.intentClass,
      source: item.source,
      region: item.region,
      regionSource: item.regionSource,
      regionFallback: item.regionFallback,
    }))
    .sort((a, b) => {
      const sectionDiff = a.section.localeCompare(b.section);
      if (sectionDiff) return sectionDiff;
      return a.query.localeCompare(b.query);
    });
  return {
    schemaVersion: "seo_os_section_rank_tracking_set_v1" as const,
    generatedAt: new Date().toISOString(),
    runId: input.runId,
    runWeekKey: input.runWeekKey || null,
    dataWeekKey: input.dataWeekKey || null,
    itemCount: items.length,
    seedDerivedCount: items.filter((item) => item.source !== "live_cluster").length,
    liveDerivedCount: items.filter((item) => item.source === "live_cluster").length,
    seedFallbackCount: items.filter((item) => item.regionFallback).length,
    checksum: createHash("sha256").update(JSON.stringify(items)).digest("hex"),
    requestCount: input.requestCount,
    regionSummaries: input.regionSummaries,
    items,
  };
}

function requiredFlag(args: string[], name: string): string {
  const value = readFlag(args, name);
  if (!value) {
    throw new Error(
      "Usage: runSectionRankTracking --cluster-review <task-043.json> --out <rank-dashboard.json> --run-id <runId> --enable-live-serp"
    );
  }
  return value;
}

function readLiveClusters(path: string): SeoSectionRankTrackingLiveCluster[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as QueryClusterReviewArtifact;
  const clusters = parsed.clusterReview?.clusters;
  if (!Array.isArray(clusters)) throw new Error(`No clusterReview.clusters found in ${path}`);
  return clusters;
}

async function main() {
  const args = process.argv.slice(2);
  const clusterReviewPath = requiredFlag(args, "--cluster-review");
  const outPath = requiredFlag(args, "--out");
  const runId = requiredFlag(args, "--run-id");
  const enableLiveSerp = hasFlag(args, "--enable-live-serp");
  if (!enableLiveSerp) {
    throw new Error("Section rank tracking is opt-in. Pass --enable-live-serp to run live Yandex SERP checks.");
  }

  const liveClusters = readLiveClusters(clusterReviewPath);
  const config = zarukuSeoProductionConfig.sectionRankTracking;
  const trackingList = buildSeoSectionRankTrackingList({
    config,
    liveClusters,
    targetIntentClasses: zarukuSeoProductionConfig.semanticIntent.targetIntentClasses,
  });
  const estimatedCost = typeof config.estimatedCostPerRequestRub === "number"
    ? trackingList.length * config.estimatedCostPerRequestRub
    : null;
  const previousRecords = await listPreviousSeoRankHistoryRecords({
    teamId: zarukuSeoProductionConfig.team.id,
    domain: zarukuSeoProductionConfig.domain,
    beforeRunId: runId,
  });
  const rankSource = new YandexSerpRankSource();
  const regionSummaries: Array<{ region: string; requestCount: number; checkedCount: number; state: string }> = [];
  const checks: Awaited<ReturnType<YandexSerpRankSource["run"]>>["checks"] = [];
  for (const [region, items] of buildRegionTrackingMap(trackingList).entries()) {
    const rankTracking = await rankSource.run({
      targetDomain: zarukuSeoProductionConfig.domain,
      targetDomainAliases: [...zarukuSeoProductionConfig.targetDomainAliases],
      keywords: items.map((item) => item.query),
      region,
      language: zarukuSeoProductionConfig.language,
      device: zarukuSeoProductionConfig.targetDevice,
    });
    regionSummaries.push({
      region,
      requestCount: items.length,
      checkedCount: rankTracking.checks.length,
      state: rankTracking.status.state,
    });
    checks.push(...rankTracking.checks);
  }
  const trackingSetVersion = buildTrackingSetVersion({
    runId,
    trackingList,
    requestCount: trackingList.length,
    regionSummaries,
  });
  const records = buildSeoRankHistoryRecords({
    teamId: zarukuSeoProductionConfig.team.id,
    runId,
    domain: zarukuSeoProductionConfig.domain,
    trackingList,
    rankChecks: checks,
  });
  const persistence = await persistSeoRankHistoryRecords({
    writesEnabled: seoRankHistoryWritesEnabled(),
    records,
  });
  const dashboard = buildSeoRankDashboardExport({
    generatedAt: new Date().toISOString(),
    domain: zarukuSeoProductionConfig.domain,
    runId,
    currentRecords: records,
    previousRecords,
    alertDropThreshold: config.alertDropThreshold,
    rankSmoothingRuns: config.rankSmoothingRuns,
  });
  const artifact = {
    schemaVersion: "seo_os_section_rank_tracking_run_v1",
    generatedAt: new Date().toISOString(),
    domain: zarukuSeoProductionConfig.domain,
    teamId: zarukuSeoProductionConfig.team.id,
    runId,
    source: "local_opt_in",
    clusterReviewPath,
    config: {
      maxSerpRequestsPerRun: config.maxSerpRequestsPerRun,
      alertDropThreshold: config.alertDropThreshold,
      rankSmoothingRuns: config.rankSmoothingRuns,
      sectionRankingGapMaxPosition: config.sectionRankingGapMaxPosition,
      decisionCooldownDays: config.decisionCooldownDays,
      estimatedCostPerRequestRub: config.estimatedCostPerRequestRub,
      seedClusterCount: config.seedClusters.length,
    },
    trackingList,
    trackingSetVersion,
    request: {
      requestCount: trackingList.length,
      rankChecks: checks.length,
      capped: trackingList.length >= config.maxSerpRequestsPerRun,
      maxSerpRequestsPerRun: config.maxSerpRequestsPerRun,
    },
    cost: {
      currency: estimatedCost === null ? null : "RUB",
      estimatedCostPerRequestRub: config.estimatedCostPerRequestRub,
      estimatedCost,
      note: "Request count is one Yandex Search API call per tracked section cluster; unit cost is not configured when null.",
    },
    rankTracking: {
      checks,
      regionSummaries,
    },
    rankHistory: {
      collection: "seoRankHistory",
      writesEnabled: seoRankHistoryWritesEnabled(),
      previousRecordCount: previousRecords.length,
      written: persistence.written,
      records,
    },
    dashboard,
    sideEffects: {
      liveApiCalls: true,
      firestoreWrites: persistence.sideEffects.firestoreWrites,
      telegramMessagesSent: false,
      approvalCommandExecuted: false,
      productionPipelineRun: false,
    },
    notes: [
      "Local opt-in section-level rank tracking run only.",
      "RankHistory writes require SEO_RANK_HISTORY_WRITES=1.",
      "SERP position provenance is preserved and is not merged with Yandex Webmaster averagePosition.",
      "rank_drop_alert records are dashboard alerts only and are not opportunities.",
      "No scheduler, Telegram digest, approval flow or production pipeline changes.",
    ],
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        outPath,
        trackingListSize: trackingList.length,
        requestCount: artifact.request.requestCount,
        rankChecks: artifact.rankTracking.checks.length,
        foundCount: artifact.rankTracking.checks.filter((check) => check.found).length,
        previousRecordCount: previousRecords.length,
        written: persistence.written,
        dashboardSummary: dashboard.summary,
        sideEffects: artifact.sideEffects,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
