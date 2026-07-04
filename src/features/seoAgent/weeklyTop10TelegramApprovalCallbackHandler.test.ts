import { describe, expect, test } from "vitest";
import {
  handleWeeklyTop10TelegramApprovalCallback,
  WEEKLY_TOP10_TELEGRAM_APPROVAL_CALLBACK_HANDLER_CONTRACT,
} from "./weeklyTop10TelegramApprovalCallbackHandler";

const actor = {
  userId: "user-1",
  role: "seo_manager" as const,
};

describe("weeklyTop10TelegramApprovalCallbackHandler", () => {
  test("documents the Telegram callback handler boundary", () => {
    expect(WEEKLY_TOP10_TELEGRAM_APPROVAL_CALLBACK_HANDLER_CONTRACT).toEqual({
      callbackPrefix: "seo10",
      importsTelegraf: false,
      executesApprovalCommand: false,
      sendsTelegramMessage: false,
      runsProductionPipeline: false,
      persistsWeeklyDigest: false,
      actionHandling: {
        approve: "execute_approval_command",
        reject: "request_rejection_reason",
        convert: "request_or_create_real_task",
        open: "open_details",
      },
      notes: [
        "This boundary parses callback intent and returns a structured next step.",
        "It does not import Telegraf or call answerCbQuery.",
        "Approve produces a command plan but does not execute it.",
        "Reject and convert require follow-up input before a command can execute.",
      ],
    });
  });

  test("builds an approve command plan without executing it", () => {
    expect(
      handleWeeklyTop10TelegramApprovalCallback({
        callbackData: "seo10:v1:a:team1:run1:draft1",
        actor,
      })
    ).toEqual({
      handled: true,
      action: "approve",
      nextStep: "execute_approval_command",
      answerText: "Approval command is ready.",
      command: {
        type: "approve_draft_task",
        teamId: "team1",
        runId: "run1",
        draftTaskId: "draft1",
        actor,
      },
      commandPlan: {
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
      sideEffects: {
        approvalCommandExecuted: false,
        telegramMessageSent: false,
        productionPipelineRun: false,
        weeklyDigestPersisted: false,
      },
      errors: [],
    });
  });

  test("reject callback requests a reason instead of producing an incomplete command", () => {
    expect(
      handleWeeklyTop10TelegramApprovalCallback({
        callbackData: "seo10:v1:r:team1:run1:draft1",
        actor,
      })
    ).toMatchObject({
      handled: true,
      action: "reject",
      nextStep: "request_rejection_reason",
      answerText: "Please provide a rejection reason.",
      command: null,
      commandPlan: null,
      errors: [],
    });
  });

  test("convert callback requests real task selection or creation", () => {
    expect(
      handleWeeklyTop10TelegramApprovalCallback({
        callbackData: "seo10:v1:c:team1:run1:draft1",
        actor,
      })
    ).toMatchObject({
      handled: true,
      action: "convert",
      nextStep: "request_or_create_real_task",
      answerText: "Select or create a real task before conversion.",
      command: null,
      commandPlan: null,
      errors: [],
    });
  });

  test("open callback returns an open details next step", () => {
    expect(
      handleWeeklyTop10TelegramApprovalCallback({
        callbackData: "seo10:v1:o:team1:run1:draft1",
        actor,
      })
    ).toMatchObject({
      handled: true,
      action: "open",
      nextStep: "open_details",
      answerText: "Open Weekly Top-10 details.",
    });
  });

  test("ignores non Weekly Top-10 callback data", () => {
    expect(
      handleWeeklyTop10TelegramApprovalCallback({
        callbackData: "task:done:123",
        actor,
      })
    ).toEqual({
      handled: false,
      action: null,
      nextStep: "ignore",
      answerText: "Not a Weekly Top-10 approval callback.",
      command: null,
      commandPlan: null,
      sideEffects: {
        approvalCommandExecuted: false,
        telegramMessageSent: false,
        productionPipelineRun: false,
        weeklyDigestPersisted: false,
      },
      errors: [],
    });
  });
});
