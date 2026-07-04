import { describe, expect, test, vi } from "vitest";
import {
  parseWeeklyTop10HumanApprovalRunnerOptions,
  runWeeklyTop10HumanApprovalRunner,
  WEEKLY_TOP10_APPROVAL_EXECUTE_CONFIRMATION,
} from "./weeklyTop10HumanApprovalRunnerCli";
import type { WeeklyTop10HumanApprovalExecutorWriters } from "./weeklyTop10HumanApprovalExecutor";

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

describe("weeklyTop10HumanApprovalRunnerCli", () => {
  test("parses local approval command flags", () => {
    expect(
      parseWeeklyTop10HumanApprovalRunnerOptions([
        "--type",
        "approve_draft_task",
        "--team-id",
        "team-1",
        "--run-id",
        "run-1",
        "--draft-task-id",
        "draft-1",
        "--actor-user-id",
        "user-1",
        "--actor-role",
        "seo_manager",
      ])
    ).toEqual({
      command: {
        type: "approve_draft_task",
        teamId: "team-1",
        runId: "run-1",
        actor: {
          userId: "user-1",
          role: "seo_manager",
        },
        draftTaskId: "draft-1",
        opportunityTitle: undefined,
        realTaskId: undefined,
        reason: undefined,
      },
      execute: false,
      confirmExecute: null,
    });
  });

  test("plans by default without calling repository writers", async () => {
    const injected = writers();
    const result = await runWeeklyTop10HumanApprovalRunner(
      parseWeeklyTop10HumanApprovalRunnerOptions([
        "--type",
        "approve_draft_task",
        "--team-id",
        "team-1",
        "--run-id",
        "run-1",
        "--draft-task-id",
        "draft-1",
        "--actor-user-id",
        "user-1",
      ]),
      injected
    );

    expect(result).toMatchObject({
      mode: "plan",
      plan: {
        allowed: true,
        repositoryMethod: "updateSeoDraftTaskStatus",
        targetDraftStatus: "approved",
      },
      execution: null,
      guardrails: {
        requiresExecuteFlag: true,
        requiresConfirmation: WEEKLY_TOP10_APPROVAL_EXECUTE_CONFIRMATION,
        productionPipelineRun: false,
        sendsNotifications: false,
        weeklyDigestPersisted: false,
      },
      errors: [],
    });
    expect(injected.updateDraftTaskStatus).not.toHaveBeenCalled();
  });

  test("refuses execute mode without explicit confirmation", async () => {
    const injected = writers();
    const result = await runWeeklyTop10HumanApprovalRunner(
      parseWeeklyTop10HumanApprovalRunnerOptions([
        "--type",
        "approve_draft_task",
        "--team-id",
        "team-1",
        "--run-id",
        "run-1",
        "--draft-task-id",
        "draft-1",
        "--actor-user-id",
        "user-1",
        "--execute",
      ]),
      injected
    );

    expect(result.execution).toBeNull();
    expect(result.errors).toEqual([
      `Execution requires --confirm-execute ${WEEKLY_TOP10_APPROVAL_EXECUTE_CONFIRMATION}`,
    ]);
    expect(injected.updateDraftTaskStatus).not.toHaveBeenCalled();
  });

  test("executes only with execute flag, confirmation, and injected writers", async () => {
    const injected = writers();
    const result = await runWeeklyTop10HumanApprovalRunner(
      parseWeeklyTop10HumanApprovalRunnerOptions([
        "--type",
        "approve_draft_task",
        "--team-id",
        "team-1",
        "--run-id",
        "run-1",
        "--draft-task-id",
        "draft-1",
        "--actor-user-id",
        "user-1",
        "--execute",
        "--confirm-execute",
        WEEKLY_TOP10_APPROVAL_EXECUTE_CONFIRMATION,
      ]),
      injected
    );

    expect(result).toMatchObject({
      mode: "execute",
      execution: {
        executed: true,
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
      },
      errors: [],
    });
    expect(injected.updateDraftTaskStatus).toHaveBeenCalledWith({
      teamId: "team-1",
      draftTaskId: "draft-1",
      status: "approved",
      actor: {
        userId: "user-1",
        role: "seo_manager",
      },
      reason: null,
    });
  });
});
