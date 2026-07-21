import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { zarukuSeoProductionConfig } from "../src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig";
import type { SeoSearchPerformanceRecord } from "../src/features/seoAgent/searchPerformanceNormalizer";
import { buildYandexIntentFilteredOpportunityReview } from "../src/features/seoAgent/yandexIntentFilteredOpportunityReview";

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

function requiredFlag(args: string[], name: string): string {
  const value = readFlag(args, name);
  if (!value) {
    throw new Error(
      "Usage: runYandexIntentFilteredOpportunityReview --history-review <task-038-review.json> --out <task-041-review.json>"
    );
  }
  return value;
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
  const records = readHistoryRecords(historyReviewPath);
  const intentReview = buildYandexIntentFilteredOpportunityReview({
    records,
    classifierConfig: zarukuSeoProductionConfig.semanticIntent,
    topN: zarukuSeoProductionConfig.yandexSerpQueryUrlEvidenceTopN,
    market: zarukuSeoProductionConfig.market,
    language: zarukuSeoProductionConfig.language,
  });
  const artifact = {
    schemaVersion: "seo_os_yandex_intent_filtered_opportunity_review_artifact_v1",
    generatedAt: new Date().toISOString(),
    domain: zarukuSeoProductionConfig.domain,
    source: "local_review",
    historyReviewPath,
    intentReview,
    sideEffects: {
      persisted: false,
      sent: false,
      productionPipelineRun: false,
      liveApiCalls: false,
    },
    notes: [
      "Local deterministic intent-filtered opportunity review only.",
      "Reads an existing TASK-038 artifact; does not call Yandex APIs.",
      "Competitor, drug compliance, own brand and off-mission records are excluded from opportunity generation.",
      "SERP top-N query expansion is rebuilt from target classes only.",
      "No Firestore writes, Telegram sends, scheduler actions, threshold changes or production pipeline execution.",
    ],
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        outPath,
        summary: artifact.intentReview.summary,
        classCounts: artifact.intentReview.classCounts,
        serpKeywordExpansion: artifact.intentReview.serpKeywordExpansion,
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
