type DebugFilter = {
  telegramUserId?: number | null;
  userId?: string | null;
  teamId?: string | null;
};

type DebugState = {
  enabledUntilMs: number;
  filter: DebugFilter;
  enabledByTelegramUserId?: number | null;
};

let state: DebugState | null = null;

function nowMs(): number {
  return Date.now();
}

export function enableDebug(input: { ttlMs: number; filter: DebugFilter; enabledByTelegramUserId?: number | null }): void {
  const ttlMs = Math.max(0, Number(input.ttlMs) || 0);
  state = {
    enabledUntilMs: nowMs() + ttlMs,
    filter: input.filter || {},
    enabledByTelegramUserId: input.enabledByTelegramUserId ?? null,
  };
}

export function disableDebug(): void {
  state = null;
}

export function getDebugState(): DebugState | null {
  if (!state) return null;
  if (state.enabledUntilMs <= nowMs()) return null;
  return state;
}

export function isDebugEnabledForRequest(input: { telegramUserId?: number | null; userId?: string | null; teamId?: string | null }): boolean {
  if (String(process.env.DEBUG_SWITCH || "").trim() === "1") return true;

  const s = getDebugState();
  if (!s) return false;

  const f = s.filter || {};
  const hasAnyFilter = Boolean(f.telegramUserId || f.userId || f.teamId);
  if (!hasAnyFilter) return true;

  if (f.telegramUserId && input.telegramUserId && Number(f.telegramUserId) === Number(input.telegramUserId)) return true;
  if (f.userId && input.userId && String(f.userId) === String(input.userId)) return true;
  if (f.teamId && input.teamId && String(f.teamId) === String(input.teamId)) return true;
  return false;
}

