import { describe, expect, test, vi } from "vitest";
import {
  executeWeeklyTop10HumanApprovalCommand,
  WEEKLY_TOP10_HUMAN_APPROVAL_EXECUTOR_CONTRACT,
  type WeeklyTop10HumanApprovalExecutorWriters,
} from "./weeklyTop10HumanApprovalExecutor";

const actor = {
  userId: "user-1",
  role: "seo_manager" as const,
};

function writers(): WeeklyTop10HumanApprovalExecutorWriters {
  return {
    createDraftTask: vi.fn(async () => ({ draftTaskId: "draft-created" })),
    updateDraftTaskStatus: vi.fn(async (input) => ({
      draftTaskId: input.draftTaskId,
      status: input.status,
    })),
    markDraftTaskConverted: vi.fn(async (input) => ({
      draftTaskId: input.draftTaskId,
      realTaskId: input.realTaskId,
    })),
  };
}

describe("weeklyTop10HumanApprovalExecutor", () => {
  test("documents the repository executor boundary", () => {
    expect(WEEKLY_TOP10_HUMAN_APPROVAL_EXECUTOR_CONTRACT).toEqual({
      usesInjectedWriters: true,
      importsFirestore: false,
      executesOnlyValidPlans: true,
      runsProductionPipeline: false,
      sendsNotifications: false,
      persistsWeeklyDigest: false,
      notes: [
        "This executor boundary has no direct Firestore dependency.",
        "Repository/service writers must be injected by a separate adapter.",
        "Invalid command plans do not call writer functions.",
        "The executor does not send Telegram notifications, persist Weekly Top-10 digests, or run the production pipeline.",
      ],
    });
  });

  test("executes an approve command through the injected status writer only", async () => {
    const injected = writers();

    await expect(
      executeWeeklyTop10HumanApprovalCommand(injected, {
        type: "approve_draft_task",
        teamId: "team-1",
        runId: "run-1",
        draftTaskId: "draft-1",
        actor,
      })
    ).resolves.toEqual({
      executed: true,
      plan: {
        commandType: "approve_draft_task",
        requiresHumanActor: true,
        allowed: true,
        repositoryMethod: "updateSeoDraftTaskStatus",
        targetDraftStatus: "approved",
        writes: ["seoDraftTasks"],
        runsProductionPipeline: false,
        sendsNotifications: false,
        errors: [],
      },
      result: {
        type: "draft_task_status_updated",
        draftTaskId: "draft-1",
        status: "approved",
      },
      sideEffects: {
        productionPipelineRun: false,
        sent: false,
        weeklyDigestPersisted: false,
      },
    });

    expect(injected.updateDraftTaskStatus).toHaveBeenCalledWith({
      teamId: "team-1",
      draftTaskId: "draft-1",
      status: "approved",
      actor,
      reason: null,
    });
    expect(injected.createDraftTask).not.toHaveBeenCalled();
    expect(injected.markDraftTaskConverted).not.toHaveBeenCalled();
  });

  test("executes a reject command with a required reason", async () => {
    const injected = writers();

    await executeWeeklyTop10HumanApprovalCommand(injected, {
      type: "reject_draft_task",
      teamId: "team-1",
      runId: "run-1",
      draftTaskId: "draft-1",
      actor,
      reason: "Not relevant this week.",
    });

    expect(injected.updateDraftTaskStatus).toHaveBeenCalledWith({
      teamId: "team-1",
      draftTaskId: "draft-1",
      status: "rejected",
      actor,
      reason: "Not relevant this week.",
    });
  });

  test("links a draft task to an existing real task through the injected conversion writer", async () => {
    const injected = writers();

    await expect(
      executeWeeklyTop10HumanApprovalCommand(injected, {
        type: "convert_to_agency_task",
        teamId: "team-1",
        runId: "run-1",
        draftTaskId: "draft-1",
        realTaskId: "agency-task-1",
        actor,
      })
    ).resolves.toMatchObject({
      executed: true,
      result: {
        type: "draft_task_converted",
        draftTaskId: "draft-1",
        realTaskId: "agency-task-1",
      },
      sideEffects: {
        productionPipelineRun: false,
        sent: false,
        weeklyDigestPersisted: false,
      },
    });

    expect(injected.markDraftTaskConverted).toHaveBeenCalledWith({
      teamId: "team-1",
      draftTaskId: "draft-1",
      realTaskId: "agency-task-1",
      convertedByUserId: "user-1",
    });
  });

  test("does not execute invalid command plans", async () => {
    const injected = writers();

    await expect(
      executeWeeklyTop10HumanApprovalCommand(injected, {
        type: "reject_draft_task",
        teamId: "team-1",
        runId: "run-1",
        actor: { userId: "", role: "seo_manager" },
      })
    ).resolves.toMatchObject({
      executed: false,
      result: null,
      plan: {
        allowed: false,
        errors: [
          "Missing required field: actor",
          "Missing required field: draftTaskId",
          "Missing required field: reason",
        ],
      },
    });

    expect(injected.createDraftTask).not.toHaveBeenCalled();
    expect(injected.updateDraftTaskStatus).not.toHaveBeenCalled();
    expect(injected.markDraftTaskConverted).not.toHaveBeenCalled();
  });
});
