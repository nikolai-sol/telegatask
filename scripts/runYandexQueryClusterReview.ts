import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { zarukuSeoProductionConfig } from "../src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig";
import type { YandexSerpQueryUrlEvidenceRecord } from "../src/features/seoAgent/yandexSerpQueryUrlEvidenceMapper";
import { buildYandexQueryClusterReview } from "../src/features/seoAgent/yandexQueryClusterReview";

type SerpEvidenceRefreshArtifact = {
  queryUrlEvidence?: {
    records?: YandexSerpQueryUrlEvidenceRecord[];
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
    throw new Error("Usage: runYandexQueryClusterReview --serp-refresh <task-042.json> --out <task-043.json>");
  }
  return value;
}

function readSerpEvidenceRecords(path: string): YandexSerpQueryUrlEvidenceRecord[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as SerpEvidenceRefreshArtifact;
  const records = parsed.queryUrlEvidence?.records;
  if (!Array.isArray(records)) throw new Error(`No queryUrlEvidence.records found in ${path}`);
  return records;
}

async function main() {
  const args = process.argv.slice(2);
  const serpRefreshPath = requiredFlag(args, "--serp-refresh");
  const outPath = requiredFlag(args, "--out");
  const records = readSerpEvidenceRecords(serpRefreshPath);
  const clusterReview = buildYandexQueryClusterReview({
    records,
    classifierConfig: zarukuSeoProductionConfig.semanticIntent,
    clusterConfig: zarukuSeoProductionConfig.queryCluster,
    targetDomain: zarukuSeoProductionConfig.domain,
    targetDomainAliases: [...zarukuSeoProductionConfig.targetDomainAliases],
    market: zarukuSeoProductionConfig.market,
    language: zarukuSeoProductionConfig.language,
  });
  const artifact = {
    schemaVersion: "seo_os_yandex_query_cluster_review_artifact_v1",
    generatedAt: new Date().toISOString(),
    domain: zarukuSeoProductionConfig.domain,
    source: "local_review",
    serpRefreshPath,
    clusterReview,
    sideEffects: {
      persisted: false,
      sent: false,
      productionPipelineRun: false,
      liveApiCalls: false,
    },
    notes: [
      "Local QueryCluster v1 review only.",
      "Reads existing TASK-042 SERP evidence; does not call Yandex APIs.",
      "Opportunities are generated from cluster-level SearchPerformance records.",
      "Quality gate config is unchanged from TASK-040.",
      "No Firestore writes, Telegram sends, scheduler actions, threshold changes or production pipeline execution.",
    ],
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        outPath,
        summary: artifact.clusterReview.summary,
        gateStatus: artifact.clusterReview.qualityGate.status,
        gateSummary: artifact.clusterReview.qualityGate.summary,
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
