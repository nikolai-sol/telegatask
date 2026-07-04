import { describe, expect, test } from "vitest";
import expectedOpportunities from "./fixtures/searchPerformanceOpportunityEngine/expectedOpportunities.json";
import {
  parseSeoOpportunitiesJson,
  parseWeeklyTop10DryRunCliOptions,
} from "./weeklyTop10DryRunCli";

describe("weeklyTop10DryRunCli", () => {
  test("parses required script flags and optional generator config", () => {
    expect(
      parseWeeklyTop10DryRunCliOptions([
        "--team-id",
        "team-1",
        "--run-id",
        "run-1",
        "--opportunities",
        "fixtures/opportunities.json",
        "--now",
        "2026-07-03T10:00:00.000Z",
        "--max-items",
        "5",
        "--max-watchlist-items",
        "2",
        "--min-confidence-score",
        "60",
        "--stale-approved-days",
        "21",
      ])
    ).toEqual({
      teamId: "team-1",
      runId: "run-1",
      opportunitiesPath: "fixtures/opportunities.json",
      config: {
        now: "2026-07-03T10:00:00.000Z",
        maxItems: 5,
        maxWatchlistItems: 2,
        minConfidenceScore: 60,
        staleApprovedDays: 21,
      },
    });
  });

  test("rejects missing required flags", () => {
    expect(() => parseWeeklyTop10DryRunCliOptions(["--team-id", "team-1"])).toThrow(
      "Usage: runWeeklyTop10DryRun"
    );
  });

  test("parses SeoOpportunity fixture JSON", () => {
    expect(parseSeoOpportunitiesJson(JSON.stringify(expectedOpportunities))).toEqual(expectedOpportunities);
  });

  test("rejects non-opportunity JSON", () => {
    expect(() => parseSeoOpportunitiesJson(JSON.stringify([{ title: "Missing fields" }]))).toThrow(
      "Opportunities file must contain a JSON array"
    );
  });
});
