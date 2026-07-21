import {
  planWeeklyTop10TelegramApprovalTelegrafAdapter,
  type WeeklyTop10TelegramApprovalAdapterRole,
  type WeeklyTop10TelegramApprovalTelegrafAdapterPlan,
} from "./weeklyTop10TelegramApprovalTelegrafAdapter";
import {
  decodeWeeklyTop10TelegramApprovalCallback,
  type WeeklyTop10TelegramApprovalCallbackPayload,
} from "./weeklyTop10TelegramApprovalMessage";
import {
  persistWeeklyTop10ApprovalDecision,
  type WeeklyTop10ApprovalDecisionRecord,
  type WeeklyTop10ApprovalDecisionPersistInput,
  type WeeklyTop10ApprovalDecisionPersistResult,
} from "./weeklyTop10ApprovalDecision";
import {
  weeklyTop10ApprovalDecisionFirestoreStore,
  weeklyTop10ApprovalDecisionWritesEnabled,
  updateWeeklyTop10ApprovalDecisionTaskExecution,
} from "./weeklyTop10ApprovalDecisionRepository";
import {
  executeWeeklyTop10ApprovalTasks,
  type WeeklyTop10ApprovalTaskCreateInput,
} from "./weeklyTop10ApprovalTaskExecution";
import { weeklySeoRhythmFirestoreStore } from "./weeklySeoRhythmRepository";
import { zarukuSeoProductionConfig } from "./production/zaruku/zarukuSeoProductionConfig";
import { readFileSync } from "fs";

export const WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_FLAG = "SEO_WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_HANDLER";

export type WeeklyTop10TelegramApprovalDevRegistrationContract = {
  featureFlag: typeof WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_FLAG;
  enabledValue: "1";
  importsTelegraf: false;
  registersOnlyWhenEnabled: true;
  executesApprovalCommand: true;
  sendsDevGuidanceMessages: true;
  persistsApprovalDecisions: true;
  persistsWeeklyDigest: false;
  runsProductionPipeline: false;
  notes: string[];
};

export type WeeklyTop10TelegramApprovalDevActor = {
  userId: string;
  role?: WeeklyTop10TelegramApprovalAdapterRole | null;
};

export type WeeklyTop10TelegramApprovalDevRegistrationDependencies = {
  resolveActor(input: { telegramUserId: number }): Promise<WeeklyTop10TelegramApprovalDevActor | null>;
  resolveDecisionTarget?(input: {
    teamId: string;
    runId: string;
    draftTaskId: string;
    callbackData: string;
  }): Promise<{ opportunityId: string; clusterId?: string | null } | null>;
  persistDecision?(input: WeeklyTop10ApprovalDecisionPersistInput): Promise<WeeklyTop10ApprovalDecisionPersistResult>;
  executeApprovalTask?(input: { decision: WeeklyTop10ApprovalDecisionRecord }): Promise<{
    status: "created" | "already_created" | "execution_pending" | "skipped_disabled";
    taskId?: string | null;
    taskUrl?: string | null;
    error?: string | null;
  }>;
  now?: () => string;
  env?: Record<string, string | undefined>;
};

export type WeeklyTop10TelegramApprovalDevCallbackContext = {
  updateId?: number;
  from?: {
    id?: number;
  };
  callbackQuery?: {
    id?: unknown;
    data?: unknown;
    message?: {
      message_id?: unknown;
      chat?: {
        id?: unknown;
      };
    };
  };
  answerCbQuery(text?: string): Promise<unknown>;
  reply(text: string, options?: Record<string, unknown>): Promise<unknown>;
};

export type WeeklyTop10TelegramApprovalDevMessageContext = {
  updateId?: number;
  from?: {
    id?: number;
  };
  message?: {
    text?: unknown;
    message_id?: unknown;
    chat?: {
      id?: unknown;
    };
  };
  reply(text: string, options?: Record<string, unknown>): Promise<unknown>;
};

export type WeeklyTop10TelegramApprovalDevBotLike = {
  on(
    event: "callback_query",
    handler: (ctx: WeeklyTop10TelegramApprovalDevCallbackContext) => Promise<void>
  ): void;
  on(
    event: "message",
    handler: (ctx: WeeklyTop10TelegramApprovalDevMessageContext) => Promise<boolean>
  ): void;
};

export type WeeklyTop10TelegramApprovalDevRegistrationResult = {
  registered: boolean;
  reason: "enabled" | "feature_flag_disabled";
  sideEffects: {
    approvalCommandExecuted: false;
    approvalDecisionPersisted: false;
    weeklyDigestPersisted: false;
    productionPipelineRun: false;
  };
};

