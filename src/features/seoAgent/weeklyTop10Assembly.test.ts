import { describe, expect, test } from "vitest";
import expectedOpportunities from "./fixtures/searchPerformanceOpportunityEngine/expectedOpportunities.json";
import type { AgencyTask } from "../../types/agency";
import type { SeoDraftTask, SeoOpportunity } from "./types";
import { assembleWeeklyTop10Digest } from "./weeklyTop10Assembly";

const opportunities = expectedOpportunities as SeoOpportunity[];

function draftTask(overrides: Partial<SeoDraftTask>): SeoDraftTask {
  return {
    id: "draft-1",
    teamId: "team-1",
    companyId: "company-1",
    runId: "run-1",
    domain: "zaruku.ru",
    sourceType: "opportunity",
    sourceId: null,
    sourceFindingId: null,
    evidence: [],
    labels: [],
    title: "Draft",
    description: "Draft description",
    priority: "normal",
    status: "draft",
    targetKeywords: [],
    suggestedCompanyId: "company-1",
    realTaskId: null,
    convertedAt: null,
    convertedByUserId: null,
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...overrides,
  };
}

function agencyTask(overrides: Partial<AgencyTask>): AgencyTask {
  return {
    id: "agency-task-1",
    teamId: "team-1",
    companyId: "company-1",
    visibility: "team",
    assignedTo: "user-1",
    createdBy: "user-1",
    title: "Agency task",
    description: "Agency task description",
    status: "todo",
    priority: "normal",
    isFire: false,
    createdAt: new Date("2026-06-22T00:00:00.000Z"),
    updatedAt: new Date("2026-06-22T00:00:00.000Z"),
    ...overrides,
  };
}

describe("weeklyTop10Assembly", () => {
  test("assembles approval state, implementation state, and weekly digest without side effects", () => {
    const result = assembleWeeklyTop10Digest({
      opportunities,
      draftTasks: [
        draftTask({
          id: "draft-carried",
          title: opportunities[0].title,
          status: "draft",
          targetKeywords: opportunities[0].targetKeywords,
          evidence: opportunities[0].evidence || [],
          createdAt: "2026-06-25T00:00:00.000Z",
          updatedAt: "2026-06-25T00:00:00.000Z",
        }),
        draftTask({
          id: "draft-approved",
          title: opportunities[1].title,
          status: "approved",
          targetKeywords: opportunities[1].targetKeywords,
          evidence: opportunities[1].evidence || [],
          realTaskId: "agency-task-open",
          convertedAt: "2026-06-22T00:00:00.000Z",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-10T00:00:00.000Z",
        }),
        draftTask({
          id: "draft-implemented",
          title: opportunities[2].title,
          status: "approved",
          targetKeywords: opportunities[2].targetKeywords,
          evidence: opportunities[2].evidence || [],
          realTaskId: "agency-task-done",
          convertedAt: "2026-06-22T00:00:00.000Z",
          createdAt: "2026-06-02T00:00:00.000Z",
          updatedAt: "2026-06-11T00:00:00.000Z",
        }),
      ],
      implementationTasks: [
        agencyTask({
          id: "agency-task-open",
          status: "in_progress",
          updatedAt: new Date("2026-07-01T12:01:00.000Z"),
        }),
        agencyTask({
          id: "agency-task-done",
          status: "done",
          completedAt: new Date("2026-07-01T12:00:00.000Z"),
          updatedAt: new Date("2026-07-01T12:01:00.000Z"),
        }),
      ],
      config: {
        now: "2026-07-03T10:00:00.000Z",
      },
    });

    expect(result.inputs).toEqual([
      {
        opportunity: opportunities[0],
        state: "carried_over",
        firstSeenAt: "2026-06-25T00:00:00.000Z",
        approvedAt: null,
        implementedAt: null,
      },
      {
        opportunity: opportunities[1],
        state: "approved",
        firstSeenAt: "2026-06-01T00:00:00.000Z",
        approvedAt: "2026-06-10T00:00:00.000Z",
        implementedAt: null,
      },
      {
        opportunity: opportunities[2],
        state: "implemented",
        firstSeenAt: "2026-06-02T00:00:00.000Z",
        approvedAt: "2026-06-11T00:00:00.000Z",
        implementedAt: "2026-07-01T12:00:00.000Z",
      },
    ]);

    expect(result.digest).toEqual({
      generatedAt: "2026-07-03T10:00:00.000Z",
      items: [
        {
          rank: 0,
          state: "carried_over",
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
          title: "Improve GSC rankings for \"рак лечение\"",
          priority: "high",
          confidenceScore: 89,
          targetKeywords: ["рак лечение"],
          recommendedAction: "Improve the page/query match for \"рак лечение\" and add internal links from relevant pages.",
          evidenceCount: 1,
          sourceKeys: ["gsc:search_performance:рак лечение:https://zaruku.ru/rak/"],
        },
      ],
      approvedStale: [
        {
          rank: 0,
          state: "approved",
          title: "Improve GSC CTR for \"за руку\"",
          priority: "high",
          confidenceScore: 89,
          targetKeywords: ["за руку"],
          recommendedAction: "Improve title, description, and snippet intent alignment for \"за руку\".",
          evidenceCount: 1,
          sourceKeys: ["gsc:search_performance:за руку:https://zaruku.ru/"],
        },
      ],
      summary: {
        totalCandidates: 2,
        includedCount: 1,
        watchlistCount: 0,
        carriedOverCount: 1,
        approvedStaleCount: 1,
        noNewOpportunities: true,
      },
    });
  });

  test("keeps unmatched opportunities new when no state sources are provided", () => {
    const result = assembleWeeklyTop10Digest({
      opportunities: [opportunities[0]],
      draftTasks: [],
      implementationTasks: [],
      config: {
        now: "2026-07-03T10:00:00.000Z",
      },
    });

    expect(result.inputs).toEqual([
      {
        opportunity: opportunities[0],
        state: "new",
        firstSeenAt: null,
        approvedAt: null,
        implementedAt: null,
      },
    ]);
    expect(result.digest.items).toEqual([
      expect.objectContaining({
        rank: 0,
        state: "new",
        title: "Improve GSC rankings for \"рак лечение\"",
      }),
    ]);
  });
});
