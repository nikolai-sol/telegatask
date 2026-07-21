import { describe, expect, test } from "vitest";
import reportFixture from "./fixtures/yandexOpportunityReview/wgdReport.json";
import expectedRecords from "./fixtures/yandexPopularQueriesSearchPerformance/expectedRecords.json";
import expectedReview from "./fixtures/yandexPopularQueriesSearchPerformance/expectedReview.json";
import expectedOpportunities from "./fixtures/yandexPopularQueriesSearchPerformance/expectedOpportunities.json";
import expectedQueryToPageReview from "./fixtures/yandexQueryToPageEvidenceReview/expectedReview.json";
import {
  buildYandexOpportunityReviewArtifact,
  parseYandexOpportunityReviewCliOptions,
} from "./yandexOpportunityReviewCli";

describe("yandexOpportunityReviewCli", () => {
  test("parses local review script flags", () => {
    expect(
      parseYandexOpportunityReviewCliOptions([
        "--report",
        "reports/wgd-zaruku.json",
        "--out",
        "reports/yandex-review.json",
        "--now",
        "2026-07-05T12:00:00.000Z",
        "--market",
        "RU",
        "--language",
        "ru",
      ])
    ).toEqual({
      reportPath: "reports/wgd-zaruku.json",
      outputPath: "reports/yandex-review.json",
      now: "2026-07-05T12:00:00.000Z",
      market: "RU",
      language: "ru",
    });
  });

  test("rejects missing required flags", () => {
    expect(() => parseYandexOpportunityReviewCliOptions(["--report", "reports/wgd.json"])).toThrow(
      "Usage: runYandexOpportunityReview"
    );
  });

  test("builds a local read-only Yandex opportunity review artifact from a WGD report fixture", () => {
    expect(
      buildYandexOpportunityReviewArtifact({
        report: reportFixture,
        reportPath: "fixtures/wgd-report.json",
        now: "2026-07-05T12:00:00.000Z",
        market: "RU",
        language: "ru",
      })
    ).toEqual({
      schemaVersion: "seo_os_yandex_opportunity_review_v1",
      generatedAt: "2026-07-05T12:00:00.000Z",
      sourceReportPath: "fixtures/wgd-report.json",
      runId: "run-1",
      domain: "zaruku.ru",
      sideEffects: {
        persisted: false,
        sent: false,
        productionPipelineRun: false,
      },
      input: {
        yandexQueries: 4,
        property: "https:zaruku.ru:443",
        siteUrl: "https://zaruku.ru/",
        dateRange: {
          startDate: "2026-06-26",
          endDate: "2026-07-02",
          days: 7,
        },
      },
      searchPerformance: {
        recordCount: 3,
        records: expectedRecords,
        mappingReview: expectedReview,
      },
      queryToPageEvidence: expectedQueryToPageReview,
      opportunityCount: 1,
      opportunities: expectedOpportunities,
      notes: [
        "Local review artifact only.",
        "No Firestore writes, Telegram sends, scheduler actions or production pipeline execution.",
        "Opportunity Engine thresholds are not overridden by this review script.",
        "Query-to-page evidence is reviewed locally and does not alter opportunity target URLs.",
      ],
    });
  });

  test("returns a safe zero artifact when a report has no yandexQueries", () => {
    const artifact = buildYandexOpportunityReviewArtifact({
      report: {
        run: {
          id: "run-empty",
          domain: "zaruku.ru",
          yandexWebmaster: {},
        },
      },
      reportPath: "fixtures/empty.json",
      now: "2026-07-05T12:00:00.000Z",
    });

    expect(artifact.input.yandexQueries).toBe(0);
    expect(artifact.searchPerformance.recordCount).toBe(0);
    expect(artifact.queryToPageEvidence.summary.reviewedQueries).toBe(0);
    expect(artifact.opportunityCount).toBe(0);
    expect(artifact.sideEffects).toEqual({
      persisted: false,
      sent: false,
      productionPipelineRun: false,
    });
  });
});