export const WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_REGISTRATION_CONTRACT: WeeklyTop10TelegramApprovalDevRegistrationContract = {
  featureFlag: WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_FLAG,
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
};

function enabled(env: Record<string, string | undefined> | undefined): boolean {
  return env?.[WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_FLAG] === "1";
}

function emptySideEffects(): WeeklyTop10TelegramApprovalDevRegistrationResult["sideEffects"] {
  return {
    approvalCommandExecuted: false,
    approvalDecisionPersisted: false,
    weeklyDigestPersisted: false,
    productionPipelineRun: false,
  };
}

function callbackDataFromContext(ctx: WeeklyTop10TelegramApprovalDevCallbackContext): string | null {
  const value = ctx.callbackQuery?.data;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function transcriptFromContext(ctx: WeeklyTop10TelegramApprovalDevCallbackContext) {
  return {
    updateId: toNumber(ctx.updateId),
    callbackQueryId: cleanString(ctx.callbackQuery?.id) || null,
    messageId: toNumber(ctx.callbackQuery?.message?.message_id),
    chatId: cleanString(ctx.callbackQuery?.message?.chat?.id) || null,
  };
}

function pendingKey(input: { telegramUserId: number | null; chatId: string | null }): string | null {
  if (!input.telegramUserId || !input.chatId) return null;
  return `${input.telegramUserId}:${input.chatId}`;
}

function weekKeyFromRunId(runId: string): string | null {
  const value = cleanString(runId);
  return value.startsWith("seo_weekly_") ? value.replace(/^seo_weekly_/, "") : null;
}

export async function defaultResolveDecisionTarget(input: {
  teamId: string;
  runId: string;
  draftTaskId: string;
  callbackData: string;
  getRun?: typeof weeklySeoRhythmFirestoreStore.getRun;
  readArtifact?: (path: string) => string;
}): Promise<{ opportunityId: string; clusterId?: string | null } | null> {
  const weekKey = weekKeyFromRunId(input.runId);
  if (!weekKey) return null;
  const getRun = input.getRun || weeklySeoRhythmFirestoreStore.getRun;
  const run = await getRun({ weekKey });
  const approvalTarget = (run?.approvalTargets || []).find((target) =>
    target.callbackData === input.callbackData
    || target.draftTaskId === input.draftTaskId
  );
  if (approvalTarget) {
    return {
      opportunityId: approvalTarget.opportunityId,
      clusterId: approvalTarget.clusterId || null,
    };
  }
  const artifactPath = run?.artifactPath || `reports/task-048-zaruku-weekly-seo-rhythm-${weekKey}.json`;
  const artifact = JSON.parse((input.readArtifact || ((path) => readFileSync(path, "utf8")))(artifactPath)) as any;
  const messages = artifact?.gapDigestArtifact?.digest?.messages;
  if (!Array.isArray(messages)) return null;
  const message = messages.find((candidate: any) => {
    const buttons = Array.isArray(candidate?.buttons) ? candidate.buttons.flat() : [];
    return buttons.some((button: any) => button?.callbackData === input.callbackData)
      || buttons.some((button: any) => cleanString(button?.callbackData).endsWith(`:${input.draftTaskId}`));
  });
  const evidence = message?.metadata?.evidence;
  const opportunityId = cleanString(evidence?.opportunityId);
  if (!opportunityId) return null;
  return {
    opportunityId,
    clusterId: cleanString(evidence?.clusterId) || null,
  };
}

async function defaultPersistDecision(
  input: WeeklyTop10ApprovalDecisionPersistInput
): Promise<WeeklyTop10ApprovalDecisionPersistResult> {
  return persistWeeklyTop10ApprovalDecision(weeklyTop10ApprovalDecisionFirestoreStore, input);
}

function approvalTaskExecutionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[zarukuSeoProductionConfig.approvalTaskExecution.writesFlag] === "1";
}

async function createNotionSeoTask(input: WeeklyTop10ApprovalTaskCreateInput): Promise<{
  taskId: string;
  taskUrl: string | null;
}> {
  const token = cleanString(process.env[zarukuSeoProductionConfig.approvalTaskExecution.notionTokenEnvVar]);
  if (!token) throw new Error(`${zarukuSeoProductionConfig.approvalTaskExecution.notionTokenEnvVar} is not set`);
  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "notion-version": "2022-06-28",
    },
    body: JSON.stringify({
      parent: { page_id: zarukuSeoProductionConfig.approvalTaskExecution.notionParentPageId },
      properties: {
        title: {
          title: [{ text: { content: input.title } }],
        },
      },
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ text: { content: `Status: ${input.status}` } }],
          },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ text: { content: `Run: ${input.runId}` } }],
          },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ text: { content: `Section: ${input.section}` } }],
          },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ text: { content: `Target URL: ${input.targetUrl || "needs_target_page"}` } }],
          },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ text: { content: `Medical reviewer: ${input.medicalReviewer}` } }],
          },
        },
      ],
    }),
  });
  const json = await response.json().catch(() => ({})) as { url?: string; message?: string };
  if (!response.ok) {
    throw new Error(cleanString(json.message) || `Notion API error ${response.status}`);
  }
  return {
    taskId: input.taskId,
    taskUrl: cleanString(json.url) || null,
  };
}

