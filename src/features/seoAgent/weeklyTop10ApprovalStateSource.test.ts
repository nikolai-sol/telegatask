import { describe, expect, test } from "vitest";
import expectedOpportunities from "./fixtures/searchPerformanceOpportunityEngine/expectedOpportunities.json";
import type { SeoDraftTask, SeoOpportunity } from "./types";
import {
  WEEKLY_TOP10_APPROVAL_STATE_STORAGE_CONTRACT,
  buildWeeklyTop10InputsFromApprovalState,
} from "./weeklyTop10ApprovalStateSource";

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

describe("weeklyTop10ApprovalStateSource", () => {
  test("documents the read-only storage contract over existing seoDraftTasks fields", () => {
    expect(WEEKLY_TOP10_APPROVAL_STATE_STORAGE_CONTRACT).toEqual({
      sourceCollection: "seoDraftTasks",
      readFields: [
        "id",
        "sourceId",
        "sourceFindingId",
        "title",
        "status",
        "targetKeywords",
        "evidence",
        "realTaskId",
        "convertedAt",
        "createdAt",
        "updatedAt",
      ],
      writeFields: [],
      implementationStatusAvailable: false,
      notes: [
        "This boundary is read-only and does not change Firestore schema.",
        "Draft task status is the current approval-state source.",
        "convertedAt only means a real task was created; it does not prove implementation.",
        "implemented state requires a future explicit implementation source.",
      ],
    });
  });

  test("maps existing draft task status into weekly top-10 opportunity state", () => {
    const inputs = buildWeeklyTop10InputsFromApprovalState({
      opportunities,
      draftTasks: [
        draftTask({
          id: "draft-carried",
          title: opportunities[0].title,
          status: "draft",
          targetKeywords: opportunities[0].targetKeywords,
          createdAt: "2026-06-25T00:00:00.000Z",
          updatedAt: "2026-06-25T00:00:00.000Z",
          evidence: opportunities[0].evidence || [],
        }),
        draftTask({
          id: "draft-approved",
          title: opportunities[1].title,
          status: "approved",
          targetKeywords: opportunities[1].targetKeywords,
          createdAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-21T00:00:00.000Z",
          realTaskId: "agency-task-1",
          convertedAt: "2026-06-22T00:00:00.000Z",
          evidence: opportunities[1].evidence || [],
        }),
        draftTask({
          id: "draft-rejected",
          title: opportunities[2].title,
          status: "rejected",
          targetKeywords: opportunities[2].targetKeywords,
          createdAt: "2026-06-19T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
          evidence: opportunities[2].evidence || [],
        }),
      ],
    });

    expect(inputs).toEqual([
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
        firstSeenAt: "2026-06-18T00:00:00.000Z",
        approvedAt: "2026-06-21T00:00:00.000Z",
        implementedAt: null,
      },
      {
        opportunity: opportunities[2],
        state: "rejected",
        firstSeenAt: "2026-06-19T00:00:00.000Z",
        approvedAt: null,
        implementedAt: null,
      },
    ]);
  });

  test("marks opportunities without matching draft task as new", () => {
    const inputs = buildWeeklyTop10InputsFromApprovalState({
      opportunities: [opportunities[0]],
      draftTasks: [],
    });

    expect(inputs).toEqual([
      {
        opportunity: opportunities[0],
        state: "new",
        firstSeenAt: null,
        approvedAt: null,
        implementedAt: null,
      },
    ]);
  });
});
