import type { WeeklyTop10DigestItem } from "./weeklyTop10Generator";
import type { WeeklyTop10HumanApprovalCommandType } from "./weeklyTop10HumanApprovalCommand";

export type WeeklyTop10TelegramApprovalCallbackAction =
  | "approve"
  | "reject"
  | "convert"
  | "open";
export type WeeklyTop10TelegramApprovalCallbackCode = "a" | "r" | "c" | "o";

export type WeeklyTop10TelegramApprovalCallbackPayload = {
  version: "v1";
  action: WeeklyTop10TelegramApprovalCallbackAction;
  teamId: string;
  runId: string;
  draftTaskId: string;
};

export type WeeklyTop10TelegramApprovalButton = {
  text: string;
  callbackData: string;
};

export type WeeklyTop10TelegramApprovalMessage = {
  text: string;
  buttons: WeeklyTop10TelegramApprovalButton[][];
  metadata: {
    schema: "weekly_top10_telegram_approval_message_v1";
    maxCallbackDataBytes: 64;
    sendsNotifications: false;
    executesApprovalCommand: false;
  };
};

export type WeeklyTop10TelegramApprovalMessageInput = {
  item: WeeklyTop10DigestItem;
  teamId: string;
  runId: string;
  draftTaskId: string;
};

export type WeeklyTop10TelegramApprovalCallbackContract = {
  prefix: "seo10";
  version: "v1";
  maxCallbackDataBytes: 64;
  supportedActions: Record<
    WeeklyTop10TelegramApprovalCallbackAction,
    {
      code: WeeklyTop10TelegramApprovalCallbackCode;
      commandType: WeeklyTop10HumanApprovalCommandType | "request_rejection_reason" | "open_details";
      requiresHumanActor: true;
      executesImmediately: boolean;
    }
  >;
  notes: string[];
};

export const WEEKLY_TOP10_TELEGRAM_APPROVAL_CALLBACK_CONTRACT: WeeklyTop10TelegramApprovalCallbackContract = {
  prefix: "seo10",
  version: "v1",
  maxCallbackDataBytes: 64,
  supportedActions: {
    approve: {
      code: "a",
      commandType: "approve_draft_task",
      requiresHumanActor: true,
      executesImmediately: false,
    },
    reject: {
      code: "r",
      commandType: "request_rejection_reason",
      requiresHumanActor: true,
      executesImmediately: false,
    },
    convert: {
      code: "c",
      commandType: "convert_to_agency_task",
      requiresHumanActor: true,
      executesImmediately: false,
    },
    open: {
      code: "o",
      commandType: "open_details",
      requiresHumanActor: true,
      executesImmediately: false,
    },
  },
  notes: [
    "Callback payloads identify intent only; they do not execute approval commands by themselves.",
    "Reject callbacks request a rejection reason because callback_data must stay short.",
    "Convert callbacks require a separate real task creation or selection step before command execution.",
    "Telegram message generation is pure and does not send notifications.",
  ],
};

const actionToCode: Record<WeeklyTop10TelegramApprovalCallbackAction, WeeklyTop10TelegramApprovalCallbackCode> = {
  approve: "a",
  reject: "r",
  convert: "c",
  open: "o",
};

const codeToAction: Record<WeeklyTop10TelegramApprovalCallbackCode, WeeklyTop10TelegramApprovalCallbackAction> = {
  a: "approve",
  r: "reject",
  c: "convert",
  o: "open",
};

function cleanToken(value: string): string {
  return String(value || "").trim().replace(/[:\s]/g, "_");
}

function callbackByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function assertCallbackSize(value: string): void {
  if (callbackByteLength(value) > WEEKLY_TOP10_TELEGRAM_APPROVAL_CALLBACK_CONTRACT.maxCallbackDataBytes) {
    throw new Error("Telegram callback_data exceeds 64 bytes.");
  }
}

export function encodeWeeklyTop10TelegramApprovalCallback(
  payload: WeeklyTop10TelegramApprovalCallbackPayload
): string {
  const encoded = [
    WEEKLY_TOP10_TELEGRAM_APPROVAL_CALLBACK_CONTRACT.prefix,
    payload.version,
    actionToCode[payload.action],
    cleanToken(payload.teamId),
    cleanToken(payload.runId),
    cleanToken(payload.draftTaskId),
  ].join(":");
  assertCallbackSize(encoded);
  return encoded;
}

export function decodeWeeklyTop10TelegramApprovalCallback(
  callbackData: string
): WeeklyTop10TelegramApprovalCallbackPayload | null {
  const [prefix, version, code, teamId, runId, draftTaskId] = String(callbackData || "").split(":");
  if (prefix !== WEEKLY_TOP10_TELEGRAM_APPROVAL_CALLBACK_CONTRACT.prefix) return null;
  if (version !== WEEKLY_TOP10_TELEGRAM_APPROVAL_CALLBACK_CONTRACT.version) return null;
  const action = codeToAction[code as WeeklyTop10TelegramApprovalCallbackCode];
  if (!action || !teamId || !runId || !draftTaskId) return null;
  return {
    version,
    action,
    teamId,
    runId,
    draftTaskId,
  };
}

function truncate(value: string, maxLength: number): string {
  const clean = String(value || "").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatKeywords(values: string[]): string {
  return values.length ? values.slice(0, 3).join(", ") : "no keywords";
}

export function buildWeeklyTop10TelegramApprovalMessage(
  input: WeeklyTop10TelegramApprovalMessageInput
): WeeklyTop10TelegramApprovalMessage {
  const callbackBase = {
    version: "v1" as const,
    teamId: input.teamId,
    runId: input.runId,
    draftTaskId: input.draftTaskId,
  };
  return {
    text: [
      `SEO opportunity #${input.item.rank + 1}: ${truncate(input.item.title, 90)}`,
      `Priority: ${input.item.priority}; confidence: ${input.item.confidenceScore}`,
      `Keywords: ${formatKeywords(input.item.targetKeywords)}`,
      input.item.recommendedAction ? `Action: ${truncate(input.item.recommendedAction, 140)}` : null,
    ].filter(Boolean).join("\n"),
    buttons: [
      [
        {
          text: "Approve",
          callbackData: encodeWeeklyTop10TelegramApprovalCallback({
            ...callbackBase,
            action: "approve",
          }),
        },
        {
          text: "Reject",
          callbackData: encodeWeeklyTop10TelegramApprovalCallback({
            ...callbackBase,
            action: "reject",
          }),
        },
      ],
      [
        {
          text: "Convert",
          callbackData: encodeWeeklyTop10TelegramApprovalCallback({
            ...callbackBase,
            action: "convert",
          }),
        },
        {
          text: "Open",
          callbackData: encodeWeeklyTop10TelegramApprovalCallback({
            ...callbackBase,
            action: "open",
          }),
        },
      ],
    ],
    metadata: {
      schema: "weekly_top10_telegram_approval_message_v1",
      maxCallbackDataBytes: 64,
      sendsNotifications: false,
      executesApprovalCommand: false,
    },
  };
}
