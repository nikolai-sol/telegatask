import { getChatByTelegramId } from "../../repositories/chatRepository";

/**
 * Resolve default project for a Telegram chat (by telegramChatId).
 * Used for Telegram-origin task creation only (group/supergroup/channel).
 */
export async function getDefaultProjectIdForTelegramChat(
  telegramChatId: string
): Promise<string | null> {
  const raw = String(telegramChatId || "").trim();
  if (!raw) return null;

  const n = Number(raw);
  if (!Number.isFinite(n)) return null;

  const chat = await getChatByTelegramId(n);
  return chat?.defaultProjectId ?? null;
}

