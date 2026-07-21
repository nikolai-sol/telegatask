import { describe, expect, it } from "vitest";
import inputRecords from "./fixtures/yandexIntentFilteredOpportunityReview/inputRecords.json";
import { zarukuSeoProductionConfig } from "./production/zaruku/zarukuSeoProductionConfig";
import type { SeoSearchPerformanceRecord } from "./searchPerformanceNormalizer";
import { buildYandexIntentFilteredOpportunityReview } from "./yandexIntentFilteredOpportunityReview";

describe("buildYandexIntentFilteredOpportunityReview", () => {
  it("filters excluded intent classes before opportunity generation and SERP top-N expansion", () => {
    const review = buildYandexIntentFilteredOpportunityReview({
      records: inputRecords as SeoSearchPerformanceRecord[],
      classifierConfig: zarukuSeoProductionConfig.semanticIntent,
      topN: 5,
      market: zarukuSeoProductionConfig.market,
      language: zarukuSeoProductionConfig.language,
    });

    expect(review.classCounts.competitor_brand).toBe(1);
    expect(review.classCounts.medical_informational).toBe(1);
    expect(review.classCounts.facility_navigational).toBe(1);
    expect(review.classCounts.own_brand).toBe(1);
    expect(review.classCounts.off_mission).toBe(1);
    expect(review.monitoringBuckets.competitor_brand.map((item) => item.query)).toEqual([
      "гемотест орел победа 1",
    ]);
    expect(review.opportunitiesBeforeFilter.map((item) => item.targetKeywords[0])).toContain(
      "гемотест орел победа 1"
    );
    expect(review.opportunities.map((item) => item.targetKeywords[0])).not.toContain("гемотест орел победа 1");
    expect(review.opportunities.map((item) => item.targetKeywords[0])).toEqual([
      "подногтевая меланома фото",
      "онкологический центр в сколково адрес",
    ]);
    expect(review.serpKeywordExpansion.topQueryKeywords).toEqual([
      "подногтевая меланома фото",
      "онкологический центр в сколково адрес",
    ]);
    expect(review.serpKeywordExpansion.requestCount).toBe(2);
  });
});
