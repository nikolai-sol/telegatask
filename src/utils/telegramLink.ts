import type { KnowledgeSourceTelegram } from "../models/knowledge";

/**
 * Генерирует ссылку на сообщение Telegram.
 * Для публичных: t.me/username/msgId
 * Для приватных: t.me/c/XXX/msgId (работает только для участников), иначе — текст chat/msg
 */
export function buildTelegramMessageLink(source: KnowledgeSourceTelegram | null | undefined): string {
  if (!source || !source.messageId) return "";

  if (source.chatUsername) {
    return `https://t.me/${source.chatUsername}/${source.messageId}`;
  }

  if (source.telegramChatId != null) {
    const cid = source.telegramChatId;
    const linkId = cid < 0 ? Math.abs(cid).toString().replace(/^100/, "") : cid.toString();
    return `https://t.me/c/${linkId}/${source.messageId}`;
  }

  return "";
}

/**
 * Текстовое описание источника для случаев, когда ссылка недоступна
 */
export function formatSourceFallback(
  source: KnowledgeSourceTelegram | null | undefined,
  sourceChatTitle?: string | null
): string {
  if (!source) {
    return sourceChatTitle ? `(${sourceChatTitle})` : "";
  }
  const link = buildTelegramMessageLink(source);
  if (link) {
    return link;
  }
  return `chat ${source.chatId} / msg ${source.messageId}` + (sourceChatTitle ? ` (${sourceChatTitle})` : "");
}
