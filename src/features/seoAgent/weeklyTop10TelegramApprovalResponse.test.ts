import { describe, expect, test } from "vitest";
import {
  handleWeeklyTop10TelegramApprovalCallback,
  type WeeklyTop10TelegramApprovalCallbackHandlerResult,
} from "./weeklyTop10TelegramApprovalCallbackHandler";
import {
  buildWeeklyTop10TelegramApprovalResponse,
  WEEKLY_TOP10_TELEGRAM_APPROVAL_RESPONSE_CONTRACT,
} from "./weeklyTop10TelegramApprovalResponse";

const actor = {
  userId: "user-1",
  role: "seo_manager" as const,
};

describe("weeklyTop10TelegramApprovalResponse", () => {
  test("documents the Telegram response/action model contract", () => {
    expect(WEEKLY_TOP10_TELEGRAM_APPROVAL_RESPONSE_CONTRACT).toEqual({
      importsTelegraf: false,
      sendsTelegramMessage: false,
      executesApprovalCommand: false,
      responseShape: {
        callbackAnswer: "adapter_calls_answerCbQuery",
        messages: "adapter_may_reply_or_edit",
        actions: "adapter_may_execute_later",
      },
      notes: [
        "This response model is pure and does not call Telegram APIs.",
        "Callback answer text is returned for a future adapter to pass to answerCbQuery.",
        "Actions describe intent only; they do not execute writes.",
        "Approval execution remains guarded by the human approval runner/executor boundary.",
      ],
    });
  });

  test("turns approve handler result into a guarded execution action", () => {
    const handlerResult = handleWeeklyTop10TelegramApprovalCallback({
      callbackData: "seo10:v1:a:team1:run1:draft1",
      actor,
    });

    expect(buildWeeklyTop10TelegramApprovalResponse(handlerResult)).toEqual({
      handled: true,
      callbackAnswer: "Approval command is ready.",
      messages: [
        {
          text: "Approval is ready. Execute it from the guarded approval command runner.",
          parseMode: null,
        },
      ],
      buttons: [],
      editMessage: false,
      actions: [
        {
          type: "execute_approval_command",
          payload: {
            commandType: "approve_draft_task",
            teamId: "team1",
            runId: "run1",
            draftTaskId: "draft1",
            allowed: true,
          },
        },
      ],
      sideEffects: {
        telegramMessageSent: false,
        approvalCommandExecuted: false,
        productionPipelineRun: false,
        weeklyDigestPersisted: false,
      },
    });
  });

  test("turns reject handler result into a reason collection action", () => {
    const handlerResult = handleWeeklyTop10TelegramApprovalCallback({
      callbackData: "seo10:v1:r:team1:run1:draft1",
      actor,
    });

    expect(buildWeeklyTop10TelegramApprovalResponse(handlerResult)).toMatchObject({
      handled: true,
      callbackAnswer: "Please provide a rejection reason.",
      messages: [
        {
          text: "Reply with a rejection reason before this opportunity can be rejected.",
          parseMode: null,
        },
      ],
      actions: [
        {
          type: "collect_rejection_reason",
          payload: {
            pending: true,
          },
        },
      ],
    });
  });

  test("turns convert handler result into a real-task collection action", () => {
    const handlerResult = handleWeeklyTop10TelegramApprovalCallback({
      callbackData: "seo10:v1:c:team1:run1:draft1",
      actor,
    });

    expect(buildWeeklyTop10TelegramApprovalResponse(handlerResult)).toMatchObject({
      handled: true,
      callbackAnswer: "Select or create a real task before conversion.",
      messages: [
        {
          text: "Choose or create a real agency task, then run the guarded conversion command.",
          parseMode: null,
        },
      ],
      actions: [
        {
          type: "collect_real_task",
          payload: {
            pending: true,
          },
        },
      ],
    });
  });

  test("turns open handler result into an open-details action", () => {
    const handlerResult = handleWeeklyTop10TelegramApprovalCallback({
      callbackData: "seo10:v1:o:team1:run1:draft1",
      actor,
    });

    expect(buildWeeklyTop10TelegramApprovalResponse(handlerResult)).toMatchObject({
      handled: true,
      callbackAnswer: "Open Weekly Top-10 details.",
      actions: [
        {
          type: "open_details",
          payload: {
            pending: true,
          },
        },
      ],
    });
  });

  test("keeps ignored callbacks silent for the adapter", () => {
    const ignored: WeeklyTop10TelegramApprovalCallbackHandlerResult =
      handleWeeklyTop10TelegramApprovalCallback({
        callbackData: "task:done:123",
        actor,
      });

    expect(buildWeeklyTop10TelegramApprovalResponse(ignored)).toEqual({
      handled: false,
      callbackAnswer: null,
      messages: [],
      buttons: [],
      editMessage: false,
      actions: [],
      sideEffects: {
        telegramMessageSent: false,
        approvalCommandExecuted: false,
        productionPipelineRun: false,
        weeklyDigestPersisted: false,
      },
    });
  });
});
