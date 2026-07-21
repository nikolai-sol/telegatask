import { describe, expect, test } from "vitest";
import inputYandexQueries from "./fixtures/yandexPopularQueriesSearchPerformance/inputYandexQueries.json";
import expectedRecords from "./fixtures/yandexPopularQueriesSearchPerformance/expectedRecords.json";
import expectedReview from "./fixtures/yandexPopularQueriesSearchPerformance/expectedReview.json";
import expectedOpportunities from "./fixtures/yandexPopularQueriesSearchPerformance/expectedOpportunities.json";
import { generateSearchPerformanceOpportunities } from "./searchPerformanceOpportunityEngine";
import {
  mapYandexPopularQueriesToSearchPerformanceRecords,
  reviewYandexPopularQueriesSearchPerformanceMapping,
  type YandexPopularQueriesSearchPerformanceInput,
} from "./yandexPopularQueriesSearchPerformanceMapper";

const fixtureInput: YandexPopularQueriesSearchPerformanceInput = {
  queries: inputYandexQueries,
  property: "https:zaruku.ru:443",
  siteUrl: "https://zaruku.ru/",
  dateRange: {
    startDate: "2026-06-26",
    endDate: "2026-07-02",
    days: 7,
  },
};

describe("yandexPopularQueriesSearchPerformanceMapper", () => {
  test("maps metric-rich Yandex popular queries to official SearchPerformance query records", () => {
    expect(mapYandexPopularQueriesToSearchPerformanceRecords(fixtureInput)).toEqual(expectedRecords);
  });

  test("returns a read-only review summary without changing Opportunity Engine thresholds", () => {
    expect(reviewYandexPopularQueriesSearchPerformanceMapping(fixtureInput)).toEqual(expectedReview);
  });

  test("keeps mapped records compatible with the existing Opportunity Engine default thresholds", () => {
    const records = mapYandexPopularQueriesToSearchPerformanceRecords(fixtureInput);

    expect(
      generateSearchPerformanceOpportunities(records, {
        market: "RU",
        language: "ru",
      })
    ).toEqual(expectedOpportunities);
  });
});
