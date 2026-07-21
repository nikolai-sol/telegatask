import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { zarukuSeoProductionConfig } from "../src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig";
import type { SeoOpportunity } from "../src/features/seoAgent/types";
import type { YandexSerpQueryUrlEvidenceRecord } from "../src/features/seoAgent/yandexSerpQueryUrlEvidenceMapper";
import { evaluateYandexSerpUrlEvidenceQualityGate } from "../src/features/seoAgent/yandexSerpUrlEvidenceQualityGate";

type SerpQueryUrlEvidenceReviewArtifact = {
  queryUrlEvidence?: {
    records?: YandexSerpQueryUrlEvidenceRecord[];
  };
  opportunities?: SeoOpportunity[];
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
      "Usage: runYandexSerpUrlEvidenceQualityGate --serp-review <task-039-review.json> --out <task-040-quality-gate.json>"
    );
  }
  return value;
}

function readReview(path: string): Required<SerpQueryUrlEvidenceReviewArtifact> {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as SerpQueryUrlEvidenceReviewArtifact;
  const records = parsed.queryUrlEvidence?.records;
  const opportunities = parsed.opportunities;
  if (!Array.isArray(records)) throw new Error(`No queryUrlEvidence.records found in ${path}`);
  if (!Array.isArray(opportunities)) throw new Error(`No opportunities found in ${path}`);
  return {
    queryUrlEvidence: { records },
    opportunities,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const serpReviewPath = requiredFlag(args, "--serp-review");
  const outPath = requiredFlag(args, "--out");
  const review = readReview(serpReviewPath);
  const qualityGate = evaluateYandexSerpUrlEvidenceQualityGate({
    records: review.queryUrlEvidence.records,
    opportunities: review.opportunities,
    targetDomain: zarukuSeoProductionConfig.domain,
    targetDomainAliases: [...zarukuSeoProductionConfig.targetDomainAliases],
  });
  const artifact = {
    schemaVersion: "seo_os_yandex_serp_url_evidence_quality_gate_review_v1",
    generatedAt: new Date().toISOString(),
    domain: zarukuSeoProductionConfig.domain,
    source: "local_review",
    serpReviewPath,
    qualityGate,
    sideEffects: {
      persisted: false,
      sent: false,
      productionPipelineRun: false,
      liveApiCalls: false,
    },
    notes: [
      "Local SERP URL evidence quality gate review only.",
      "Reads an existing TASK-039 artifact; does not call Yandex APIs.",
      "No task creation, approval, Firestore writes, Telegram sends or production pipeline execution.",
    ],
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        outPath,
        status: qualityGate.status,
        summary: qualityGate.summary,
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
