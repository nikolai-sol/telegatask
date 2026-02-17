export function normalizeTelegramUsername(username?: string | null): string | null {
  const value = String(username || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  return value || null;
}

function normalizeSeenChatId(chatId: string | number | null | undefined): string | null {
  if (chatId === null || chatId === undefined) return null;
  const value = String(chatId).trim();
  return value || null;
}

export function mergeSeenInChats(
  existing: unknown,
  seenChatId: string | number | null | undefined,
  maxItems = 50
): string[] {
  const next = Array.isArray(existing) ? existing.map((x) => String(x)).filter(Boolean) : [];
  const chat = normalizeSeenChatId(seenChatId);
  if (chat) {
    const idx = next.indexOf(chat);
    if (idx >= 0) next.splice(idx, 1);
    next.unshift(chat);
  }
  return next.slice(0, Math.max(1, maxItems));
}
