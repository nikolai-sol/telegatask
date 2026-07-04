import { describe, expect, test } from "vitest";
import {
  planWeeklyTop10TelegramApprovalTelegrafAdapter,
  WEEKLY_TOP10_TELEGRAM_APPROVAL_TELEGRAF_ADAPTER_CONTRACT,
} from "./weeklyTop10TelegramApprovalTelegrafAdapter";

describe("weeklyTop10TelegramApprovalTelegrafAdapter", () => {
  test("documents the thin Telegraf adapter boundary", () => {
    expect(WEEKLY_TOP10_TELEGRAM_APPROVAL_TELEGRAF_ADAPTER_CONTRACT).toEqual({
      adapterName: "weekly_top10_telegraf_callback_adapter_v1",
      registersBotHandler: false,
      callsTelegrafMethods: false,
      executesApprovalCommand: false,
      sendsTelegramMessage: false,
      mapsCallbackData: true,
      mapsActorIdentity: true,
      notes: [
        "This adapter boundary converts a minimal Telegraf callback context into pure handler and response models.",
        "It does not register bot.on('callback_query') or mutate telegataskBot.ts.",
        "It returns instructions for a future adapter to call answerCbQuery/reply/edit.",
        "Approval execution remains outside this boundary.",
      ],
    });
  });

  test("maps callback context into actor, handler result, response and adapter instructions", () => {
    expect(
      planWeeklyTop10TelegramApprovalTelegrafAdapter({
        callbackData: "seo10:v1:a:team1:run1:draft1",
        telegramUserId: 123,
        userId: "user-1",
        role: "seo_manager",
      })
    ).toMatchObject({
      handled: true,
      actor: {
        userId: "user-1",
        role: "seo_manager",
      },
      handlerResult: {
        handled: true,
        action: "approve",
        nextStep: "execute_approval_command",
      },
      response: {
        handled: true,
        callbackAnswer: "Approval command is ready.",
      },
      adapterInstructions: {
        answerCallbackQuery: "Approval command is ready.",
        replyMessages: [
          {
            text: "Approval is ready. Execute it from the guarded approval command runner.",
            parseMode: null,
          },
        ],
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
      },
      sideEffects: {
        answerCallbackQueryCalled: false,
        telegramMessageSent: false,
        approvalCommandExecuted: false,
        productionPipelineRun: false,
        weeklyDigestPersisted: false,
      },
      errors: [],
    });
  });

  test("defaults actor role to seo_manager when role is omitted", () => {
    expect(
      planWeeklyTop10TelegramApprovalTelegrafAdapter({
        callbackData: "seo10:v1:o:team1:run1:draft1",
        telegramUserId: 123,
        userId: "user-1",
      }).actor
    ).toEqual({
      userId: "user-1",
      role: "seo_manager",
    });
  });

  test("returns ignored plan when actor identity is missing", () => {
    expect(
      planWeeklyTop10TelegramApprovalTelegrafAdapter({
        callbackData: "seo10:v1:a:team1:run1:draft1",
        telegramUserId: 123,
        userId: null,
      })
    ).toEqual({
      handled: false,
      actor: null,
      handlerResult: null,
      response: null,
      adapterInstructions: {
        answerCallbackQuery: null,
        replyMessages: [],
        editMessage: false,
        actions: [],
      },
      sideEffects: {
        answerCallbackQueryCalled: false,
        telegramMessageSent: false,
        approvalCommandExecuted: false,
        productionPipelineRun: false,
        weeklyDigestPersisted: false,
      },
      errors: ["Missing actor identity."],
    });
  });

  test("does not handle unrelated callback data", () => {
    const plan = planWeeklyTop10TelegramApprovalTelegrafAdapter({
      callbackData: "task:done:123",
      telegramUserId: 123,
      userId: "user-1",
    });

    expect(plan.handled).toBe(false);
    expect(plan.adapterInstructions).toEqual({
      answerCallbackQuery: null,
      replyMessages: [],
      editMessage: false,
      actions: [],
    });
  });
});
