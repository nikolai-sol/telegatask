/**
 * SkillContext — обёртка контекста Telegraf для скиллов.
 *
 * Предоставляет:
 * - Доступ к Telegraf ctx
 * - Информация о пользователе, чате
 * - Текст команды / callback data
 * - Общие сервисы (kb, llm, telegram)
 */

import type { Context } from "telegraf";
import type { Update } from "telegraf/typings/core/types/typegram";
import type { TelegramUser } from "../models/telegramUser";
import type { Chat } from "../models/chat";
import type { KBService } from "./services/kb";
import type { LLMService } from "./services/llm";
import type { TelegramService } from "./services/telegram";

export interface SkillContext {
  /** Оригинальный Telegraf context */
  raw: Context<Update>;

  /** Тип запроса */
  triggerType: "command" | "callback" | "text" | "event";

  /** Команда (без /) или null */
  command: string | null;

  /** Аргументы команды (текст после /command) */
  args: string;

  /** Полный текст сообщения */
  text: string;

  /** Callback data (для inline-кнопок) */
  callbackData: string | null;

  /** User info (из Firestore, с settings/timezone) */
  user: TelegramUser;

  /** Chat info (из Firestore, с captureMode и т.д.) */
  chat: Chat | null;

  /** Тип чата Telegram */
  chatType: "private" | "group" | "supergroup" | "channel";

  /** Telegram chat ID */
  telegramChatId: number;

  /** Telegram user ID */
  telegramUserId: number;

  // ============ Services ============

  /** Knowledge base service */
  kb: KBService;

  /** LLM (Gemini) service */
  llm: LLMService;

  /** Telegram helpers */
  tg: TelegramService;
}

/**
 * Создать SkillContext из Telegraf Context.
 */
export function buildSkillContext(
  rawCtx: Context<Update>,
  user: TelegramUser,
  chat: Chat | null,
  services: {
    kb: KBService;
    llm: LLMService;
    tg: TelegramService;
  }
): SkillContext {
  const message = rawCtx.message;
  const callback = rawCtx.callbackQuery;

  let triggerType: SkillContext["triggerType"] = "text";
  let command: string | null = null;
  let args = "";
  let text = "";
  let callbackData: string | null = null;
  let chatType: SkillContext["chatType"] = "private";
  let telegramChatId = 0;
  let telegramUserId = rawCtx.from?.id ?? 0;

  // Parse message
  if (message && "text" in message && message.text) {
    text = message.text;
    // [^\s@]+ корректно парсит и RU, и EN команды
    const match = text.match(/^\/([^\s@]+)(?:@\S+)?\s*(.*)/s);
    if (match) {
      triggerType = "command";
      command = match[1].toLowerCase();
      args = match[2].trim();
    }
    chatType = message.chat.type === "supergroup" ? "supergroup" : message.chat.type as SkillContext["chatType"];
    telegramChatId = message.chat.id;
  }

  // Parse callback
  if (callback && "data" in callback) {
    triggerType = "callback";
    callbackData = callback.data || null;
    if (callback.message && "chat" in callback.message) {
      chatType = callback.message.chat.type as SkillContext["chatType"];
      telegramChatId = callback.message.chat.id;
    }
  }

  return {
    raw: rawCtx,
    triggerType,
    command,
    args,
    text,
    callbackData,
    user,
    chat,
    chatType,
    telegramChatId,
    telegramUserId,
    kb: services.kb,
    llm: services.llm,
    tg: services.tg,
  };
}
