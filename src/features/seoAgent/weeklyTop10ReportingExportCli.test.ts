import { describe, expect, test, vi } from "vitest";
import expectedOpportunities from "./fixtures/searchPerformanceOpportunityEngine/expectedOpportunities.json";
import type { AgencyTask } from "../../types/agency";
import type { SeoDraftTask, SeoOpportunity } from "./types";
import {
  runWeeklyTop10ReportingExport,
  WEEKLY_TOP10_REPORTING_EXPORT_CLI_CONTRACT,
} from "./weeklyTop10ReportingExportCli";

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

describe("weeklyTop10ReportingExportCli", () => {
  test("documents the reporting export CLI contract", () => {
    expect(WEEKLY_TOP10_REPORTING_EXPORT_CLI_CONTRACT).toEqual({
      mode: "dry_run",
      outputSchema: "seo_os_reporting_dashboard_export_v1",
      writes: [],
      sendsNotifications: false,
      runsProductionPipeline: false,
      notes: [
        "This boundary runs the existing Weekly Top-10 dry-run path.",
        "It converts the dry-run result to the dashboard/reporting export contract.",
        "It does not persist dashboard data.",
        "It does not send Telegram notifications.",
        "It does not run the production SEO pipeline.",
      ],
    });
  });

  test("returns dashboard export payload through injected readers without side effects", async () => {
    const draftTasks = [
      draftTask({
        id: "draft-carried",
        title: opportunities[1].title,
        status: "draft",
        targetKeywords: opportunities[1].targetKeywords,
        evidence: opportunities[1].evidence || [],
        createdAt: "2026-06-25T00:00:00.000Z",
        updatedAt: "2026-06-25T00:00:00.000Z",
      }),
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
    ];
    const listDraftTasksByRun = vi.fn(async () => draftTasks);
    const getImplementationTaskById = vi.fn(async () =>
      agencyTask({
        id: "agency-task-done",
        status: "done",
        completedAt: new Date("2026-07-01T12:00:00.000Z"),
      })
    );

    const exported = await runWeeklyTop10ReportingExport({
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
    expect(exported.schemaVersion).toBe("seo_os_reporting_dashboard_export_v1");
    expect(exported.source).toEqual({
      type: "weekly_top10_dry_run",
      mode: "dry_run",
    });
    expect(exported.teamId).toBe("team-1");
    expect(exported.runId).toBe("run-1");
    expect(exported.weeklyTop10.items).toEqual([
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
    ]);
    expect(exported.stateSummary).toEqual({
      new: 0,
      carried_over: 1,
      approved: 0,
      implemented: 1,
      rejected: 0,
    });
    expect(exported.snapshotCounts).toEqual({
      opportunities: 2,
      draftTasks: 2,
      implementationTasks: 1,
    });
    expect(exported.sideEffects).toEqual({
      persisted: false,
      sent: false,
      productionPipelineRun: false,
    });
  });
});
