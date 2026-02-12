/**
 * Chats Control Skill — /chats
 * Единый центр управления чатами (включение/выключение auto-scan).
 */

import { Markup } from "telegraf";
import type { Skill, SkillResult } from "../types";
import type { SkillContext } from "../../core/context";
import {
  listChats,
  setChatCaptureMode,
  getChatById,
} from "../../repositories/chatRepository";
import type { Chat } from "../../models/chat";

// ============================================================
// Helpers
// ============================================================

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Moscow",
    });
  } catch {
    return iso;
  }
}

interface ControlPanel {
  text: string;
  buttons: ReturnType<typeof Markup.inlineKeyboard> | null;
}

function buildControlPanel(chats: Chat[]): ControlPanel {
  const groupChats = chats.filter(
    (c) => c.type === "group" || c.type === "supergroup"
  );

  if (!groupChats.length) {
    return {
      text: "📭 Нет чатов.\nДобавьте бота в групповой чат — он появится здесь.",
      buttons: null,
    };
  }

  const lines = groupChats.map((chat, i) => {
    const icon = chat.captureMode === "auto_scan" ? "🟢" : "⚪";
    const mode = chat.captureMode === "auto_scan" ? "SCAN ON" : "scan off";
    const lastScan = chat.lastScannedAt
      ? `последний скан: ${formatShortDate(chat.lastScannedAt)}`
      : "ещё не сканировался";
    return `${i + 1}. ${icon} <b>${escapeHtml(chat.title || "Без названия")}</b>\n   ${mode} · ${lastScan}`;
  });

  const text =
    `🎛 <b>Центр управления чатами</b>\n\n` +
    lines.join("\n\n") +
    `\n\n` +
    `Нажмите кнопку чтобы включить/выключить auto-scan:`;

  const buttons = groupChats.map((chat) => {
    const isOn = chat.captureMode === "auto_scan";
    const label = isOn
      ? `🔕 Выкл: ${(chat.title || "Без названия").slice(0, 25)}`
      : `🟢 Вкл: ${(chat.title || "Без названия").slice(0, 25)}`;
    return [Markup.button.callback(label, `ctl:scan:${chat.id}:${isOn ? "off" : "on"}`)];
  });

  const hasAnyOn = groupChats.some((c) => c.captureMode === "auto_scan");
  const hasAnyOff = groupChats.some((c) => c.captureMode !== "auto_scan");
  const bottomRow: ReturnType<typeof Markup.button.callback>[] = [];
  if (hasAnyOff) bottomRow.push(Markup.button.callback("🟢 Все ON", "ctl:scan_all:on"));
  if (hasAnyOn) bottomRow.push(Markup.button.callback("🔕 Все OFF", "ctl:scan_all:off"));
  bottomRow.push(Markup.button.callback("🔄 Обновить", "ctl:refresh"));
  buttons.push(bottomRow);

  return { text, buttons: Markup.inlineKeyboard(buttons) };
}

// ============================================================
// Skill
// ============================================================

export const chatsControlSkill: Skill = {
  meta: {
    id: "chats-control",
    name: "Chats Control Panel",
    description: "Управление автосканированием чатов",
    version: "1.0.0",
    triggers: [
      { type: "command", command: "chats", aliases: ["чаты"] },
      { type: "callback", prefix: "ctl:" },
    ],
    permissions: {
      minPlan: "free",
      minRole: "admin",
      chatType: "any",
    },
    menuEntry: {
      command: "chats",
      description: "Управление чатами (scan on/off)",
    },
    keyboardButton: "/chats",
  },

  async execute(ctx: SkillContext): Promise<SkillResult> {
    // /chats command
    if (ctx.triggerType === "command") {
      return handleChatsCommand(ctx);
    }

    // Callback
    if (ctx.triggerType === "callback" && ctx.callbackData) {
      return handleCallback(ctx);
    }

    return { handled: false };
  },
};

async function handleChatsCommand(_ctx: SkillContext): Promise<SkillResult> {
  const chats = await listChats(50);
  const { text, buttons } = buildControlPanel(chats);

  // We handle reply ourselves because of complex Markup typing
  if (buttons) {
    await _ctx.raw.reply(text, { parse_mode: "HTML", ...buttons });
  } else {
    await _ctx.raw.reply(text, { parse_mode: "HTML" });
  }
  return { handled: true };
}

async function handleCallback(ctx: SkillContext): Promise<SkillResult> {
  const data = ctx.callbackData!;

  // ctl:scan:<chatId>:<on|off>
  if (data.startsWith("ctl:scan:") && !data.startsWith("ctl:scan_all:")) {
    const parts = data.split(":");
    if (parts.length !== 4) {
      return { handled: true, callbackAnswer: "Ошибка." };
    }
    const chatId = parts[2];
    const action = parts[3];
    const newMode = action === "on" ? ("auto_scan" as const) : ("off" as const);
    await setChatCaptureMode(chatId, newMode);

    const chat = await getChatById(chatId);
    const label = chat?.title || "чат";
    await ctx.raw.answerCbQuery(
      action === "on" ? `✅ Scan ON: ${label}` : `🔕 Scan OFF: ${label}`
    );

    await refreshPanel(ctx);
    return { handled: true };
  }

  // ctl:scan_all:<on|off>
  if (data.startsWith("ctl:scan_all:")) {
    const action = data.split(":")[2];
    const chats = await listChats(50);
    const groupChats = chats.filter((c) => c.type === "group" || c.type === "supergroup");
    const newMode = action === "on" ? ("auto_scan" as const) : ("off" as const);
    for (const chat of groupChats) {
      await setChatCaptureMode(chat.id, newMode);
    }
    await ctx.raw.answerCbQuery(
      action === "on"
        ? `✅ Scan включён для ${groupChats.length} чатов`
        : `🔕 Scan выключен для ${groupChats.length} чатов`
    );
    await refreshPanel(ctx);
    return { handled: true };
  }

  // ctl:refresh
  if (data === "ctl:refresh") {
    await ctx.raw.answerCbQuery("Обновлено");
    await refreshPanel(ctx);
    return { handled: true };
  }

  return { handled: true };
}

async function refreshPanel(ctx: SkillContext): Promise<void> {
  try {
    const chats = await listChats(50);
    const { text, buttons } = buildControlPanel(chats);
    if (buttons) {
      await ctx.raw.editMessageText(text, { parse_mode: "HTML", ...buttons });
    } else {
      await ctx.raw.editMessageText(text, { parse_mode: "HTML" });
    }
  } catch {
    // editMessageText can fail if text didn't change
  }
}
