import type { SeoConfidence, SeoEvidence, SeoFinding, SeoSourceStatus } from "../types";

export type { SeoEvidence, SeoFinding, SeoHarnessDraftTask as SeoDraftTask, SeoHarnessMetadata as SeoHarnessResult } from "../types";

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeEvidence(evidence: SeoEvidence[]): SeoEvidence[] {
  if (!Array.isArray(evidence)) return [];
  return evidence
    .map((item) => ({
      source: item.source,
      ...(item.metric ? { metric: cleanString(item.metric) } : {}),
      ...(item.value !== undefined ? { value: item.value } : {}),
      ...(item.url ? { url: cleanString(item.url) } : {}),
      ...(item.query ? { query: cleanString(item.query) } : {}),
      message: cleanString(item.message),
      ...(item.collectedAt !== undefined ? { collectedAt: item.collectedAt } : {}),
    }))
    .filter((item) => item.source && item.message);
}

export function hasEvidence(finding: Pick<SeoFinding, "evidence">): boolean {
  return normalizeEvidence(finding.evidence).length > 0;
}

function sourceStatus(sourceStatuses: SeoSourceStatus[], source: string): SeoSourceStatus | null {
  return sourceStatuses.find((item) => item.source === source) || null;
}

function downgrade(value: SeoConfidence): SeoConfidence {
  if (value === "high") return "medium";
  if (value === "medium") return "low";
  return "low";
}

export function confidenceFromSourceStatuses(
  sourceStatuses: SeoSourceStatus[],
  finding: Pick<SeoFinding, "category" | "confidence" | "evidence" | "title" | "description">
): SeoConfidence {
  let confidence = finding.confidence;
  const gscStatus = sourceStatus(sourceStatuses, "gsc");
  const pagespeedStatus = sourceStatus(sourceStatuses, "pagespeed");
  const crawlerStatus = sourceStatus(sourceStatuses, "crawler");

  const text = `${finding.title} ${finding.description} ${finding.category}`.toLowerCase();
  const evidenceSources = new Set(normalizeEvidence(finding.evidence).map((item) => item.source));
  const isSearchDemandFinding =
    text.includes("demand") ||
    text.includes("query") ||
    text.includes("impression") ||
    text.includes("ctr") ||
    text.includes("ranking") ||
    text.includes("search console") ||
    finding.category === "content";

  if (isSearchDemandFinding && (!gscStatus || gscStatus.status !== "success") && !evidenceSources.has("gsc")) {
    confidence = "low";
  }

  if (evidenceSources.has("pagespeed") && pagespeedStatus && pagespeedStatus.status !== "success") {
    confidence = downgrade(confidence);
  }
  if (evidenceSources.has("crawler") && crawlerStatus && crawlerStatus.status !== "success") {
    confidence = downgrade(confidence);
  }

  return confidence;
}
