import { describe, expect, it } from "vitest";
import expectedReport from "./fixtures/yandexSerpUrlEvidenceQualityGate/expectedReport.json";
import inputReview from "./fixtures/yandexSerpUrlEvidenceQualityGate/inputReview.json";
import type { SeoOpportunity } from "./types";
import type { YandexSerpQueryUrlEvidenceRecord } from "./yandexSerpQueryUrlEvidenceMapper";
import { evaluateYandexSerpUrlEvidenceQualityGate } from "./yandexSerpUrlEvidenceQualityGate";

describe("evaluateYandexSerpUrlEvidenceQualityGate", () => {
  it("produces a read-only quality gate report from SERP URL evidence fixtures", () => {
    const report = evaluateYandexSerpUrlEvidenceQualityGate({
      records: inputReview.queryUrlEvidence.records as YandexSerpQueryUrlEvidenceRecord[],
      opportunities: inputReview.opportunities as SeoOpportunity[],
      targetDomain: "zaruku.ru",
      targetDomainAliases: ["www.zaruku.ru"],
    });

    expect(report).toEqual(expectedReport);
  });

  it("marks mismatched SERP domains as blocked", () => {
    const mismatchedRecords = [
      {
        ...(inputReview.queryUrlEvidence.records[0] as YandexSerpQueryUrlEvidenceRecord),
        page: "https://example.com/page/",
        serpUrlEvidence: {
          ...(inputReview.queryUrlEvidence.records[0] as YandexSerpQueryUrlEvidenceRecord).serpUrlEvidence!,
          matchedUrl: "https://example.com/page/",
        },
      },
    ];
    const report = evaluateYandexSerpUrlEvidenceQualityGate({
      records: mismatchedRecords,
      opportunities: [],
      targetDomain: "zaruku.ru",
    });

    expect(report.status).toBe("blocked");
    expect(report.summary.mismatchedDomainRecords).toBe(1);
    expect(report.checks.find((check) => check.name === "matched_url_domain")?.status).toBe("fail");
  });

  it("can be marked ready by explicit gate config without changing opportunity thresholds", () => {
    const report = evaluateYandexSerpUrlEvidenceQualityGate({
      records: inputReview.queryUrlEvidence.records as YandexSerpQueryUrlEvidenceRecord[],
      opportunities: inputReview.opportunities as SeoOpportunity[],
      targetDomain: "zaruku.ru",
      config: {
        minRecordUrlCoverageRatio: 0.3,
        minOpportunityUrlCoverageRatio: 0.5,
      },
    });

    expect(report.status).toBe("ready");
  });
});
