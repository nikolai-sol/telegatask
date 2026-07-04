import { describe, expect, test, vi } from "vitest";
import expectedOpportunities from "./fixtures/searchPerformanceOpportunityEngine/expectedOpportunities.json";
import type { AgencyTask } from "../../types/agency";
import type { SeoDraftTask, SeoOpportunity } from "./types";
import { assembleWeeklyTop10Digest } from "./weeklyTop10Assembly";
import {
  loadWeeklyTop10AssemblySnapshot,
  WEEKLY_TOP10_SNAPSHOT_REPOSITORY_CONTRACT,
} from "./weeklyTop10SnapshotRepository";

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

describe("weeklyTop10SnapshotRepository", () => {
  test("documents the read-only repository adapter contract", () => {
    expect(WEEKLY_TOP10_SNAPSHOT_REPOSITORY_CONTRACT).toEqual({
      opportunities: {
        source: "caller_provided",
        reason: "Current opportunity generation is upstream of this boundary and has no Weekly Top-10 storage table.",
      },
      draftTasks: {
        sourceCollection: "seoDraftTasks",
        readMethod: "listSeoDraftTasksByRun",
        requiredFilters: ["teamId", "runId"],
        readFields: [
          "id",
          "teamId",
          "companyId",
          "runId",
          "domain",
          "sourceType",
          "sourceId",
          "sourceFindingId",
          "evidence",
          "labels",
          "title",
          "description",
          "priority",
          "status",
          "targetKeywords",
          "suggestedCompanyId",
          "realTaskId",
          "convertedAt",
          "convertedByUserId",
          "createdAt",
          "updatedAt",
        ],
      },
      implementationTasks: {
        sourceCollection: "agency_tasks",
        readMethod: "getAgencyTaskById",
        link: {
          seoDraftTaskField: "realTaskId",
          agencyTaskField: "id",
        },
        readFields: ["id", "teamId", "companyId", "status", "completedAt", "updatedAt"],
      },
      writeFields: [],
      notes: [
        "This adapter boundary is read-only and does not change Firestore schema.",
        "It does not persist, schedule, or send Weekly Top-10 digests.",
        "Implementation tasks are loaded only through seoDraftTasks.realTaskId links.",
        "Opportunities are provided by the caller until a dedicated opportunity storage source exists.",
      ],
    });
  });

  test("loads a weekly top-10 assembly snapshot through injected read-only readers", async () => {
    const draftTasks = [
      draftTask({
        id: "draft-1",
        title: opportunities[0].title,
        targetKeywords: opportunities[0].targetKeywords,
        evidence: opportunities[0].evidence || [],
        realTaskId: "agency-task-done",
      }),
      draftTask({
        id: "draft-2",
        title: opportunities[1].title,
        targetKeywords: opportunities[1].targetKeywords,
        evidence: opportunities[1].evidence || [],
        realTaskId: "agency-task-done",
      }),
      draftTask({
        id: "draft-3",
        title: opportunities[2].title,
        targetKeywords: opportunities[2].targetKeywords,
        evidence: opportunities[2].evidence || [],
        realTaskId: " ",
      }),
    ];
    const implementationTask = agencyTask({
      id: "agency-task-done",
      status: "done",
      completedAt: new Date("2026-07-01T12:00:00.000Z"),
    });
    const listDraftTasksByRun = vi.fn(async () => draftTasks);
    const getImplementationTaskById = vi.fn(async (id: string) => {
      if (id === "agency-task-done") return implementationTask;
      return null;
    });

    const snapshot = await loadWeeklyTop10AssemblySnapshot(
      {
        listDraftTasksByRun,
        getImplementationTaskById,
      },
      {
        teamId: "team-1",
        runId: "run-1",
        opportunities,
      }
    );

    expect(listDraftTasksByRun).toHaveBeenCalledWith({ teamId: "team-1", runId: "run-1" });
    expect(getImplementationTaskById).toHaveBeenCalledTimes(1);
    expect(getImplementationTaskById).toHaveBeenCalledWith("agency-task-done");
    expect(snapshot).toEqual({
      opportunities,
      draftTasks,
      implementationTasks: [implementationTask],
    });
    expect(snapshot.opportunities).not.toBe(opportunities);
  });

  test("returns a snapshot compatible with weekly top-10 assembly", async () => {
    const draftTasks = [
      draftTask({
        id: "draft-implemented",
        title: opportunities[0].title,
        status: "approved",
        targetKeywords: opportunities[0].targetKeywords,
        evidence: opportunities[0].evidence || [],
        realTaskId: "agency-task-done",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-10T00:00:00.000Z",
      }),
      draftTask({
        id: "draft-new",
        title: opportunities[1].title,
        status: "draft",
        targetKeywords: opportunities[1].targetKeywords,
        evidence: opportunities[1].evidence || [],
      }),
    ];
    const implementationTask = agencyTask({
      id: "agency-task-done",
      status: "done",
      completedAt: new Date("2026-07-01T12:00:00.000Z"),
    });

    const snapshot = await loadWeeklyTop10AssemblySnapshot(
      {
        listDraftTasksByRun: async () => draftTasks,
        getImplementationTaskById: async () => implementationTask,
      },
      {
        teamId: "team-1",
        runId: "run-1",
        opportunities: [opportunities[0], opportunities[1]],
      }
    );
    const result = assembleWeeklyTop10Digest({
      ...snapshot,
      config: {
        now: "2026-07-03T10:00:00.000Z",
      },
    });

    expect(result.inputs.map((input) => input.state)).toEqual(["implemented", "carried_over"]);
    expect(result.digest.items).toEqual([
      expect.objectContaining({
        state: "carried_over",
        title: "Improve GSC CTR for \"за руку\"",
      }),
    ]);
  });
});
