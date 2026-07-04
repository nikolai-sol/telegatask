import {
  planWeeklyTop10TelegramApprovalTelegrafAdapter,
  type WeeklyTop10TelegramApprovalAdapterRole,
  type WeeklyTop10TelegramApprovalTelegrafAdapterPlan,
} from "./weeklyTop10TelegramApprovalTelegrafAdapter";

export const WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_FLAG = "SEO_WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_HANDLER";

export type WeeklyTop10TelegramApprovalDevRegistrationContract = {
  featureFlag: typeof WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_FLAG;
  enabledValue: "1";
  importsTelegraf: false;
  registersOnlyWhenEnabled: true;
  executesApprovalCommand: false;
  sendsDevGuidanceMessages: true;
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
  env?: Record<string, string | undefined>;
};

export type WeeklyTop10TelegramApprovalDevCallbackContext = {
  from?: {
    id?: number;
  };
  callbackQuery?: {
    data?: unknown;
  };
  answerCbQuery(text?: string): Promise<unknown>;
  reply(text: string, options?: Record<string, unknown>): Promise<unknown>;
};

export type WeeklyTop10TelegramApprovalDevBotLike = {
  on(
    event: "callback_query",
    handler: (ctx: WeeklyTop10TelegramApprovalDevCallbackContext) => Promise<void>
  ): void;
};

export type WeeklyTop10TelegramApprovalDevRegistrationResult = {
  registered: boolean;
  reason: "enabled" | "feature_flag_disabled";
  sideEffects: {
    approvalCommandExecuted: false;
    weeklyDigestPersisted: false;
    productionPipelineRun: false;
  };
};

export const WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_REGISTRATION_CONTRACT: WeeklyTop10TelegramApprovalDevRegistrationContract = {
  featureFlag: WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_FLAG,
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
};

function enabled(env: Record<string, string | undefined> | undefined): boolean {
  return env?.[WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_FLAG] === "1";
}

function emptySideEffects(): WeeklyTop10TelegramApprovalDevRegistrationResult["sideEffects"] {
  return {
    approvalCommandExecuted: false,
    weeklyDigestPersisted: false,
    productionPipelineRun: false,
  };
}

function callbackDataFromContext(ctx: WeeklyTop10TelegramApprovalDevCallbackContext): string | null {
  const value = ctx.callbackQuery?.data;
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  deps: WeeklyTop10TelegramApprovalDevRegistrationDependencies
): Promise<void> {
  const plan = await planFromContext(ctx, deps);
  if (!plan.handled) return;

  if (plan.adapterInstructions.answerCallbackQuery) {
    await ctx.answerCbQuery(plan.adapterInstructions.answerCallbackQuery);
  }
  for (const message of plan.adapterInstructions.replyMessages) {
    const options: Record<string, unknown> = {};
    if (message.parseMode) options.parse_mode = message.parseMode;
    await ctx.reply(message.text, options);
  }
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

  bot.on("callback_query", async (ctx) => handleDevCallback(ctx, deps));
  return {
    registered: true,
    reason: "enabled",
    sideEffects: emptySideEffects(),
  };
}