async function defaultExecuteApprovalTask(input: {
  decision: WeeklyTop10ApprovalDecisionRecord;
  env?: Record<string, string | undefined>;
}): Promise<{
  status: "created" | "already_created" | "execution_pending" | "skipped_disabled";
  taskId?: string | null;
  taskUrl?: string | null;
  error?: string | null;
}> {
  if (!approvalTaskExecutionEnabled(input.env || process.env)) {
    return { status: "skipped_disabled", taskId: null, taskUrl: null, error: null };
  }
  const weekKey = weekKeyFromRunId(input.decision.runId);
  if (!weekKey) {
    return { status: "execution_pending", taskId: null, taskUrl: null, error: "Cannot resolve run week from decision runId." };
  }
  const run = await weeklySeoRhythmFirestoreStore.getRun({ weekKey });
  const artifactPath = run?.artifactPath || `reports/task-048-zaruku-weekly-seo-rhythm-${weekKey}.json`;
  const weeklyArtifact = JSON.parse(readFileSync(artifactPath, "utf8")) as unknown;
  const createdTasks: Array<{ taskId: string; taskUrl: string | null }> = [];
  const result = await executeWeeklyTop10ApprovalTasks({
    enabled: true,
    decisions: [input.decision],
    weeklyArtifact,
    writer: {
      async createTask(taskInput) {
        const createdTask = await createNotionSeoTask(taskInput);
        createdTasks.push(createdTask);
        return createdTask;
      },
      updateDecisionTaskExecution: updateWeeklyTop10ApprovalDecisionTaskExecution,
    },
  });
  const task = result.tasks[0];
  const createdTask = createdTasks[0] || null;
  if (result.summary.created > 0) {
    return {
      status: "created",
      taskId: createdTask?.taskId || task?.taskId || null,
      taskUrl: createdTask?.taskUrl || null,
      error: null,
    };
  }
  if (result.summary.alreadyCreated > 0) {
    return { status: "already_created", taskId: input.decision.taskId || null, taskUrl: input.decision.taskUrl || null, error: null };
  }
  return { status: "execution_pending", taskId: task?.taskId || null, taskUrl: null, error: "Approval task execution did not create a task." };
}

function approvalTaskReplyText(input: {
  baseText: string;
  execution: Awaited<ReturnType<NonNullable<WeeklyTop10TelegramApprovalDevRegistrationDependencies["executeApprovalTask"]>>> | null;
}): string {
  if (!input.execution || input.execution.status === "skipped_disabled") {
    return `${input.baseText}\nКоманда approve_draft_task не выполнена.`;
  }
  if (input.execution.status === "created" || input.execution.status === "already_created") {
    return [
      input.baseText,
      `Задача ${input.execution.status === "created" ? "создана" : "уже создана"}: ${input.execution.taskId || "n/a"}`,
      input.execution.taskUrl || "",
    ].filter(Boolean).join("\n");
  }
  return `${input.baseText}\nКоманда approve_draft_task отложена: ${input.execution.error || "execution_pending"}`;
}

async function planFromContext(
  ctx: WeeklyTop10TelegramApprovalDevCallbackContext,
  deps: WeeklyTop10TelegramApprovalDevRegistrationDependencies
): Promise<WeeklyTop10TelegramApprovalTelegrafAdapterPlan> {
  const telegramUserId = ctx.from?.id || null;
  const actor = telegramUserId ? await deps.resolveActor({ telegramUserId }) : null;
  return planWeeklyTop10TelegramApprovalTelegrafAdapter({
    callbackData: callbackDataFromContext(ctx),
    telegramUserId,
    userId: actor?.userId || null,
    role: actor?.role || "seo_manager",
  });
}

