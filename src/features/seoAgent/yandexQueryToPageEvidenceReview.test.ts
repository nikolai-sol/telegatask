import { describe, expect, test } from "vitest";
import inputRecords from "./fixtures/yandexPopularQueriesSearchPerformance/expectedRecords.json";
import inputRankChecks from "./fixtures/yandexQueryToPageEvidenceReview/inputRankChecks.json";
import inputPage from "./fixtures/yandexQueryToPageEvidenceReview/inputPage.json";
import expectedReview from "./fixtures/yandexQueryToPageEvidenceReview/expectedReview.json";
import type { SeoSearchPerformanceRecord } from "./searchPerformanceNormalizer";
import type { YandexRankCheck } from "./types";
import { reviewYandexQueryToPageEvidence } from "./yandexQueryToPageEvidenceReview";

describe("yandexQueryToPageEvidenceReview", () => {
  test("builds a fixture-backed local query-to-page evidence review", () => {
    expect(
      reviewYandexQueryToPageEvidence({
        records: inputRecords as SeoSearchPerformanceRecord[],
        rankChecks: inputRankChecks as YandexRankCheck[],
        page: inputPage,
      })
    ).toEqual(expectedReview);
  });

  test("ignores non-Yandex query records", () => {
    const review = reviewYandexQueryToPageEvidence({
      records: [
        {
          ...inputRecords[0],
          source: "gsc",
          searchEngine: "google",
        } as SeoSearchPerformanceRecord,
        {
          ...inputRecords[0],
          dimension: "summary",
          query: null,
          key: null,
        } as SeoSearchPerformanceRecord,
      ],
      rankChecks: inputRankChecks as YandexRankCheck[],
      page: inputPage,
    });

    expect(review.summary.reviewedQueries).toBe(0);
    expect(review.items).toEqual([]);
  });

  test("does not infer URLs when rank and page evidence are missing", () => {
    const review = reviewYandexQueryToPageEvidence({
      records: [inputRecords[0] as SeoSearchPerformanceRecord],
      rankChecks: [],
      page: null,
    });

    expect(review.items[0]).toEqual(expect.objectContaining({
      candidateUrl: null,
      confidence: "none",
      missingEvidence: [
        "No exact Yandex SERP rank check for this query.",
        "No exact homepage snapshot text match for this query.",
      ],
    }));
  });
});
