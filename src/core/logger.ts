import crypto from "crypto";

export type LogLevel = "debug" | "info" | "warn" | "error" | "off";

function getLogLevel(): LogLevel {
  const raw = String(process.env.LOG_LEVEL || "").trim().toLowerCase();
  if (raw === "debug") return "debug";
  if (raw === "info") return "info";
  if (raw === "warn" || raw === "warning") return "warn";
  if (raw === "error") return "error";
  if (raw === "off" || raw === "0" || raw === "false") return "off";
  // Default: production-leaning but still useful.
  return "info";
}

const LEVEL_ORDER: Record<Exclude<LogLevel, "off">, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function shouldLog(level: Exclude<LogLevel, "off">): boolean {
  const configured = getLogLevel();
  if (configured === "off") return false;
  // WARN/ERROR always (per product logging rules).
  if (level === "warn" || level === "error") return true;
  return LEVEL_ORDER[level] >= LEVEL_ORDER[configured];
}

function safeHash(input: string): string {
  try {
    return crypto.createHash("sha1").update(input).digest("hex").slice(0, 12);
  } catch {
    return "hash_error";
  }
}

function shouldHashStringForKey(keyPath: string): boolean {
  const k = keyPath.toLowerCase();
  if (!k) return false;
  // Never log user content / payload bodies.
  if (k.includes("payload")) return true;
  if (k.includes("body")) return true;
  if (k.includes("text")) return true;
  if (k.includes("title")) return true;
  if (k.includes("description")) return true;
  if (k.includes("message")) return true;
  return false;
}

function isSensitiveKey(keyPath: string): boolean {
  const k = keyPath.toLowerCase();
  return (
    k.includes("token") ||
    k.includes("secret") ||
    k.includes("password") ||
    k.includes("authorization") ||
    k.includes("initdata")
  );
}

function sanitizeValue(value: unknown, keyPath: string, depth: number, maxDepth: number): unknown {
  if (depth > maxDepth) return "[MaxDepth]";
  if (value == null) return value;
  if (typeof value === "string") {
    if (isSensitiveKey(keyPath)) return "[REDACTED]";
    const s = value;
    if (shouldHashStringForKey(keyPath)) {
      // Never log user content; keep only length + hash for correlation.
      return { strLen: s.length, sha1_12: safeHash(s) };
    }
    // Operational fields: keep as-is (but cap size).
    const MAX = 300;
    if (s.length <= MAX) return s;
    return s.slice(0, MAX) + "…[truncated]";
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "function") return "[Function]";
  if (Array.isArray(value)) {
    const max = 50;
    const head = value
      .slice(0, max)
      .map((v, i) => sanitizeValue(v, `${keyPath}[${i}]`, depth + 1, maxDepth));
    if (value.length > max) head.push({ more: value.length - max });
    return head;
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj);
    const maxKeys = 80;
    for (const k of keys.slice(0, maxKeys)) {
      const nextPath = keyPath ? `${keyPath}.${k}` : k;
      out[k] = sanitizeValue(obj[k], nextPath, depth + 1, maxDepth);
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
  const maxChars = opts?.maxChars ?? 4000;
  const maxDepth = opts?.maxDepth ?? 4;
  let str = "";
  try {
    str = JSON.stringify(sanitizeValue(value, "", 0, maxDepth));
  } catch {
    str = JSON.stringify({ error: "failed_to_stringify" });
  }
  if (str.length <= maxChars) return str;
  return str.slice(0, maxChars) + "…[truncated]";
}

export function log(
  level: Exclude<LogLevel, "off">,
  msg: string,
  fields?: Record<string, unknown>
): void {
  if (!shouldLog(level)) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields ? fields : {}),
  };
  // eslint-disable-next-line no-console
  console.log(toSafeJson(line, { maxChars: 8000, maxDepth: 5 }));
}

export function logInfo(msg: string, fields?: Record<string, unknown>): void {
  log("info", msg, fields);
}
export function logWarn(msg: string, fields?: Record<string, unknown>): void {
  log("warn", msg, fields);
}
export function logError(msg: string, fields?: Record<string, unknown>): void {
  log("error", msg, fields);
}
