import { describe, expect, test } from "vitest";
import inputRecords from "./fixtures/yandexPopularQueriesSearchPerformance/expectedRecords.json";
import inputInventoryUrls from "./fixtures/yandexPageInventoryEvidenceReview/inputInventoryUrls.json";
import expectedReview from "./fixtures/yandexPageInventoryEvidenceReview/expectedReview.json";
import type { SeoSearchPerformanceRecord } from "./searchPerformanceNormalizer";
import { reviewYandexPageInventoryEvidence } from "./yandexPageInventoryEvidenceReview";

describe("yandexPageInventoryEvidenceReview", () => {
  test("builds a fixture-backed page inventory evidence review without fuzzy matching", () => {
    expect(
      reviewYandexPageInventoryEvidence({
        records: inputRecords as SeoSearchPerformanceRecord[],
        inventoryUrls: inputInventoryUrls,
      })
    ).toEqual(expectedReview);
  });

  test("ignores non-Yandex query records", () => {
    const review = reviewYandexPageInventoryEvidence({
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
      inventoryUrls: inputInventoryUrls,
    });

    expect(review.summary.reviewedQueries).toBe(0);
    expect(review.items).toEqual([]);
  });

  test("does not infer candidate URLs from transliterated inventory URLs", () => {
    const review = reviewYandexPageInventoryEvidence({
      records: [inputRecords[1] as SeoSearchPerformanceRecord],
      inventoryUrls: ["https://zaruku.ru/melanoma/podnogtevaya-melanoma-foto/"],
    });

    expect(review.items[0]).toEqual(expect.objectContaining({
      query: "подногтевая меланома фото",
      candidateUrl: null,
      confidence: "none",
    }));
  });
});
