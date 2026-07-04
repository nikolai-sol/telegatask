import { describe, expect, test } from "vitest";
import inputRecords from "./fixtures/searchPerformanceOpportunityEngine/inputRecords.json";
import expectedOpportunities from "./fixtures/searchPerformanceOpportunityEngine/expectedOpportunities.json";
import type { SeoSearchPerformanceRecord } from "./searchPerformanceNormalizer";
import {
  DEFAULT_SEARCH_PERFORMANCE_OPPORTUNITY_CONFIG,
  generateSearchPerformanceOpportunities,
} from "./searchPerformanceOpportunityEngine";

describe("searchPerformanceOpportunityEngine", () => {
  test("generates fixture-based golden opportunities from normalized search performance records", () => {
    const opportunities = generateSearchPerformanceOpportunities(inputRecords as SeoSearchPerformanceRecord[], {
      market: "RU",
      language: "ru",
    });

    expect(opportunities).toEqual(expectedOpportunities);
  });

  test("uses configurable thresholds without changing input records", () => {
    const opportunities = generateSearchPerformanceOpportunities(inputRecords as SeoSearchPerformanceRecord[], {
      market: "RU",
      language: "ru",
      thresholds: {
        minEvidenceImpressions: 450,
      },
    });

    expect(opportunities).toEqual([
      expectedOpportunities[0],
    ]);
    expect(DEFAULT_SEARCH_PERFORMANCE_OPPORTUNITY_CONFIG.thresholds.minEvidenceImpressions).toBe(100);
  });
});
