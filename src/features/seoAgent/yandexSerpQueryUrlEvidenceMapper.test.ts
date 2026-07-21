import { describe, expect, it } from "vitest";
import expectedReview from "./fixtures/yandexSerpQueryUrlEvidence/expectedReview.json";
import inputRankChecks from "./fixtures/yandexSerpQueryUrlEvidence/inputRankChecks.json";
import inputRecords from "./fixtures/yandexPopularQueriesSearchPerformance/expectedRecords.json";
import type { SeoSearchPerformanceRecord } from "./searchPerformanceNormalizer";
import type { YandexRankCheck } from "./types";
import { applyYandexSerpQueryUrlEvidence } from "./yandexSerpQueryUrlEvidenceMapper";

describe("applyYandexSerpQueryUrlEvidence", () => {
  it("populates URL evidence from exact Yandex SERP rank checks without changing Webmaster average position", () => {
    const review = applyYandexSerpQueryUrlEvidence({
      records: inputRecords as SeoSearchPerformanceRecord[],
      rankChecks: inputRankChecks as YandexRankCheck[],
    });

    expect(review).toEqual(expectedReview);
    expect(review.records[0].averagePosition).toBe(9.4);
    expect(review.records[0].serpUrlEvidence?.serpPosition).toBe(9);
  });

  it("does not apply SERP URL evidence to non-Yandex-Webmaster query records", () => {
    const review = applyYandexSerpQueryUrlEvidence({
      records: [
        {
          ...(inputRecords[0] as SeoSearchPerformanceRecord),
          source: "gsc",
          searchEngine: "google",
          page: null,
        },
      ],
      rankChecks: inputRankChecks as YandexRankCheck[],
    });

    expect(review.summary.eligibleQueryRecords).toBe(0);
    expect(review.summary.matchedUrlRecords).toBe(0);
    expect(review.records[0].page).toBeNull();
    expect(review.records[0].serpUrlEvidence).toBeUndefined();
  });
});
