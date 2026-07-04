import { describe, expect, test, vi } from "vitest";
import {
  registerWeeklyTop10TelegramApprovalDevHandler,
  WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_FLAG,
  WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_REGISTRATION_CONTRACT,
  type WeeklyTop10TelegramApprovalDevBotLike,
  type WeeklyTop10TelegramApprovalDevCallbackContext,
} from "./weeklyTop10TelegramApprovalDevRegistration";

function botLike() {
  const handlers: Array<(ctx: WeeklyTop10TelegramApprovalDevCallbackContext) => Promise<void>> = [];
  const bot: WeeklyTop10TelegramApprovalDevBotLike = {
    on: vi.fn((_event, handler) => {
      handlers.push(handler);
    }),
  };
  return { bot, handlers };
}

function callbackContext(callbackData: string): WeeklyTop10TelegramApprovalDevCallbackContext {
  return {
    from: { id: 123 },
    callbackQuery: { data: callbackData },
    answerCbQuery: vi.fn(async () => undefined),
    reply: vi.fn(async () => undefined),
  };
}

describe("weeklyTop10TelegramApprovalDevRegistration", () => {
  test("documents the guarded dev registration contract", () => {
    expect(WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_REGISTRATION_CONTRACT).toEqual({
      featureFlag: "SEO_WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_HANDLER",
      enabledValue: "1",
      importsTelegraf: false,
      registersOnlyWhenEnabled: true,
      executesApprovalCommand: false,
      sendsDevGuidanceMessages: true,
      persistsWeeklyDigest: false,
      runsProductionPipeline: false,
      notes: [
        "This module accepts a bot-like object and does not import Telegraf.",
        "Registration is disabled unless SEO_WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_HANDLER=1.",
        "The dev handler may answer/reply with guidance, but it never executes approval commands.",
        "Approval execution remains guarded by the local approval command runner.",
      ],
    });
  });

  test("does not register when feature flag is disabled", () => {
    const { bot } = botLike();

    expect(
      registerWeeklyTop10TelegramApprovalDevHandler(bot, {
        env: {},
        resolveActor: vi.fn(async () => ({ userId: "user-1", role: "seo_manager" })),
      })
    ).toEqual({
      registered: false,
      reason: "feature_flag_disabled",
      sideEffects: {
        approvalCommandExecuted: false,
        weeklyDigestPersisted: false,
        productionPipelineRun: false,
      },
    });
    expect(bot.on).not.toHaveBeenCalled();
  });

  test("registers one callback handler when feature flag is enabled", () => {
    const { bot, handlers } = botLike();

    expect(
      registerWeeklyTop10TelegramApprovalDevHandler(bot, {
        env: { [WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_FLAG]: "1" },
        resolveActor: vi.fn(async () => ({ userId: "user-1", role: "seo_manager" })),
      })
    ).toEqual({
      registered: true,
      reason: "enabled",
      sideEffects: {
        approvalCommandExecuted: false,
        weeklyDigestPersisted: false,
        productionPipelineRun: false,
      },
    });
    expect(bot.on).toHaveBeenCalledWith("callback_query", expect.any(Function));
    expect(handlers).toHaveLength(1);
  });

  test("dev handler answers and replies with guidance for handled callback", async () => {
    const { bot, handlers } = botLike();
    registerWeeklyTop10TelegramApprovalDevHandler(bot, {
      env: { [WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_FLAG]: "1" },
      resolveActor: vi.fn(async () => ({ userId: "user-1", role: "seo_manager" })),
    });
    const ctx = callbackContext("seo10:v1:a:team1:run1:draft1");

    await handlers[0](ctx);

    expect(ctx.answerCbQuery).toHaveBeenCalledWith("Approval command is ready.");
    expect(ctx.reply).toHaveBeenCalledWith(
      "Approval is ready. Execute it from the guarded approval command runner.",
      {}
    );
  });

  test("dev handler ignores unrelated callback data", async () => {
    const { bot, handlers } = botLike();
    registerWeeklyTop10TelegramApprovalDevHandler(bot, {
      env: { [WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_FLAG]: "1" },
      resolveActor: vi.fn(async () => ({ userId: "user-1", role: "seo_manager" })),
    });
    const ctx = callbackContext("task:done:123");

    await handlers[0](ctx);

    expect(ctx.answerCbQuery).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});
