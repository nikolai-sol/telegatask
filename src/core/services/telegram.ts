/**
 * Telegram Service — Telegram API helpers для скиллов.
 */

import type { Telegraf } from "telegraf";
import { buildTelegramMessageLink, formatSourceFallback } from "../../utils/telegramLink";
import { listChats } from "../../repositories/chatRepository";
import type { Chat } from "../../models/chat";
import type { KnowledgeSourceTelegram, KnowledgeItemV2 } from "../../models/knowledge";

export class TelegramService {
  private bot: Telegraf | null = null;

  setBot(bot: Telegraf): void {
    this.bot = bot;
  }

  /** Отправить личное сообщение */
  async sendDM(telegramUserId: number, text: string, parseMode: "HTML" | "Markdown" = "HTML"): Promise<boolean> {
    if (!this.bot) return false;
    try {
      await this.bot.telegram.sendMessage(telegramUserId, text, { parse_mode: parseMode });
      return true;
    } catch {
      return false;
    }
  }

  /** Ссылка на сообщение в Telegram (принимает KnowledgeSourceTelegram) */
  buildMessageLink(source: KnowledgeSourceTelegram | null | undefined): string {
    return buildTelegramMessageLink(source);
  }

  /** Текстовое описание источника */
  formatSource(source: KnowledgeSourceTelegram | null | undefined, chatTitle?: string | null): string {
    return formatSourceFallback(source, chatTitle);
  }

  /**
   * Строка "Source: ..." для отображения в сообщениях.
   * Если есть ссылка — HTML: <a href="...">open</a>
   * Иначе — chat X / msg Y (для приватных).
   */
  formatSourceLine(item: Pick<KnowledgeItemV2, "source" | "sourceChatId" | "sourceMessageId" | "sourceChatTitle">): string {
    const source = item.source;
    const link = buildTelegramMessageLink(source);
    if (link) {
      return `Source: <a href="${link}">open</a>`;
    }
    const chatId = source?.chatId ?? item.sourceChatId ?? "?";
    const msgId = source?.messageId ?? item.sourceMessageId ?? "?";
    const chatTitle = item.sourceChatTitle ? ` (${item.sourceChatTitle})` : "";
    return `Source: chat ${chatId} / msg ${msgId}${chatTitle}`;
  }

  /** Получить список всех чатов */
  async listChats(limit: number = 50): Promise<Chat[]> {
    return listChats(limit);
  }

  /** Проверить, запущен ли бот */
  get isReady(): boolean {
    return this.bot !== null;
  }
}
