import { describe, expect, test, vi } from "vitest";
import expectedOpportunities from "./fixtures/searchPerformanceOpportunityEngine/expectedOpportunities.json";
import type { AgencyTask } from "../../types/agency";
import type { SeoDraftTask, SeoOpportunity } from "./types";
import {
  runWeeklyTop10DryRun,
  WEEKLY_TOP10_DRY_RUN_SERVICE_CONTRACT,
} from "./weeklyTop10DryRunService";

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

describe("weeklyTop10DryRunService", () => {
  test("documents the dry-run service contract", () => {
    expect(WEEKLY_TOP10_DRY_RUN_SERVICE_CONTRACT).toEqual({
      mode: "dry_run",
      requiresInjectedReaders: true,
      writes: [],
      sendsNotifications: false,
      runsProductionPipeline: false,
      notes: [
        "This boundary loads snapshots through injected readers only.",
        "It assembles and returns a Weekly Top-10 digest without persistence.",
        "It does not send Telegram notifications.",
        "It does not run the production SEO pipeline.",
      ],
    });
  });

  test("returns a dry-run digest through injected readers without side effects", async () => {
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
        id: "draft-carried",
        title: opportunities[1].title,
        status: "draft",
        targetKeywords: opportunities[1].targetKeywords,
        evidence: opportunities[1].evidence || [],
        createdAt: "2026-06-25T00:00:00.000Z",
        updatedAt: "2026-06-25T00:00:00.000Z",
      }),
    ];
    const implementationTask = agencyTask({
      id: "agency-task-done",
      status: "done",
      completedAt: new Date("2026-07-01T12:00:00.000Z"),
    });
    const listDraftTasksByRun = vi.fn(async () => draftTasks);
    const getImplementationTaskById = vi.fn(async () => implementationTask);

    const result = await runWeeklyTop10DryRun({
      teamId: "team-1",
      runId: "run-1",
      opportunities: [opportunities[0], opportunities[1]],
      readers: {
        listDraftTasksByRun,
        getImplementationTaskById,
      },
      config: {
        now: "2026-07-03T10:00:00.000Z",
      },
    });

    expect(listDraftTasksByRun).toHaveBeenCalledWith({ teamId: "team-1", runId: "run-1" });
    expect(getImplementationTaskById).toHaveBeenCalledWith("agency-task-done");
    expect(result).toEqual({
      mode: "dry_run",
      teamId: "team-1",
      runId: "run-1",
      inputs: [
        {
          opportunity: opportunities[0],
          state: "implemented",
          firstSeenAt: "2026-06-01T00:00:00.000Z",
          approvedAt: "2026-06-10T00:00:00.000Z",
          implementedAt: "2026-07-01T12:00:00.000Z",
        },
        {
          opportunity: opportunities[1],
          state: "carried_over",
          firstSeenAt: "2026-06-25T00:00:00.000Z",
          approvedAt: null,
          implementedAt: null,
        },
      ],
      digest: {
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
        approvedStale: [],
        summary: {
          totalCandidates: 1,
          includedCount: 1,
          watchlistCount: 0,
          carriedOverCount: 1,
          approvedStaleCount: 0,
          noNewOpportunities: true,
        },
      },
      snapshotCounts: {
        opportunities: 2,
        draftTasks: 2,
        implementationTasks: 1,
      },
      sideEffects: {
        persisted: false,
        sent: false,
        productionPipelineRun: false,
      },
    });
  });
});
