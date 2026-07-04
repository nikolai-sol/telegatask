import { describe, expect, test } from "vitest";
import expectedOpportunities from "./fixtures/searchPerformanceOpportunityEngine/expectedOpportunities.json";
import type { AgencyTask } from "../../types/agency";
import type { SeoDraftTask, SeoOpportunity } from "./types";
import {
  applyWeeklyTop10ImplementationState,
  WEEKLY_TOP10_IMPLEMENTATION_STATE_STORAGE_CONTRACT,
} from "./weeklyTop10ImplementationStateSource";
import type { WeeklyTop10OpportunityInput } from "./weeklyTop10Generator";

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
    status: "approved",
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

describe("weeklyTop10ImplementationStateSource", () => {
  test("documents the read-only implementation-state storage contract over agency_tasks", () => {
    expect(WEEKLY_TOP10_IMPLEMENTATION_STATE_STORAGE_CONTRACT).toEqual({
      sourceCollection: "agency_tasks",
      link: {
        seoDraftTaskField: "realTaskId",
        agencyTaskField: "id",
      },
      readFields: ["id", "teamId", "companyId", "status", "completedAt", "updatedAt"],
      writeFields: [],
      implementationStatusAvailable: true,
      implementedStatus: "done",
      notes: [
        "This boundary is read-only and does not change Firestore schema.",
        "SEO draft tasks link to implementation tasks through realTaskId.",
        "Only agency_tasks with status done prove implementation.",
        "convertedAt alone still does not prove implementation.",
      ],
    });
  });

  test("marks a weekly top-10 input as implemented only when linked agency task is done", () => {
    const weeklyInputs: WeeklyTop10OpportunityInput[] = [
      {
        opportunity: opportunities[0],
        state: "approved",
        firstSeenAt: "2026-06-18T00:00:00.000Z",
        approvedAt: "2026-06-21T00:00:00.000Z",
        implementedAt: null,
      },
    ];

    const inputs = applyWeeklyTop10ImplementationState({
      weeklyInputs,
      draftTasks: [
        draftTask({
          id: "draft-implemented",
          title: opportunities[0].title,
          targetKeywords: opportunities[0].targetKeywords,
          evidence: opportunities[0].evidence || [],
          realTaskId: "agency-task-done",
          convertedAt: "2026-06-22T00:00:00.000Z",
        }),
      ],
      implementationTasks: [
        agencyTask({
          id: "agency-task-done",
          status: "done",
          completedAt: new Date("2026-07-01T12:00:00.000Z"),
          updatedAt: new Date("2026-07-01T12:01:00.000Z"),
        }),
      ],
    });

    expect(inputs).toEqual([
      {
        ...weeklyInputs[0],
        state: "implemented",
        implementedAt: "2026-07-01T12:00:00.000Z",
      },
    ]);
    expect(weeklyInputs[0].state).toBe("approved");
  });

  test("does not infer implementation from converted draft task without done agency task", () => {
    const weeklyInputs: WeeklyTop10OpportunityInput[] = [
      {
        opportunity: opportunities[1],
        state: "approved",
        firstSeenAt: "2026-06-18T00:00:00.000Z",
        approvedAt: "2026-06-21T00:00:00.000Z",
        implementedAt: null,
      },
    ];

    const inputs = applyWeeklyTop10ImplementationState({
      weeklyInputs,
      draftTasks: [
        draftTask({
          id: "draft-converted",
          title: opportunities[1].title,
          targetKeywords: opportunities[1].targetKeywords,
          evidence: opportunities[1].evidence || [],
          realTaskId: "agency-task-open",
          convertedAt: "2026-06-22T00:00:00.000Z",
        }),
      ],
      implementationTasks: [
        agencyTask({
          id: "agency-task-open",
          status: "in_progress",
          updatedAt: new Date("2026-07-01T12:01:00.000Z"),
        }),
      ],
    });

    expect(inputs).toEqual(weeklyInputs);
  });
});
