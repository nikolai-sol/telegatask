/**
 * Scan Skill — /scan_on, /scan_off
 * Управление автосканированием из группового чата.
 */

import type { Skill, SkillResult } from "../types";
import type { SkillContext } from "../../core/context";
import {
  upsertChatFromTelegramPayload,
  setChatCaptureMode,
} from "../../repositories/chatRepository";
import { debugLog } from "../../config/debug";

export const scanSkill: Skill = {
  meta: {
    id: "scan",
    name: "Scan Control",
    description: "Включить/выключить auto-scan в групповом чате",
    version: "1.0.0",
    triggers: [
      { type: "command", command: "scan_on", aliases: ["скан_вкл"] },
      { type: "command", command: "scan_off", aliases: ["скан_выкл"] },
    ],
    permissions: {
      minPlan: "free",
      chatType: "any",
    },
    menuEntry: {
      command: "scan_on",
      description: "Включить авто-сканирование",
    },
  },

  async execute(ctx: SkillContext): Promise<SkillResult> {
    if (ctx.command === "scan_on") return handleScanOn(ctx);
    if (ctx.command === "scan_off") return handleScanOff(ctx);
    return { handled: false };
  },
};

async function handleScanOn(ctx: SkillContext): Promise<SkillResult> {
  if (ctx.chatType === "private") {
    return {
      handled: true,
      messages: [
        {
          text: "Команда /scan_on работает в групповых чатах.\nДля управления из личного чата используйте /chats",
        },
      ],
    };
  }

  try {
    const message = ctx.raw.message!;
    const chatInfo = "chat" in message ? message.chat : null;
    if (!chatInfo) return { handled: false };

    const chat = await upsertChatFromTelegramPayload({
      id: chatInfo.id,
      title: "title" in chatInfo ? chatInfo.title : undefined,
      type: chatInfo.type as "group" | "supergroup",
    });

    await setChatCaptureMode(chat.id, "auto_scan");
    debugLog(`[skill:scan] Auto-scan enabled for chat ${chat.id} ("${chat.title}")`);

    return {
      handled: true,
      messages: [
        {
          text:
            "✅ Auto-scan включён для этого чата.\n" +
            "Бот будет каждые 30 мин анализировать сообщения и создавать задачи.\n\n" +
            "Управление: /chats (в личке)",
        },
      ],
    };
  } catch (error) {
    console.error("[skill:scan] Failed to enable scan", error);
    return {
      handled: true,
      messages: [{ text: "Ошибка при включении auto-scan." }],
    };
  }
}

async function handleScanOff(ctx: SkillContext): Promise<SkillResult> {
  if (ctx.chatType === "private") {
    return {
      handled: true,
      messages: [
        {
          text: "Команда /scan_off работает в групповых чатах.\nДля управления из личного чата используйте /chats",
        },
      ],
    };
  }

  try {
    const message = ctx.raw.message!;
    const chatInfo = "chat" in message ? message.chat : null;
    if (!chatInfo) return { handled: false };

    const chat = await upsertChatFromTelegramPayload({
      id: chatInfo.id,
      title: "title" in chatInfo ? chatInfo.title : undefined,
      type: chatInfo.type as "group" | "supergroup",
    });

    await setChatCaptureMode(chat.id, "off");
    debugLog(`[skill:scan] Auto-scan disabled for chat ${chat.id} ("${chat.title}")`);

    return {
      handled: true,
      messages: [{ text: "🔕 Auto-scan выключен.\nУправление: /chats (в личке)" }],
    };
  } catch (error) {
    console.error("[skill:scan] Failed to disable scan", error);
    return {
      handled: true,
      messages: [{ text: "Ошибка при выключении auto-scan." }],
    };
  }
}
