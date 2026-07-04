import { describe, expect, test } from "vitest";
import type { WeeklyTop10Digest } from "./weeklyTop10Generator";
import {
  buildWeeklyTop10ApprovalCandidates,
  WEEKLY_TOP10_PERSISTENCE_DECISION_CONTRACT,
} from "./weeklyTop10PersistenceDecision";

function digest(): WeeklyTop10Digest {
  return {
    generatedAt: "2026-07-03T12:00:00.000Z",
    items: [
      {
        rank: 0,
        state: "new",
        title: "New opportunity",
        priority: "high",
        confidenceScore: 90,
        targetKeywords: ["new"],
        recommendedAction: "Review and create a draft task.",
        evidenceCount: 1,
        sourceKeys: ["gsc:search_performance:new"],
      },
      {
        rank: 1,
        state: "carried_over",
        title: "Existing draft opportunity",
        priority: "medium",
        confidenceScore: 70,
        targetKeywords: ["existing"],
        recommendedAction: "Keep in review.",
        evidenceCount: 1,
        sourceKeys: ["yandex_webmaster:search_performance:existing"],
      },
    ],
    watchlist: [],
    carriedOver: [
      {
        rank: 1,
        state: "carried_over",
        title: "Existing draft opportunity",
        priority: "medium",
        confidenceScore: 70,
        targetKeywords: ["existing"],
        recommendedAction: "Keep in review.",
        evidenceCount: 1,
        sourceKeys: ["yandex_webmaster:search_performance:existing"],
      },
    ],
    approvedStale: [
      {
        rank: 2,
        state: "approved",
        title: "Approved stale opportunity",
        priority: "high",
        confidenceScore: 82,
        targetKeywords: ["stale"],
        recommendedAction: "Check implementation status.",
        evidenceCount: 1,
        sourceKeys: ["gsc:search_performance:stale"],
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
  };
}

describe("weeklyTop10PersistenceDecision", () => {
  test("documents the persistence decision and human approval boundary", () => {
    expect(WEEKLY_TOP10_PERSISTENCE_DECISION_CONTRACT).toEqual({
      digestPersistence: {
        decision: "deferred",
        newCollection: null,
        reason:
          "Weekly Top-10 digest persistence is deferred until a real product consumer needs history beyond reporting export.",
      },
      approvalBoundary: {
        stateSourceCollection: "seoDraftTasks",
        implementationSourceCollection: "agency_tasks",
        requiresHumanActor: true,
        allowedWriteCommands: [
          "create_draft_task",
          "approve_draft_task",
          "reject_draft_task",
          "convert_to_agency_task",
        ],
        disallowedAutomation: [
          "auto_persist_digest",
          "auto_approve_opportunity",
          "auto_convert_to_agency_task",
          "send_telegram_without_approval",
          "run_production_pipeline",
        ],
      },
      reportingExport: {
        remainsReadOnly: true,
        schemaVersion: "seo_os_reporting_dashboard_export_v1",
      },
      notes: [
        "Do not add a Weekly Top-10 persistence collection in the current step.",
        "Approval state remains represented by existing seoDraftTasks status.",
        "Implementation state remains explicit through seoDraftTasks.realTaskId -> agency_tasks.id.",
        "Any write command must be a separate human-triggered approval boundary, not part of dry-run or reporting export.",
      ],
    });
  });

  test("builds human approval candidates from digest sections without creating write commands", () => {
    expect(buildWeeklyTop10ApprovalCandidates(digest())).toEqual([
      {
        digestSection: "items",
        rank: 0,
        title: "New opportunity",
        state: "new",
        action: "create_draft_task_for_review",
        requiresHumanApproval: true,
      },
      {
        digestSection: "items",
        rank: 1,
        title: "Existing draft opportunity",
        state: "carried_over",
        action: "keep_existing_draft_task",
        requiresHumanApproval: true,
      },
      {
        digestSection: "carriedOver",
        rank: 1,
        title: "Existing draft opportunity",
        state: "carried_over",
        action: "keep_existing_draft_task",
        requiresHumanApproval: true,
      },
      {
        digestSection: "approvedStale",
        rank: 2,
        title: "Approved stale opportunity",
        state: "approved",
        action: "review_stale_approved_task",
        requiresHumanApproval: true,
      },
    ]);
  });
});
