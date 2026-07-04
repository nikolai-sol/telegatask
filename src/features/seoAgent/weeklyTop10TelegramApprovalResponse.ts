import type { WeeklyTop10TelegramApprovalCallbackHandlerResult } from "./weeklyTop10TelegramApprovalCallbackHandler";

export type WeeklyTop10TelegramApprovalResponseActionType =
  | "execute_approval_command"
  | "collect_rejection_reason"
  | "collect_real_task"
  | "open_details"
  | "noop";

export type WeeklyTop10TelegramApprovalResponseAction = {
  type: WeeklyTop10TelegramApprovalResponseActionType;
  payload: Record<string, string | boolean | null>;
};

export type WeeklyTop10TelegramApprovalResponseMessage = {
  text: string;
  parseMode: "Markdown" | null;
};

export type WeeklyTop10TelegramApprovalResponseButton = {
  text: string;
  callbackData: string;
};

export type WeeklyTop10TelegramApprovalResponse = {
  handled: boolean;
  callbackAnswer: string | null;
  messages: WeeklyTop10TelegramApprovalResponseMessage[];
  buttons: WeeklyTop10TelegramApprovalResponseButton[][];
  editMessage: boolean;
  actions: WeeklyTop10TelegramApprovalResponseAction[];
  sideEffects: {
    telegramMessageSent: false;
    approvalCommandExecuted: false;
    productionPipelineRun: false;
    weeklyDigestPersisted: false;
  };
};

export type WeeklyTop10TelegramApprovalResponseContract = {
  importsTelegraf: false;
  sendsTelegramMessage: false;
  executesApprovalCommand: false;
  responseShape: {
    callbackAnswer: "adapter_calls_answerCbQuery";
    messages: "adapter_may_reply_or_edit";
    actions: "adapter_may_execute_later";
  };
  notes: string[];
};

export const WEEKLY_TOP10_TELEGRAM_APPROVAL_RESPONSE_CONTRACT: WeeklyTop10TelegramApprovalResponseContract = {
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
};

function emptySideEffects(): WeeklyTop10TelegramApprovalResponse["sideEffects"] {
  return {
    telegramMessageSent: false,
    approvalCommandExecuted: false,
    productionPipelineRun: false,
    weeklyDigestPersisted: false,
  };
}

function noopResponse(input: WeeklyTop10TelegramApprovalCallbackHandlerResult): WeeklyTop10TelegramApprovalResponse {
  return {
    handled: input.handled,
    callbackAnswer: input.handled ? input.answerText : null,
    messages: [],
    buttons: [],
    editMessage: false,
    actions: input.handled
      ? [
          {
            type: "noop",
            payload: {
              reason: input.nextStep,
            },
          },
        ]
      : [],
    sideEffects: emptySideEffects(),
  };
}

export function buildWeeklyTop10TelegramApprovalResponse(
  input: WeeklyTop10TelegramApprovalCallbackHandlerResult
): WeeklyTop10TelegramApprovalResponse {
  if (!input.handled) return noopResponse(input);

  if (input.nextStep === "execute_approval_command" && input.command && input.commandPlan) {
    return {
      handled: true,
      callbackAnswer: input.answerText,
      messages: [
        {
          text: input.commandPlan.allowed
            ? "Approval is ready. Execute it from the guarded approval command runner."
            : `Approval is blocked: ${input.errors.join("; ")}`,
          parseMode: null,
        },
      ],
      buttons: [],
      editMessage: false,
      actions: [
        {
          type: "execute_approval_command",
          payload: {
            commandType: input.command.type,
            teamId: input.command.teamId,
            runId: input.command.runId,
            draftTaskId: input.command.draftTaskId || null,
            allowed: input.commandPlan.allowed,
          },
        },
      ],
      sideEffects: emptySideEffects(),
    };
  }

  if (input.nextStep === "request_rejection_reason") {
    return {
      handled: true,
      callbackAnswer: input.answerText,
      messages: [
        {
          text: "Reply with a rejection reason before this opportunity can be rejected.",
          parseMode: null,
        },
      ],
      buttons: [],
      editMessage: false,
      actions: [
        {
          type: "collect_rejection_reason",
          payload: {
            pending: true,
          },
        },
      ],
      sideEffects: emptySideEffects(),
    };
  }

  if (input.nextStep === "request_or_create_real_task") {
    return {
      handled: true,
      callbackAnswer: input.answerText,
      messages: [
        {
          text: "Choose or create a real agency task, then run the guarded conversion command.",
          parseMode: null,
        },
      ],
      buttons: [],
      editMessage: false,
      actions: [
        {
          type: "collect_real_task",
          payload: {
            pending: true,
          },
        },
      ],
      sideEffects: emptySideEffects(),
    };
  }

  if (input.nextStep === "open_details") {
    return {
      handled: true,
      callbackAnswer: input.answerText,
      messages: [
        {
          text: "Open details is a UI/navigation action for a future adapter.",
          parseMode: null,
        },
      ],
      buttons: [],
      editMessage: false,
      actions: [
        {
          type: "open_details",
          payload: {
            pending: true,
          },
        },
      ],
      sideEffects: emptySideEffects(),
    };
  }

  return noopResponse(input);
}
