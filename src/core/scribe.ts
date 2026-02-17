import { AsyncLocalStorage } from "node:async_hooks";
import { logAction } from "../repositories/actionLogRepository";
import { getScribeEnabledByTelegramUserId, setScribeEnabledByTelegramUserId } from "../repositories/scribeRepository";

type ScribeActor = {
  source: "bot" | "miniapp_api";
  telegramUserId: number;
  telegramUsername: string | null;
  telegramChatId?: number | null;
};

const als = new AsyncLocalStorage<ScribeActor>();

export function runWithScribeActor<T>(actor: ScribeActor, fn: () => T): T {
  return als.run(actor, fn);
}

export function getScribeActor(): ScribeActor | null {
  return als.getStore() ?? null;
}

function normalizeUsername(username: string | null | undefined): string {
  return String(username ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function getFirstEnvUsername(raw: string | undefined): string {
  const first = String(raw ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^@/, ""))
    .filter(Boolean)[0];
  return normalizeUsername(first ?? "");
}

function getScribeOwnerUsername(): string {
  const explicit = normalizeUsername(process.env.SCRIBE_OWNER_USERNAME ?? "");
  if (explicit) return explicit;
  // Default: use the first SUPERADMINS entry (usually a single owner).
  return getFirstEnvUsername(process.env.SUPERADMINS);
}

export function isScribeOwner(input: { telegramUserId: number; telegramUsername?: string | null }): boolean {
  if (String(process.env.SCRIBE_MODE || "").trim() !== "1") return false;

  const ownerIdRaw = String(process.env.SCRIBE_OWNER_TELEGRAM_ID ?? "").trim();
  if (ownerIdRaw) {
    return ownerIdRaw === String(input.telegramUserId);
  }

  const ownerUsername = getScribeOwnerUsername();
  if (!ownerUsername) return false;

  const u = normalizeUsername(input.telegramUsername ?? "");
  return Boolean(u && u === ownerUsername);
}

type CacheEntry = { enabled: boolean; expiresAtMs: number };
const enabledCache = new Map<number, CacheEntry>();
const CACHE_TTL_MS = 30_000;

export async function isScribeEnabledForTelegramUserAsync(input: {
  telegramUserId: number;
  telegramUsername?: string | null;
}): Promise<boolean> {
  if (String(process.env.SCRIBE_MODE || "").trim() !== "1") return false;
  if (!isScribeOwner(input)) return false;

  const forceOn = String(process.env.SCRIBE_FORCE_ON || "").trim() === "1";

  const now = Date.now();
  const cached = enabledCache.get(input.telegramUserId);
  if (cached && cached.expiresAtMs > now) return cached.enabled;

  if (forceOn) {
    enabledCache.set(input.telegramUserId, { enabled: true, expiresAtMs: now + CACHE_TTL_MS });
    return true;
  }

  let dbFlag: boolean | null = null;
  try {
    dbFlag = await getScribeEnabledByTelegramUserId(input.telegramUserId);
  } catch (e) {
    // Don't let debug logging take down production flows when Firestore is rate-limited.
    console.warn("[scribe] failed to read debug flag:", (e as any)?.message || e);
    dbFlag = null;
  }

  // Default OFF; can be toggled at runtime via bot commands.
  const enabled = typeof dbFlag === "boolean" ? dbFlag : false;
  enabledCache.set(input.telegramUserId, { enabled, expiresAtMs: now + CACHE_TTL_MS });
  return enabled;
}

export async function setScribeEnabledForTelegramUser(input: {
  telegramUserId: number;
  enabled: boolean;
  updatedByTelegramUserId: number;
}): Promise<void> {
  await setScribeEnabledByTelegramUserId({
    telegramUserId: input.telegramUserId,
    enabled: input.enabled,
    updatedByTelegramUserId: input.updatedByTelegramUserId,
  });
  enabledCache.delete(input.telegramUserId);
}

function sanitize(value: unknown, depth: number, maxDepth: number): unknown {
  if (depth > maxDepth) return "[MaxDepth]";
  if (value == null) return value;

  const t = typeof value;
  if (t === "string") {
    const s = value as string;
    if (s.length > 2000) return s.slice(0, 2000) + "…[truncated]";
    return s;
  }
  if (t === "number" || t === "boolean") return value;
  if (t === "bigint") return String(value);
  if (t === "function") return "[Function]";

  if (Array.isArray(value)) {
    const arr = value;
    const max = 50;
    const head = arr.slice(0, max).map((v) => sanitize(v, depth + 1, maxDepth));
    if (arr.length > max) {
      head.push(`[+${arr.length - max} more]`);
    }
    return head;
  }

  if (value instanceof Date) return value.toISOString();

  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj);
    const maxKeys = 80;
    for (const k of keys.slice(0, maxKeys)) {
      const keyLower = k.toLowerCase();
      if (
        keyLower.includes("token") ||
        keyLower.includes("secret") ||
        keyLower.includes("password") ||
        keyLower.includes("authorization") ||
        keyLower.includes("initdata")
      ) {
        out[k] = "[REDACTED]";
        continue;
      }
      out[k] = sanitize(obj[k], depth + 1, maxDepth);
    }
    if (keys.length > maxKeys) out.__truncatedKeys = keys.length - maxKeys;
    return out;
  }

  try {
    return String(value);
  } catch {
    return "[Unserializable]";
  }
}

export function toSafeJson(value: unknown, opts?: { maxChars?: number; maxDepth?: number }): string {
  const maxChars = opts?.maxChars ?? 20000;
  const maxDepth = opts?.maxDepth ?? 6;
  let str = "";
  try {
    str = JSON.stringify(sanitize(value, 0, maxDepth));
  } catch {
    str = JSON.stringify({ error: "failed_to_stringify" });
  }
  if (str.length <= maxChars) return str;
  return str.slice(0, maxChars) + "…[truncated]";
}

type ScribeSink = "console" | "firestore" | "both";

function getScribeSink(): ScribeSink {
  const raw = String(process.env.SCRIBE_SINK || "").trim().toLowerCase();
  if (raw === "firestore") return "firestore";
  if (raw === "both") return "both";
  return "console";
}

function logScribeConsoleLine(action: string, data: Record<string, unknown>): void {
  try {
    // Keep this line reasonably small; PM2 logs are the source of truth when Firestore is rate-limited.
    const line = toSafeJson({ action, ...data }, { maxChars: 8000, maxDepth: 6 });
    // eslint-disable-next-line no-console
    console.log(`[SCRIBE] ${line}`);
  } catch {
    // ignore
  }
}

export function scribeLog(
  action: "scribe_tg_in" | "scribe_tg_out" | "scribe_api_req" | "scribe_api_res",
  payload: Record<string, unknown>
): void {
  // Hard gate: if SCRIBE_MODE is off, no scribe output anywhere (stdout/PM2/Firestore).
  if (String(process.env.SCRIBE_MODE || "").trim() !== "1") return;

  const actor = getScribeActor();
  const sink = getScribeSink();

  const entry = {
    userId: null,
    targetId: actor ? String(actor.telegramUserId) : null,
    targetType: actor?.source ?? null,
    payload: actor ? { actor, ...payload } : payload,
  };

  if (sink === "console" || sink === "both") {
    logScribeConsoleLine(action, entry as any);
  }

  if (sink === "firestore" || sink === "both") {
    logAction({ action, ...entry }).catch(() => {});
  }
}
