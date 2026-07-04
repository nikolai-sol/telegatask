import {
  handleWeeklyTop10TelegramApprovalCallback,
  type WeeklyTop10TelegramApprovalCallbackHandlerResult,
} from "./weeklyTop10TelegramApprovalCallbackHandler";
import {
  buildWeeklyTop10TelegramApprovalResponse,
  type WeeklyTop10TelegramApprovalResponse,
} from "./weeklyTop10TelegramApprovalResponse";
import type { WeeklyTop10HumanApprovalActor } from "./weeklyTop10HumanApprovalCommand";

export type WeeklyTop10TelegramApprovalAdapterRole = WeeklyTop10HumanApprovalActor["role"];

export type WeeklyTop10TelegramApprovalTelegrafAdapterInput = {
  callbackData: string | null;
  telegramUserId: number | null;
  userId: string | null;
  role?: WeeklyTop10TelegramApprovalAdapterRole | null;
};

export type WeeklyTop10TelegramApprovalTelegrafAdapterPlan = {
  handled: boolean;
  actor: WeeklyTop10HumanApprovalActor | null;
  handlerResult: WeeklyTop10TelegramApprovalCallbackHandlerResult | null;
  response: WeeklyTop10TelegramApprovalResponse | null;
  adapterInstructions: {
    answerCallbackQuery: string | null;
    replyMessages: Array<{ text: string; parseMode: "Markdown" | null }>;
    editMessage: boolean;
    actions: WeeklyTop10TelegramApprovalResponse["actions"];
  };
  sideEffects: {
    answerCallbackQueryCalled: false;
    telegramMessageSent: false;
    approvalCommandExecuted: false;
    productionPipelineRun: false;
    weeklyDigestPersisted: false;
  };
  errors: string[];
};

export type WeeklyTop10TelegramApprovalTelegrafAdapterContract = {
  adapterName: "weekly_top10_telegraf_callback_adapter_v1";
  registersBotHandler: false;
  callsTelegrafMethods: false;
  executesApprovalCommand: false;
  sendsTelegramMessage: false;
  mapsCallbackData: true;
  mapsActorIdentity: true;
  notes: string[];
};

export const WEEKLY_TOP10_TELEGRAM_APPROVAL_TELEGRAF_ADAPTER_CONTRACT: WeeklyTop10TelegramApprovalTelegrafAdapterContract = {
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
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function emptySideEffects(): WeeklyTop10TelegramApprovalTelegrafAdapterPlan["sideEffects"] {
  return {
    answerCallbackQueryCalled: false,
    telegramMessageSent: false,
    approvalCommandExecuted: false,
    productionPipelineRun: false,
    weeklyDigestPersisted: false,
  };
}

function ignoredPlan(errors: string[]): WeeklyTop10TelegramApprovalTelegrafAdapterPlan {
  return {
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
    sideEffects: emptySideEffects(),
    errors,
  };
}

function actorFromInput(
  input: WeeklyTop10TelegramApprovalTelegrafAdapterInput
): WeeklyTop10HumanApprovalActor | null {
  const userId = cleanString(input.userId);
  if (!userId || !input.telegramUserId) return null;
  return {
    userId,
    role: input.role || "seo_manager",
  };
}

export function planWeeklyTop10TelegramApprovalTelegrafAdapter(
  input: WeeklyTop10TelegramApprovalTelegrafAdapterInput
): WeeklyTop10TelegramApprovalTelegrafAdapterPlan {
  const callbackData = cleanString(input.callbackData);
  if (!callbackData) return ignoredPlan(["Missing callback data."]);

  const actor = actorFromInput(input);
  if (!actor) return ignoredPlan(["Missing actor identity."]);

  const handlerResult = handleWeeklyTop10TelegramApprovalCallback({
    callbackData,
    actor,
  });
  const response = buildWeeklyTop10TelegramApprovalResponse(handlerResult);

  return {
    handled: response.handled,
    actor,
    handlerResult,
    response,
    adapterInstructions: {
      answerCallbackQuery: response.callbackAnswer,
      replyMessages: response.messages.map((message) => ({
        text: message.text,
        parseMode: message.parseMode,
      })),
      editMessage: response.editMessage,
      actions: response.actions.map((action) => ({
        type: action.type,
        payload: { ...action.payload },
      })),
    },
    sideEffects: emptySideEffects(),
    errors: handlerResult.errors,
  };
}
