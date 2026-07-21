import { describe, expect, test, vi } from "vitest";
import {
  executeWeeklyTop10ApprovalTasks,
  type WeeklyTop10ApprovalTaskExecutionWriter,
} from "./weeklyTop10ApprovalTaskExecution";
import type { WeeklyTop10ApprovalDecisionRecord } from "./weeklyTop10ApprovalDecision";

function decision(input: Partial<WeeklyTop10ApprovalDecisionRecord> & {
  draftTaskId: string;
  opportunityId: string;
  clusterId: string;
  decision: "approved" | "rejected";
}): WeeklyTop10ApprovalDecisionRecord {
  return {
    id: `qa-seo-team-1_${input.opportunityId}`,
    teamId: "qa-seo-team-1",
    runId: "seo_weekly_2026-W29",
    opportunityId: input.opportunityId,
    clusterId: input.clusterId,
    draftTaskId: input.draftTaskId,
    decision: input.decision,
    rejectReason: input.rejectReason || null,
    reviewer: { userId: "operator", telegramUserId: 2779103 },
    decidedAt: "2026-07-13T08:00:00.000Z",
    source: "manual_backfill",
    callbackData: null,
    callbackTranscript: null,
    ...input,
  };
}

const weeklyArtifact = {
  weekKey: "2026-W29",
  runId: "seo_weekly_2026-W29",
  gapDigestArtifact: {
    digest: {
      messages: [
        {
          metadata: {
            evidence: {
              opportunityId: "seo_opp_approved",
              clusterId: "cluster-approved",
              section: "/melanoma/",
              query: "подногтевая меланома фото",
              seedQueries: ["подногтевая меланома фото", "меланома ногтя фото"],
              targetUrl: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
              opportunityType: "section_ranking_gap",
              medicalReviewRequired: true,
              advisory: {
                recommendationText: "Доработать существующую страницу под фото-интент.",
                medicalReviewText: "Требуется медицинская проверка.",
              },
            },
          },
        },
        {
          metadata: {
            evidence: {
              opportunityId: "seo_opp_no_target",
              clusterId: "cluster-no-target",
              section: "/rak-lyogkogo/",
              query: "инвалидность при раке легкого",
              seedQueries: ["инвалидность при раке легкого"],
              targetUrl: null,
              opportunityType: "section_ranking_gap",
              medicalReviewRequired: true,
              advisory: {
                recommendationText: "Нужна привязка целевой страницы.",
                medicalReviewText: "Требуется медицинская проверка.",
              },
            },
          },
        },
      ],
    },
  },
};

function writer(): WeeklyTop10ApprovalTaskExecutionWriter {
  return {
    createTask: vi.fn(async (input) => ({
      taskId: `notion-${input.draftTaskId}`,
      taskUrl: `https://notion.local/${input.draftTaskId}`,
    })),
    updateDecisionTaskExecution: vi.fn(async () => undefined),
  };
}

describe("weeklyTop10ApprovalTaskExecution", () => {
  test("creates a medical-review task for an approved decision and writes task metadata back", async () => {
    const injected = writer();
    const result = await executeWeeklyTop10ApprovalTasks({
      enabled: true,
      now: () => "2026-07-13T10:00:00.000Z",
      decisions: [
        decision({
          draftTaskId: "w481",
          opportunityId: "seo_opp_approved",
          clusterId: "cluster-approved",
          decision: "approved",
        }),
      ],
      weeklyArtifact,
      writer: injected,
    });

    expect(result.summary).toEqual({
      created: 1,
      alreadyCreated: 0,
      rejectedSkipped: 0,
      pending: 0,
      failed: 0,
    });
    expect(injected.createTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "seo_task_2026_W29_w481",
      draftTaskId: "w481",
      status: "awaiting_medical_review",
      medicalReviewer: "",
      targetUrl: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
      queryCluster: ["подногтевая меланома фото", "меланома ногтя фото"],
      advisoryText: "Доработать существующую страницу под фото-интент.",
    }));
    expect(injected.updateDecisionTaskExecution).toHaveBeenCalledWith(expect.objectContaining({
      decisionId: "qa-seo-team-1_seo_opp_approved",
      taskId: "notion-w481",
      taskStatus: "awaiting_medical_review",
      taskUrl: "https://notion.local/w481",
      executionStatus: "created",
    }));
  });

  test("creates a needs_target_page task when an approved opportunity has no targetUrl", async () => {
    const injected = writer();
    await executeWeeklyTop10ApprovalTasks({
      enabled: true,
      now: () => "2026-07-13T10:00:00.000Z",
      decisions: [
        decision({
          draftTaskId: "w484",
          opportunityId: "seo_opp_no_target",
          clusterId: "cluster-no-target",
          decision: "approved",
        }),
      ],
      weeklyArtifact,
      writer: injected,
    });

    expect(injected.createTask).toHaveBeenCalledWith(expect.objectContaining({
      draftTaskId: "w484",
      status: "needs_target_page",
      targetUrl: null,
    }));
  });

  test("skips rejected decisions with zero side effects", async () => {
    const injected = writer();
    const result = await executeWeeklyTop10ApprovalTasks({
      enabled: true,
      decisions: [
        decision({
          draftTaskId: "w485",
          opportunityId: "seo_opp_rejected",
          clusterId: "cluster-rejected",
          decision: "rejected",
          rejectReason: "missing target page binding",
        }),
      ],
      weeklyArtifact,
      writer: injected,
    });

    expect(result.summary.rejectedSkipped).toBe(1);
    expect(injected.createTask).not.toHaveBeenCalled();
    expect(injected.updateDecisionTaskExecution).not.toHaveBeenCalled();
  });
});
