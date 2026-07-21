import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { YandexSerpRankSource } from "../src/features/seoAgent/providers/yandexSerpRankSource";
import { zarukuSeoProductionConfig } from "../src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig";
import type { SeoSearchPerformanceRecord } from "../src/features/seoAgent/searchPerformanceNormalizer";
import { generateSearchPerformanceOpportunities } from "../src/features/seoAgent/searchPerformanceOpportunityEngine";
import { evaluateYandexSerpUrlEvidenceQualityGate } from "../src/features/seoAgent/yandexSerpUrlEvidenceQualityGate";
import { applyYandexSerpQueryUrlEvidence } from "../src/features/seoAgent/yandexSerpQueryUrlEvidenceMapper";

type IntentFilteredReviewArtifact = {
  intentReview?: {
    classCounts?: Record<string, number>;
    targetIntentClasses?: string[];
    classifications?: Array<{
      query: string;
      intentClass: string;
      isTarget: boolean;
    }>;
    serpKeywordExpansion?: {
      topN: number;
      topQueryKeywords?: string[];
      requestCount: number;
    };
  };
};

type QueryHistoryReviewArtifact = {
  searchPerformance?: {
    records?: SeoSearchPerformanceRecord[];
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

function requiredFlag(args: string[], name: string): string {
  const value = readFlag(args, name);
  if (!value) {
    throw new Error(
      "Usage: runYandexTargetClassSerpEvidenceRefresh --history-review <task-038-review.json> --intent-review <task-041-review.json> --out <task-042-review.json> --enable-serp-query-url-evidence"
    );
  }
  return value;
}

function readHistoryRecords(path: string): SeoSearchPerformanceRecord[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as QueryHistoryReviewArtifact;
  const records = parsed.searchPerformance?.records;
  if (!Array.isArray(records)) throw new Error(`No searchPerformance.records found in ${path}`);
  return records;
}

function readIntentReview(path: string): Required<IntentFilteredReviewArtifact>["intentReview"] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as IntentFilteredReviewArtifact;
  const review = parsed.intentReview;
  if (!review) throw new Error(`No intentReview found in ${path}`);
  if (!Array.isArray(review.classifications)) throw new Error(`No intentReview.classifications found in ${path}`);
  if (!Array.isArray(review.serpKeywordExpansion?.topQueryKeywords)) {
    throw new Error(`No intentReview.serpKeywordExpansion.topQueryKeywords found in ${path}`);
  }
  return review as Required<IntentFilteredReviewArtifact>["intentReview"];
}

function uniqueClean(values: unknown[]): string[] {
  return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function targetRecords(input: {
  records: SeoSearchPerformanceRecord[];
  targetQueries: string[];
}): SeoSearchPerformanceRecord[] {
  const targets = new Set(input.targetQueries.map((query) => query.toLowerCase()));
  return input.records.filter((record) => {
    const query = cleanString(record.query).toLowerCase();
    return record.source === "yandex_webmaster" && record.dimension === "query" && targets.has(query);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const historyReviewPath = requiredFlag(args, "--history-review");
  const intentReviewPath = requiredFlag(args, "--intent-review");
  const outPath = requiredFlag(args, "--out");
  const enabledByCli = hasFlag(args, "--enable-serp-query-url-evidence");
  if (!enabledByCli) {
    throw new Error("Target-class SERP evidence refresh is opt-in. Pass --enable-serp-query-url-evidence to run live SERP checks.");
  }

  const records = readHistoryRecords(historyReviewPath);
  const intentReview = readIntentReview(intentReviewPath);
  const targetQueries = uniqueClean(intentReview.serpKeywordExpansion.topQueryKeywords);
  const recordsForGate = targetRecords({ records, targetQueries });
  const estimatedCostPerRequest = zarukuSeoProductionConfig.yandexSerpQueryUrlEvidenceEstimatedCostPerRequestRub;
  const estimatedCost = typeof estimatedCostPerRequest === "number"
    ? targetQueries.length * estimatedCostPerRequest
    : null;

  const rankTracking = await new YandexSerpRankSource().run({
    targetDomain: zarukuSeoProductionConfig.domain,
    targetDomainAliases: [...zarukuSeoProductionConfig.targetDomainAliases],
    keywords: targetQueries,
    region: zarukuSeoProductionConfig.targetRegion,
    language: zarukuSeoProductionConfig.language,
    device: zarukuSeoProductionConfig.targetDevice,
  });
  const queryUrlEvidence = applyYandexSerpQueryUrlEvidence({
    records: recordsForGate,
    rankChecks: rankTracking.checks,
  });
  const opportunities = generateSearchPerformanceOpportunities(queryUrlEvidence.records, {
    market: zarukuSeoProductionConfig.market,
    language: zarukuSeoProductionConfig.language,
  });
  const qualityGate = evaluateYandexSerpUrlEvidenceQualityGate({
    records: queryUrlEvidence.records,
    opportunities,
    targetDomain: zarukuSeoProductionConfig.domain,
    targetDomainAliases: [...zarukuSeoProductionConfig.targetDomainAliases],
  });

  const artifact = {
    schemaVersion: "seo_os_yandex_target_class_serp_evidence_refresh_v1",
    generatedAt: new Date().toISOString(),
    domain: zarukuSeoProductionConfig.domain,
    source: "local_review",
    historyReviewPath,
    intentReviewPath,
    targetIntentClasses: intentReview.targetIntentClasses,
    classCounts: intentReview.classCounts,
    request: {
      keywordCount: targetQueries.length,
      keywords: targetQueries,
      requestCount: targetQueries.length,
    },
    cost: {
      currency: estimatedCost === null ? null : "RUB",
      estimatedCostPerRequest,
      estimatedCost,
      note: "Request count is one Yandex Search API call per target-class keyword; unit cost is not configured in code.",
    },
    rankTracking,
    queryUrlEvidence,
    opportunityCount: opportunities.length,
    opportunities,
    qualityGate,
    sideEffects: {
      persisted: false,
      sent: false,
      productionPipelineRun: false,
      liveApiCalls: true,
    },
    notes: [
      "Local opt-in target-class SERP URL evidence refresh only.",
      "Input keywords come from TASK-041 target semantic intent classes only.",
      "Quality gate config is unchanged from TASK-040.",
      "SERP position remains separate from Yandex Webmaster averagePosition.",
      "No Firestore writes, Telegram sends, scheduler actions or production pipeline execution.",
    ],
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        outPath,
        requestCount: artifact.request.requestCount,
        rankChecks: artifact.rankTracking.checks.length,
        foundCount: artifact.rankTracking.checks.filter((check) => check.found).length,
        matchedUrlRecords: artifact.queryUrlEvidence.summary.matchedUrlRecords,
        opportunityCount: artifact.opportunityCount,
        gateStatus: artifact.qualityGate.status,
        gateSummary: artifact.qualityGate.summary,
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
