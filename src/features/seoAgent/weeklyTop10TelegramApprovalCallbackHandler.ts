import {
  decodeWeeklyTop10TelegramApprovalCallback,
  type WeeklyTop10TelegramApprovalCallbackAction,
} from "./weeklyTop10TelegramApprovalMessage";
import {
  planWeeklyTop10HumanApprovalCommand,
  type WeeklyTop10HumanApprovalActor,
  type WeeklyTop10HumanApprovalCommand,
  type WeeklyTop10HumanApprovalCommandPlan,
} from "./weeklyTop10HumanApprovalCommand";

export type WeeklyTop10TelegramApprovalCallbackNextStep =
  | "execute_approval_command"
  | "request_rejection_reason"
  | "request_or_create_real_task"
  | "open_details"
  | "ignore";

export type WeeklyTop10TelegramApprovalCallbackHandlerInput = {
  callbackData: string;
  actor: WeeklyTop10HumanApprovalActor;
};

export type WeeklyTop10TelegramApprovalCallbackHandlerResult = {
  handled: boolean;
  action: WeeklyTop10TelegramApprovalCallbackAction | null;
  nextStep: WeeklyTop10TelegramApprovalCallbackNextStep;
  answerText: string;
  command: WeeklyTop10HumanApprovalCommand | null;
  commandPlan: WeeklyTop10HumanApprovalCommandPlan | null;
  sideEffects: {
    approvalCommandExecuted: false;
    telegramMessageSent: false;
    productionPipelineRun: false;
    weeklyDigestPersisted: false;
  };
  errors: string[];
};

export type WeeklyTop10TelegramApprovalCallbackHandlerContract = {
  callbackPrefix: "seo10";
  importsTelegraf: false;
  executesApprovalCommand: false;
  sendsTelegramMessage: false;
  runsProductionPipeline: false;
  persistsWeeklyDigest: false;
  actionHandling: Record<WeeklyTop10TelegramApprovalCallbackAction, WeeklyTop10TelegramApprovalCallbackNextStep>;
  notes: string[];
};

export const WEEKLY_TOP10_TELEGRAM_APPROVAL_CALLBACK_HANDLER_CONTRACT: WeeklyTop10TelegramApprovalCallbackHandlerContract = {
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
};

function emptySideEffects(): WeeklyTop10TelegramApprovalCallbackHandlerResult["sideEffects"] {
  return {
    approvalCommandExecuted: false,
    telegramMessageSent: false,
    productionPipelineRun: false,
    weeklyDigestPersisted: false,
  };
}

function ignoredResult(errors: string[] = []): WeeklyTop10TelegramApprovalCallbackHandlerResult {
  return {
    handled: false,
    action: null,
    nextStep: "ignore",
    answerText: "Not a Weekly Top-10 approval callback.",
    command: null,
    commandPlan: null,
    sideEffects: emptySideEffects(),
    errors,
  };
}

function approveCommand(input: {
  actor: WeeklyTop10HumanApprovalActor;
  teamId: string;
  runId: string;
  draftTaskId: string;
}): WeeklyTop10HumanApprovalCommand {
  return {
    type: "approve_draft_task",
    teamId: input.teamId,
    runId: input.runId,
    draftTaskId: input.draftTaskId,
    actor: input.actor,
  };
}

export function handleWeeklyTop10TelegramApprovalCallback(
  input: WeeklyTop10TelegramApprovalCallbackHandlerInput
): WeeklyTop10TelegramApprovalCallbackHandlerResult {
  const payload = decodeWeeklyTop10TelegramApprovalCallback(input.callbackData);
  if (!payload) return ignoredResult();

  if (payload.action === "approve") {
    const command = approveCommand({
      actor: input.actor,
      teamId: payload.teamId,
      runId: payload.runId,
      draftTaskId: payload.draftTaskId,
    });
    const commandPlan = planWeeklyTop10HumanApprovalCommand(command);
    return {
      handled: true,
      action: "approve",
      nextStep: "execute_approval_command",
      answerText: commandPlan.allowed ? "Approval command is ready." : "Approval command is invalid.",
      command,
      commandPlan,
      sideEffects: emptySideEffects(),
      errors: commandPlan.errors,
    };
  }

  if (payload.action === "reject") {
    return {
      handled: true,
      action: "reject",
      nextStep: "request_rejection_reason",
      answerText: "Please provide a rejection reason.",
      command: null,
      commandPlan: null,
      sideEffects: emptySideEffects(),
      errors: [],
    };
  }

  if (payload.action === "convert") {
    return {
      handled: true,
      action: "convert",
      nextStep: "request_or_create_real_task",
      answerText: "Select or create a real task before conversion.",
      command: null,
      commandPlan: null,
      sideEffects: emptySideEffects(),
      errors: [],
    };
  }

  return {
    handled: true,
    action: "open",
    nextStep: "open_details",
    answerText: "Open Weekly Top-10 details.",
    command: null,
    commandPlan: null,
    sideEffects: emptySideEffects(),
    errors: [],
  };
}
