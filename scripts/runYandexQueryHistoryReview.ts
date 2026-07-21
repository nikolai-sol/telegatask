import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { zarukuSeoProductionConfig } from "../src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig";
import { collectYandexQueryHistory } from "../src/features/seoAgent/production/zaruku/collectors/yandexQueryHistoryCollector";
import {
  mapYandexPopularQueriesToSearchPerformanceRecords,
  reviewYandexPopularQueriesSearchPerformanceMapping,
} from "../src/features/seoAgent/yandexPopularQueriesSearchPerformanceMapper";
import { generateSearchPerformanceOpportunities } from "../src/features/seoAgent/searchPerformanceOpportunityEngine";

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  return cleanString(args[index + 1]) || null;
}

function requiredFlag(args: string[], name: string): string {
  const value = readFlag(args, name);
  if (!value) {
    throw new Error(
      "Usage: runYandexQueryHistoryReview --out <review.json> --raw-out <raw-history.json> [--now <iso>]"
    );
  }
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const outPath = requiredFlag(args, "--out");
  const rawOutPath = requiredFlag(args, "--raw-out");
  const now = readFlag(args, "--now");
  const collected = await collectYandexQueryHistory(zarukuSeoProductionConfig, {
    ...(now ? { now: () => new Date(now) } : {}),
  });
  const records = mapYandexPopularQueriesToSearchPerformanceRecords({
    queries: collected.rows,
    property: collected.hostId,
    siteUrl: collected.siteUrl,
    dateRange: collected.dateRange,
  });
  const opportunities = generateSearchPerformanceOpportunities(records, {
    market: zarukuSeoProductionConfig.market,
    language: zarukuSeoProductionConfig.language,
  });
  const artifact = {
    schemaVersion: "seo_os_yandex_28d_query_history_review_v1",
    generatedAt: (now ? new Date(now) : new Date()).toISOString(),
    domain: zarukuSeoProductionConfig.domain,
    source: "yandex_webmaster",
    dateRange: collected.dateRange,
    requestCount: collected.requestCount,
    endpointPaths: collected.endpointPaths,
    rawSnapshotPath: rawOutPath,
    inputRows: collected.rows.length,
    searchPerformance: {
      recordCount: records.length,
      records,
      mappingReview: reviewYandexPopularQueriesSearchPerformanceMapping({
        queries: collected.rows,
        property: collected.hostId,
        siteUrl: collected.siteUrl,
        dateRange: collected.dateRange,
      }),
    },
    opportunityCount: opportunities.length,
    opportunities,
    sideEffects: {
      persisted: false,
      sent: false,
      productionPipelineRun: false,
    },
    notes: [
      "Local Yandex 28d query history review only.",
      "Raw Yandex history response is saved separately next to this review artifact.",
      "Opportunity Engine thresholds are not changed.",
      "No Firestore writes, Telegram sends, scheduler actions or production pipeline execution.",
    ],
  };

  mkdirSync(dirname(rawOutPath), { recursive: true });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(rawOutPath, `${JSON.stringify(collected, null, 2)}\n`);
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        outPath,
        rawOutPath,
        dateRange: artifact.dateRange,
        requestCount: artifact.requestCount,
        rows: artifact.inputRows,
        maxImpressions: artifact.searchPerformance.mappingReview.maxImpressions,
        opportunities: artifact.opportunityCount,
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
