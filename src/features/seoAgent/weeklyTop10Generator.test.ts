import { describe, expect, test } from "vitest";
import expectedOpportunities from "./fixtures/searchPerformanceOpportunityEngine/expectedOpportunities.json";
import type { SeoOpportunity } from "./types";
import {
  DEFAULT_WEEKLY_TOP10_GENERATOR_CONFIG,
  generateWeeklyTop10Digest,
} from "./weeklyTop10Generator";

const opportunities = expectedOpportunities as SeoOpportunity[];

describe("weeklyTop10Generator", () => {
  test("generates a deterministic weekly top-10 digest without side effects", () => {
    const digest = generateWeeklyTop10Digest(
      [
        { opportunity: opportunities[0], state: "new", firstSeenAt: "2026-06-29T00:00:00.000Z" },
        { opportunity: opportunities[1], state: "carried_over", firstSeenAt: "2026-06-20T00:00:00.000Z" },
        { opportunity: opportunities[2], state: "approved", approvedAt: "2026-06-10T00:00:00.000Z" },
        { opportunity: opportunities[2], state: "rejected", firstSeenAt: "2026-06-28T00:00:00.000Z" },
        { opportunity: opportunities[0], state: "implemented", firstSeenAt: "2026-06-01T00:00:00.000Z" },
      ],
      {
        now: "2026-07-03T10:00:00.000Z",
      }
    );

    expect(digest).toEqual({
      generatedAt: "2026-07-03T10:00:00.000Z",
      items: [
        {
          rank: 0,
          state: "carried_over",
          title: "Improve GSC CTR for \"за руку\"",
          priority: "high",
          confidenceScore: 89,
          targetKeywords: ["за руку"],
          recommendedAction: "Improve title, description, and snippet intent alignment for \"за руку\".",
          evidenceCount: 1,
          sourceKeys: ["gsc:search_performance:за руку:https://zaruku.ru/"],
        },
        {
          rank: 1,
          state: "new",
          title: "Improve GSC rankings for \"рак лечение\"",
          priority: "high",
          confidenceScore: 89,
          targetKeywords: ["рак лечение"],
          recommendedAction: "Improve the page/query match for \"рак лечение\" and add internal links from relevant pages.",
          evidenceCount: 1,
          sourceKeys: ["gsc:search_performance:рак лечение:https://zaruku.ru/rak/"],
        },
      ],
      watchlist: [],
      carriedOver: [
        {
          rank: 0,
          state: "carried_over",
          title: "Improve GSC CTR for \"за руку\"",
          priority: "high",
          confidenceScore: 89,
          targetKeywords: ["за руку"],
          recommendedAction: "Improve title, description, and snippet intent alignment for \"за руку\".",
          evidenceCount: 1,
          sourceKeys: ["gsc:search_performance:за руку:https://zaruku.ru/"],
        },
      ],
      approvedStale: [
        {
          rank: 0,
          state: "approved",
          title: "Improve Yandex Webmaster rankings for \"рак лечение\"",
          priority: "medium",
          confidenceScore: 60,
          targetKeywords: ["рак лечение"],
          recommendedAction: "Improve the page/query match for \"рак лечение\" and add internal links from relevant pages.",
          evidenceCount: 1,
          sourceKeys: ["yandex_webmaster:search_performance:рак лечение"],
        },
      ],
      summary: {
        totalCandidates: 3,
        includedCount: 2,
        watchlistCount: 0,
        carriedOverCount: 1,
        approvedStaleCount: 1,
        noNewOpportunities: false,
      },
    });
  });

  test("returns no-new-opportunities digest with watchlist below confidence threshold", () => {
    const digest = generateWeeklyTop10Digest(
      [
        { opportunity: opportunities[2], state: "new", firstSeenAt: "2026-06-29T00:00:00.000Z" },
      ],
      {
        now: "2026-07-03T10:00:00.000Z",
        minConfidenceScore: 90,
      }
    );

    expect(digest.items).toEqual([]);
    expect(digest.watchlist).toEqual([
      expect.objectContaining({
        rank: 0,
        title: "Improve Yandex Webmaster rankings for \"рак лечение\"",
        confidenceScore: 60,
      }),
    ]);
    expect(digest.summary).toMatchObject({
      includedCount: 0,
      watchlistCount: 1,
      noNewOpportunities: true,
    });
    expect(DEFAULT_WEEKLY_TOP10_GENERATOR_CONFIG.maxItems).toBe(10);
  });
});
