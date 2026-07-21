import { describe, expect, test, vi } from "vitest";
import {
  defaultResolveDecisionTarget,
  registerWeeklyTop10TelegramApprovalDevHandler,
  WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_FLAG,
  WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_REGISTRATION_CONTRACT,
  type WeeklyTop10TelegramApprovalDevBotLike,
  type WeeklyTop10TelegramApprovalDevCallbackContext,
} from "./weeklyTop10TelegramApprovalDevRegistration";

function botLike() {
  const handlers: Array<(ctx: any) => Promise<unknown>> = [];
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
    updateId: 9001,
    callbackQuery: {
      id: "callback-1",
      data: callbackData,
      message: {
        message_id: 456,
        chat: { id: 789 },
      },
    },
    answerCbQuery: vi.fn(async () => undefined),
    reply: vi.fn(async () => undefined),
  };
}

function messageContext(text: string) {
  return {
    from: { id: 123 },
    updateId: 9002,
    message: {
      text,
      message_id: 457,
      chat: { id: 789 },
    },
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
      executesApprovalCommand: true,
      sendsDevGuidanceMessages: true,
      persistsApprovalDecisions: true,
      persistsWeeklyDigest: false,
      runsProductionPipeline: false,
      notes: [
        "This module accepts a bot-like object and does not import Telegraf.",
        "Registration is disabled unless SEO_WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_HANDLER=1.",
        "The dev handler persists approve/reject ApprovalDecision records when the explicit write flag is enabled.",
        "The dev handler may execute approval task creation only when SEO_APPROVAL_TASK_EXECUTION=1.",
        "Approval execution remains guarded by the approval command runner and degrades to decision-only persistence.",
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
        approvalDecisionPersisted: false,
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
        approvalDecisionPersisted: false,
        weeklyDigestPersisted: false,
        productionPipelineRun: false,
      },
    });
    expect(bot.on).toHaveBeenCalledWith("callback_query", expect.any(Function));
    expect(bot.on).toHaveBeenCalledWith("message", expect.any(Function));
    expect(handlers).toHaveLength(2);
  });

  test("dev handler reports already-decided approvals from the persistence boundary", async () => {
    const { bot, handlers } = botLike();
    const persistDecision = vi.fn(async () => ({
      status: "already_decided" as const,
      answerText: "Уже решено: одобрено.",
      sideEffects: {
        firestoreWrite: false,
        approvalCommandExecuted: false,
        productionPipelineRun: false,
        weeklyDigestPersisted: false,
      },
    }));
    registerWeeklyTop10TelegramApprovalDevHandler(bot, {
      env: { [WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_FLAG]: "1", SEO_WEEKLY_TOP10_APPROVAL_DECISION_WRITES: "1" },
      resolveActor: vi.fn(async () => ({ userId: "user-1", role: "seo_manager" })),
      resolveDecisionTarget: vi.fn(async () => ({ opportunityId: "opp-1", clusterId: "cluster-1" })),
      persistDecision,
    });
    const ctx = callbackContext("seo10:v1:a:team1:run1:draft1");

    await handlers[0](ctx);

    expect(ctx.answerCbQuery).toHaveBeenCalledWith("Уже решено: одобрено.");
    expect(ctx.reply).toHaveBeenCalledWith("Уже решено: одобрено.\nКоманда approve_draft_task не выполнена.", {});
  });

  test("dev handler persists approve decisions and confirms the reviewer", async () => {
    const { bot, handlers } = botLike();
    const persistDecision = vi.fn(async () => ({
      status: "created" as const,
      decision: {
        id: "team1_opp-1",
        teamId: "team1",
        runId: "run1",
        opportunityId: "opp-1",
        clusterId: "cluster-1",
        draftTaskId: "draft1",
        decision: "approved" as const,
        rejectReason: null,
        reviewer: { userId: "user-1", telegramUserId: 123 },
        decidedAt: "2026-07-13T10:00:00.000Z",
        callbackData: "seo10:v1:a:team1:run1:draft1",
        source: "telegram_dev_callback" as const,
        callbackTranscript: null,
      },
      answerText: "Решение сохранено: одобрено.",
      sideEffects: {
        firestoreWrite: true,
        approvalCommandExecuted: false,
        productionPipelineRun: false,
        weeklyDigestPersisted: false,
      },
    }));
    registerWeeklyTop10TelegramApprovalDevHandler(bot, {
      env: { [WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_FLAG]: "1", SEO_WEEKLY_TOP10_APPROVAL_DECISION_WRITES: "1" },
      resolveActor: vi.fn(async () => ({ userId: "user-1", role: "seo_manager" })),
      resolveDecisionTarget: vi.fn(async () => ({ opportunityId: "opp-1", clusterId: "cluster-1" })),
      persistDecision,
      now: () => "2026-07-13T10:00:00.000Z",
    });
    const ctx = callbackContext("seo10:v1:a:team1:run1:draft1");

    await handlers[0](ctx);

    expect(persistDecision).toHaveBeenCalledWith({
      writesEnabled: true,
      teamId: "team1",
      runId: "run1",
      opportunityId: "opp-1",
      clusterId: "cluster-1",
      draftTaskId: "draft1",
      decision: "approved",
      rejectReason: null,
      reviewer: { userId: "user-1", telegramUserId: 123 },
      decidedAt: "2026-07-13T10:00:00.000Z",
      callbackData: "seo10:v1:a:team1:run1:draft1",
      source: "telegram_dev_callback",
      callbackTranscript: {
        updateId: 9001,
        callbackQueryId: "callback-1",
        messageId: 456,
        chatId: "789",
      },
    });
    expect(ctx.answerCbQuery).toHaveBeenCalledWith("Решение сохранено: одобрено.");
    expect(ctx.reply).toHaveBeenCalledWith("Решение сохранено: одобрено.\nКоманда approve_draft_task не выполнена.", {});
  });

  test("dev handler executes approved decisions when the approval execution flag is enabled", async () => {
    const { bot, handlers } = botLike();
    const persistedDecision = {
      id: "team1_opp-1",
      teamId: "team1",
      runId: "run1",
      opportunityId: "opp-1",
      clusterId: "cluster-1",
      draftTaskId: "draft1",
      decision: "approved" as const,
      rejectReason: null,
      reviewer: { userId: "user-1", telegramUserId: 123 },
      decidedAt: "2026-07-13T10:00:00.000Z",
      callbackData: "seo10:v1:a:team1:run1:draft1",
      source: "telegram_dev_callback" as const,
      callbackTranscript: null,
    };
    const executeApprovalTask = vi.fn(async () => ({
      status: "created" as const,
      taskId: "seo_task_2026_W29_w481",
      taskUrl: "https://notion.local/seo_task_2026_W29_w481",
      error: null,
    }));
    registerWeeklyTop10TelegramApprovalDevHandler(bot, {
      env: {
        [WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_FLAG]: "1",
        SEO_WEEKLY_TOP10_APPROVAL_DECISION_WRITES: "1",
        SEO_APPROVAL_TASK_EXECUTION: "1",
      },
      resolveActor: vi.fn(async () => ({ userId: "user-1", role: "seo_manager" })),
      resolveDecisionTarget: vi.fn(async () => ({ opportunityId: "opp-1", clusterId: "cluster-1" })),
      persistDecision: vi.fn(async () => ({
        status: "created" as const,
        decision: persistedDecision,
        answerText: "Решение сохранено: одобрено.",
        sideEffects: {
          firestoreWrite: true,
          approvalCommandExecuted: false,
          productionPipelineRun: false,
          weeklyDigestPersisted: false,
        },
      })),
      executeApprovalTask,
      now: () => "2026-07-13T10:00:00.000Z",
    });
    const ctx = callbackContext("seo10:v1:a:team1:run1:draft1");

    await handlers[0](ctx);

    expect(executeApprovalTask).toHaveBeenCalledWith({ decision: persistedDecision });
    expect(ctx.answerCbQuery).toHaveBeenCalledWith("Решение сохранено: одобрено.");
    expect(ctx.reply).toHaveBeenCalledWith(
      "Решение сохранено: одобрено.\nЗадача создана: seo_task_2026_W29_w481\nhttps://notion.local/seo_task_2026_W29_w481",
      {}
    );
  });

  test("default target resolver can use Firestore run approval targets without local artifact files", async () => {
    const target = await defaultResolveDecisionTarget({
      teamId: "team1",
      runId: "seo_weekly_2026-W30",
      draftTaskId: "draft1",
      callbackData: "seo10:v1:a:team1:seo_weekly_2026-W30:draft1",
      getRun: async () => ({
        weekKey: "2026-W30",
        runId: "seo_weekly_2026-W30",
        status: "completed",
        lockOwner: null,
        startedAt: "2026-07-20T07:00:00.000Z",
        completedAt: "2026-07-20T07:05:00.000Z",
        failedAt: null,
        failureStage: null,
        failureMessage: null,
        digestMessageIds: [3059],
        artifactPath: "reports/missing-local-artifact.json",
        approvalTargets: [
          {
            draftTaskId: "draft1",
            callbackData: "seo10:v1:a:team1:seo_weekly_2026-W30:draft1",
            opportunityId: "opp-1",
            clusterId: "cluster-1",
          },
        ],
      }),
      readArtifact: () => {
        throw new Error("local artifact should not be read");
      },
    });

    expect(target).toEqual({ opportunityId: "opp-1", clusterId: "cluster-1" });
  });

  test("dev handler collects rejection reason before persisting reject decisions", async () => {
    const { bot, handlers } = botLike();
    const persistDecision = vi.fn(async () => ({
      status: "created" as const,
      answerText: "Решение сохранено: отклонено.",
      sideEffects: {
        firestoreWrite: true,
        approvalCommandExecuted: false,
        productionPipelineRun: false,
        weeklyDigestPersisted: false,
      },
    }));
    registerWeeklyTop10TelegramApprovalDevHandler(bot, {
      env: { [WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_FLAG]: "1" },
      resolveActor: vi.fn(async () => ({ userId: "user-1", role: "seo_manager" })),
      resolveDecisionTarget: vi.fn(async () => ({ opportunityId: "opp-1", clusterId: "cluster-1" })),
      persistDecision,
      now: () => "2026-07-13T10:00:00.000Z",
    });
    const rejectCtx = callbackContext("seo10:v1:r:team1:run1:draft1");

    await handlers[0](rejectCtx);

    expect(persistDecision).not.toHaveBeenCalled();
    expect(rejectCtx.answerCbQuery).toHaveBeenCalledWith("Пришлите причину отказа следующим сообщением.");

    await handlers[1](messageContext("missing target page binding"));

    expect(persistDecision).toHaveBeenCalledWith(expect.objectContaining({
      decision: "rejected",
      rejectReason: "missing target page binding",
      opportunityId: "opp-1",
      source: "telegram_dev_callback",
      callbackTranscript: expect.objectContaining({
        updateId: 9001,
        callbackQueryId: "callback-1",
        messageId: 456,
        chatId: "789",
      }),
    }));
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
