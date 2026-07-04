import { describe, expect, test } from "vitest";
import {
  buildWeeklyTop10TelegramApprovalMessage,
  decodeWeeklyTop10TelegramApprovalCallback,
  encodeWeeklyTop10TelegramApprovalCallback,
  WEEKLY_TOP10_TELEGRAM_APPROVAL_CALLBACK_CONTRACT,
} from "./weeklyTop10TelegramApprovalMessage";
import type { WeeklyTop10DigestItem } from "./weeklyTop10Generator";

const item: WeeklyTop10DigestItem = {
  rank: 0,
  state: "new",
  title: "Improve GSC CTR for \"за руку\"",
  priority: "high",
  confidenceScore: 89,
  targetKeywords: ["за руку"],
  recommendedAction: "Improve title, description, and snippet intent alignment for \"за руку\".",
  evidenceCount: 1,
  sourceKeys: ["gsc:search_performance:за руку:https://zaruku.ru/"],
};

describe("weeklyTop10TelegramApprovalMessage", () => {
  test("documents the Telegram callback payload contract", () => {
    expect(WEEKLY_TOP10_TELEGRAM_APPROVAL_CALLBACK_CONTRACT).toEqual({
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
    });
  });

  test("encodes and decodes short versioned callback payloads", () => {
    const encoded = encodeWeeklyTop10TelegramApprovalCallback({
      version: "v1",
      action: "approve",
      teamId: "team1",
      runId: "run1",
      draftTaskId: "draft1",
    });

    expect(encoded).toBe("seo10:v1:a:team1:run1:draft1");
    expect(Buffer.byteLength(encoded, "utf8")).toBeLessThanOrEqual(64);
    expect(decodeWeeklyTop10TelegramApprovalCallback(encoded)).toEqual({
      version: "v1",
      action: "approve",
      teamId: "team1",
      runId: "run1",
      draftTaskId: "draft1",
    });
  });

  test("rejects unknown callback payloads", () => {
    expect(decodeWeeklyTop10TelegramApprovalCallback("task:done:123")).toBeNull();
    expect(decodeWeeklyTop10TelegramApprovalCallback("seo10:v1:x:team1:run1:draft1")).toBeNull();
    expect(decodeWeeklyTop10TelegramApprovalCallback("seo10:v2:a:team1:run1:draft1")).toBeNull();
  });

  test("builds a pure Telegram approval message model with inline button rows", () => {
    expect(
      buildWeeklyTop10TelegramApprovalMessage({
        item,
        teamId: "team1",
        runId: "run1",
        draftTaskId: "draft1",
      })
    ).toEqual({
      text: [
        "SEO opportunity #1: Improve GSC CTR for \"за руку\"",
        "Priority: high; confidence: 89",
        "Keywords: за руку",
        "Action: Improve title, description, and snippet intent alignment for \"за руку\".",
      ].join("\n"),
      buttons: [
        [
          {
            text: "Approve",
            callbackData: "seo10:v1:a:team1:run1:draft1",
          },
          {
            text: "Reject",
            callbackData: "seo10:v1:r:team1:run1:draft1",
          },
        ],
        [
          {
            text: "Convert",
            callbackData: "seo10:v1:c:team1:run1:draft1",
          },
          {
            text: "Open",
            callbackData: "seo10:v1:o:team1:run1:draft1",
          },
        ],
      ],
      metadata: {
        schema: "weekly_top10_telegram_approval_message_v1",
        maxCallbackDataBytes: 64,
        sendsNotifications: false,
        executesApprovalCommand: false,
      },
    });
  });

  test("throws when callback data would exceed Telegram callback size", () => {
    expect(() =>
      encodeWeeklyTop10TelegramApprovalCallback({
        version: "v1",
        action: "approve",
        teamId: "team-with-a-very-long-identifier",
        runId: "run-with-a-very-long-identifier",
        draftTaskId: "draft-with-a-very-long-identifier",
      })
    ).toThrow("Telegram callback_data exceeds 64 bytes.");
  });
});