async function handleDevCallback(
  ctx: WeeklyTop10TelegramApprovalDevCallbackContext,
  deps: WeeklyTop10TelegramApprovalDevRegistrationDependencies,
  pendingRejections: Map<string, WeeklyTop10ApprovalDecisionPersistInput>
): Promise<void> {
  const callbackData = callbackDataFromContext(ctx);
  const payload = callbackData ? decodeWeeklyTop10TelegramApprovalCallback(callbackData) : null;
  const plan = await planFromContext(ctx, deps);
  if (!plan.handled) return;

  if ((payload?.action === "approve" || payload?.action === "reject") && plan.actor) {
    const callbackDataText = callbackData || "";
    const transcript = transcriptFromContext(ctx);
    const chatId = transcript.chatId;
    const target = await (deps.resolveDecisionTarget || defaultResolveDecisionTarget)({
      teamId: payload.teamId,
      runId: payload.runId,
      draftTaskId: payload.draftTaskId,
      callbackData: callbackDataText,
    });
    if (!target) {
      await ctx.answerCbQuery("Не найдено соответствие opportunity для callback.");
      await ctx.reply("Не удалось сохранить решение: не найден opportunityId для этого сообщения.", {});
      return;
    }
    const baseInput: WeeklyTop10ApprovalDecisionPersistInput = {
      writesEnabled: weeklyTop10ApprovalDecisionWritesEnabled(deps.env || process.env),
      teamId: payload.teamId,
      runId: payload.runId,
      opportunityId: target.opportunityId,
      clusterId: target.clusterId || null,
      draftTaskId: payload.draftTaskId,
      decision: payload.action === "approve" ? "approved" : "rejected",
      rejectReason: null,
      reviewer: {
        userId: plan.actor.userId,
        telegramUserId: ctx.from?.id || null,
      },
      decidedAt: (deps.now || (() => new Date().toISOString()))(),
      callbackData: callbackDataText,
      source: "telegram_dev_callback",
      callbackTranscript: transcript,
    };
    if (payload.action === "reject") {
      const key = pendingKey({ telegramUserId: ctx.from?.id || null, chatId });
      if (key) pendingRejections.set(key, baseInput);
      await ctx.answerCbQuery("Пришлите причину отказа следующим сообщением.");
      await ctx.reply("Пришлите причину отказа следующим сообщением. Решение будет сохранено после причины.", {});
      return;
    }
    const persisted = await (deps.persistDecision || defaultPersistDecision)(baseInput);
    const execution = persisted.decision?.decision === "approved"
      ? await (deps.executeApprovalTask || ((value) => defaultExecuteApprovalTask({ ...value, env: deps.env || process.env })))({
        decision: persisted.decision,
      })
      : null;
    await ctx.answerCbQuery(persisted.answerText);
    await ctx.reply(approvalTaskReplyText({ baseText: persisted.answerText, execution }), {});
    return;
  }

  if (plan.adapterInstructions.answerCallbackQuery) {
    await ctx.answerCbQuery(plan.adapterInstructions.answerCallbackQuery);
  }
  for (const message of plan.adapterInstructions.replyMessages) {
    const options: Record<string, unknown> = {};
    if (message.parseMode) options.parse_mode = message.parseMode;
    await ctx.reply(message.text, options);
  }
}

async function handleDevMessage(
  ctx: WeeklyTop10TelegramApprovalDevMessageContext,
  deps: WeeklyTop10TelegramApprovalDevRegistrationDependencies,
  pendingRejections: Map<string, WeeklyTop10ApprovalDecisionPersistInput>
): Promise<boolean> {
  const key = pendingKey({
    telegramUserId: ctx.from?.id || null,
    chatId: cleanString(ctx.message?.chat?.id) || null,
  });
  if (!key) return false;
  const pending = pendingRejections.get(key);
  if (!pending) return false;
  const rejectReason = cleanString(ctx.message?.text);
  if (!rejectReason) {
    await ctx.reply("Причина отказа пустая. Пришлите текст причины.", {});
    return true;
  }
  pendingRejections.delete(key);
  const persisted = await (deps.persistDecision || defaultPersistDecision)({
    ...pending,
    rejectReason,
    decidedAt: (deps.now || (() => new Date().toISOString()))(),
  });
  await ctx.reply(`${persisted.answerText}\nПричина: ${rejectReason}\nКоманда reject_draft_task не выполнена.`, {});
  return true;
}

export function registerWeeklyTop10TelegramApprovalDevHandler(
  bot: WeeklyTop10TelegramApprovalDevBotLike,
  deps: WeeklyTop10TelegramApprovalDevRegistrationDependencies
): WeeklyTop10TelegramApprovalDevRegistrationResult {
  if (!enabled(deps.env || process.env)) {
    return {
      registered: false,
      reason: "feature_flag_disabled",
      sideEffects: emptySideEffects(),
    };
  }

  const pendingRejections = new Map<string, WeeklyTop10ApprovalDecisionPersistInput>();
  bot.on("callback_query", async (ctx) => handleDevCallback(ctx, deps, pendingRejections));
  bot.on("message", async (ctx) => handleDevMessage(ctx, deps, pendingRejections));
  return {
    registered: true,
    reason: "enabled",
    sideEffects: emptySideEffects(),
  };
}
