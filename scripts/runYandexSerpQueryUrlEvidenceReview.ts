import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { YandexSerpRankSource } from "../src/features/seoAgent/providers/yandexSerpRankSource";
import { zarukuSeoProductionConfig } from "../src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig";
import type { SeoSearchPerformanceRecord } from "../src/features/seoAgent/searchPerformanceNormalizer";
import { generateSearchPerformanceOpportunities } from "../src/features/seoAgent/searchPerformanceOpportunityEngine";
import { applyYandexSerpQueryUrlEvidence } from "../src/features/seoAgent/yandexSerpQueryUrlEvidenceMapper";
import {
  classifyYandexSearchPerformanceRecords,
  selectTargetSerpTopQueryKeywords,
} from "../src/features/seoAgent/yandexIntentFilteredOpportunityReview";

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
      "Usage: runYandexSerpQueryUrlEvidenceReview --history-review <task-038-review.json> --out <task-039-review.json> --enable-serp-query-url-evidence"
    );
  }
  return value;
}

function uniqueClean(values: unknown[]): string[] {
  return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function readHistoryRecords(path: string): SeoSearchPerformanceRecord[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as QueryHistoryReviewArtifact;
  const records = parsed.searchPerformance?.records;
  if (!Array.isArray(records)) {
    throw new Error(`No searchPerformance.records found in ${path}`);
  }
  return records;
}

async function main() {
  const args = process.argv.slice(2);
  const historyReviewPath = requiredFlag(args, "--history-review");
  const outPath = requiredFlag(args, "--out");
  const enabledByCli = hasFlag(args, "--enable-serp-query-url-evidence");
  if (!enabledByCli) {
    throw new Error("SERP query URL evidence review is opt-in. Pass --enable-serp-query-url-evidence to run live SERP checks.");
  }

  const records = readHistoryRecords(historyReviewPath);
  const topN = zarukuSeoProductionConfig.yandexSerpQueryUrlEvidenceTopN;
  const baseKeywords = uniqueClean([...zarukuSeoProductionConfig.trackingKeywords]);
  const classifiedRecords = classifyYandexSearchPerformanceRecords({
    records,
    classifierConfig: zarukuSeoProductionConfig.semanticIntent,
  });
  const queryKeywords = selectTargetSerpTopQueryKeywords({
    classifiedRecords,
    topN,
  });
  const excludedTopQueryCandidateCount = classifiedRecords
    .slice(0, topN)
    .filter((item) => !item.classification.isTarget).length;
  const expandedKeywords = uniqueClean([...baseKeywords, ...queryKeywords]);
  const estimatedCostPerRequest = zarukuSeoProductionConfig.yandexSerpQueryUrlEvidenceEstimatedCostPerRequestRub;
  const estimatedCost = typeof estimatedCostPerRequest === "number"
    ? expandedKeywords.length * estimatedCostPerRequest
    : null;

  const rankTracking = await new YandexSerpRankSource().run({
    targetDomain: zarukuSeoProductionConfig.domain,
    targetDomainAliases: [...zarukuSeoProductionConfig.targetDomainAliases],
    keywords: expandedKeywords,
    region: zarukuSeoProductionConfig.targetRegion,
    language: zarukuSeoProductionConfig.language,
    device: zarukuSeoProductionConfig.targetDevice,
  });
  const queryUrlEvidence = applyYandexSerpQueryUrlEvidence({
    records,
    rankChecks: rankTracking.checks,
  });
  const evidenceClassifiedRecords = classifyYandexSearchPerformanceRecords({
    records: queryUrlEvidence.records,
    classifierConfig: zarukuSeoProductionConfig.semanticIntent,
  });
  const opportunityRecords = evidenceClassifiedRecords
    .filter((item) => item.classification.isTarget)
    .map((item) => item.record);
  const opportunities = generateSearchPerformanceOpportunities(opportunityRecords, {
    market: zarukuSeoProductionConfig.market,
    language: zarukuSeoProductionConfig.language,
  });
  const generatedAt = new Date().toISOString();
  const artifact = {
    schemaVersion: "seo_os_yandex_serp_query_url_evidence_review_v1",
    generatedAt,
    domain: zarukuSeoProductionConfig.domain,
    source: "yandex_serp_rank",
    searchEngine: "yandex",
    configuredExpansionEnabled: zarukuSeoProductionConfig.yandexSerpQueryUrlEvidenceEnabled,
    expansionEnabledByCli: enabledByCli,
    topN,
    historyReviewPath,
    keywordExpansion: {
      baseKeywordCount: baseKeywords.length,
      topQueryKeywordCount: queryKeywords.length,
      expandedKeywordCount: expandedKeywords.length,
      baseKeywords,
      topQueryKeywords: queryKeywords,
      expandedKeywords,
      requestCount: expandedKeywords.length,
      intentFiltering: {
        targetIntentClasses: [...zarukuSeoProductionConfig.semanticIntent.targetIntentClasses],
        excludedTopQueryCandidateCount,
        note: "Top query expansion is filtered to target semantic intent classes before live SERP requests.",
      },
    },
    cost: {
      currency: estimatedCost === null ? null : "RUB",
      estimatedCostPerRequest,
      estimatedCost,
      note: "Request count is one Yandex Search API call per expanded keyword; unit cost is not configured in code.",
    },
    rankTracking,
    queryUrlEvidence,
    intentFiltering: {
      targetIntentClasses: [...zarukuSeoProductionConfig.semanticIntent.targetIntentClasses],
      classifiedQueryRecords: evidenceClassifiedRecords.length,
      opportunityInputRecords: opportunityRecords.length,
      excludedQueryRecords: Math.max(0, evidenceClassifiedRecords.length - opportunityRecords.length),
      classCounts: evidenceClassifiedRecords.reduce<Record<string, number>>((acc, item) => {
        acc[item.classification.intentClass] = (acc[item.classification.intentClass] || 0) + 1;
        return acc;
      }, {}),
    },
    opportunityCount: opportunities.length,
    opportunities,
    sideEffects: {
      persisted: false,
      sent: false,
      productionPipelineRun: false,
    },
    notes: [
      "Local opt-in SERP query-to-URL evidence review only.",
      "Production pipeline defaults are unchanged; config toggle remains false.",
      "SERP-derived position is not merged with Yandex Webmaster averagePosition.",
      "No Firestore writes, Telegram sends, scheduler actions or production pipeline execution.",
    ],
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        outPath,
        expandedKeywordCount: artifact.keywordExpansion.expandedKeywordCount,
        requestCount: artifact.keywordExpansion.requestCount,
        rankChecks: artifact.rankTracking.checks.length,
        foundCount: artifact.rankTracking.checks.filter((check) => check.found).length,
        matchedUrlRecords: artifact.queryUrlEvidence.summary.matchedUrlRecords,
        opportunityCount: artifact.opportunityCount,
        estimatedCost: artifact.cost.estimatedCost,
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
