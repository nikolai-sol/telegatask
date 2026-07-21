import { describe, expect, test, vi } from "vitest";
import {
  createWeeklyTop10TelegramApprovalStartupIntegration,
  SEO_WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_HANDLER_FLAG,
  type WeeklyTop10TelegramApprovalStartupRegistrar,
} from "./weeklyTop10TelegramApprovalBotIntegration";
import type {
  WeeklyTop10TelegramApprovalDevCallbackContext,
  WeeklyTop10TelegramApprovalDevMessageContext,
} from "../features/seoAgent/weeklyTop10TelegramApprovalDevRegistration";

function callbackContext(callbackData: string): WeeklyTop10TelegramApprovalDevCallbackContext {
  return {
    from: { id: 123 },
    callbackQuery: { data: callbackData },
    answerCbQuery: vi.fn(async () => undefined),
    reply: vi.fn(async () => undefined),
  };
}

function messageContext(text: string): WeeklyTop10TelegramApprovalDevMessageContext {
  return {
    from: { id: 123 },
    message: {
      text,
      chat: { id: 456 },
    },
    reply: vi.fn(async () => undefined),
  };
}

describe("weeklyTop10TelegramApprovalBotIntegration", () => {
  test("does not call registration when feature flag is absent", async () => {
    const integration = createWeeklyTop10TelegramApprovalStartupIntegration();
    const registrar = vi.fn<WeeklyTop10TelegramApprovalStartupRegistrar>();

    expect(
      integration.register({
        env: {},
        registrar,
        resolveActor: vi.fn(async () => ({ userId: "user-1", role: "seo_manager" })),
      })
    ).toEqual({
      registered: false,
      reason: "feature_flag_disabled",
      error: null,
    });
    expect(registrar).not.toHaveBeenCalled();
    expect(await integration.handleCallback(callbackContext("seo10:v1:a:team1:run1:draft1"))).toBe(false);
  });

  test("registers exactly one dev callback bridge when feature flag is enabled", async () => {
    const integration = createWeeklyTop10TelegramApprovalStartupIntegration();
    const handler = vi.fn(async () => undefined);
    const registrar = vi.fn<WeeklyTop10TelegramApprovalStartupRegistrar>((bot) => {
      bot.on("callback_query", handler);
      return {
        registered: true,
        reason: "enabled",
        sideEffects: {
          approvalCommandExecuted: false,
          approvalDecisionPersisted: false,
          weeklyDigestPersisted: false,
          productionPipelineRun: false,
        },
      };
    });

    expect(
      integration.register({
        env: { [SEO_WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_HANDLER_FLAG]: "1" },
        registrar,
        resolveActor: vi.fn(async () => ({ userId: "user-1", role: "seo_manager" })),
      })
    ).toEqual({
      registered: true,
      reason: "enabled",
      error: null,
    });
    expect(
      integration.register({
        env: { [SEO_WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_HANDLER_FLAG]: "1" },
        registrar,
        resolveActor: vi.fn(async () => ({ userId: "user-1", role: "seo_manager" })),
      })
    ).toEqual({
      registered: false,
      reason: "already_registered",
      error: null,
    });
    expect(registrar).toHaveBeenCalledTimes(1);

    const ctx = callbackContext("seo10:v1:a:team1:run1:draft1");
    expect(await integration.handleCallback(ctx)).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(ctx);
  });

  test("ignores non weekly top-10 callbacks after registration", async () => {
    const integration = createWeeklyTop10TelegramApprovalStartupIntegration();
    const handler = vi.fn(async () => undefined);
    const registrar = vi.fn<WeeklyTop10TelegramApprovalStartupRegistrar>((bot) => {
      bot.on("callback_query", handler);
      return {
        registered: true,
        reason: "enabled",
        sideEffects: {
          approvalCommandExecuted: false,
          approvalDecisionPersisted: false,
          weeklyDigestPersisted: false,
          productionPipelineRun: false,
        },
      };
    });
    integration.register({
      env: { [SEO_WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_HANDLER_FLAG]: "1" },
      registrar,
      resolveActor: vi.fn(async () => ({ userId: "user-1", role: "seo_manager" })),
    });

    expect(await integration.handleCallback(callbackContext("tasksui:done"))).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  test("bridges dev message handling for pending rejection reasons", async () => {
    const integration = createWeeklyTop10TelegramApprovalStartupIntegration();
    const messageHandler = vi.fn(async () => true);
    const registrar = vi.fn<WeeklyTop10TelegramApprovalStartupRegistrar>((bot) => {
      bot.on("message", messageHandler);
      return {
        registered: true,
        reason: "enabled",
        sideEffects: {
          approvalCommandExecuted: false,
          approvalDecisionPersisted: false,
          weeklyDigestPersisted: false,
          productionPipelineRun: false,
        },
      };
    });
    integration.register({
      env: { [SEO_WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_HANDLER_FLAG]: "1" },
      registrar,
      resolveActor: vi.fn(async () => ({ userId: "user-1", role: "seo_manager" })),
    });

    const ctx = messageContext("missing target page binding");
    expect(await integration.handleMessage(ctx)).toBe(true);
    expect(messageHandler).toHaveBeenCalledWith(ctx);
  });

  test("logs registration error and keeps startup alive", () => {
    const integration = createWeeklyTop10TelegramApprovalStartupIntegration();
    const error = new Error("boom");
    const logger = { error: vi.fn() };

    expect(
      integration.register({
        env: { [SEO_WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_HANDLER_FLAG]: "1" },
        registrar: vi.fn(() => {
          throw error;
        }),
        logger,
        resolveActor: vi.fn(async () => ({ userId: "user-1", role: "seo_manager" })),
      })
    ).toEqual({
      registered: false,
      reason: "registration_failed",
      error: "boom",
    });
    expect(logger.error).toHaveBeenCalledWith("[seo-weekly-top10] dev registration failed", error);
  });
});
