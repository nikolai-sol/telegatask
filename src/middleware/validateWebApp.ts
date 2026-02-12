/**
 * Middleware: validate Telegram WebApp initData
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
import crypto from "crypto";
import { Request, Response, NextFunction } from "express";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

export interface WebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/** Parsed & validated initData attached to request */
export interface ValidatedWebAppData {
  user: WebAppUser;
  authDate: number;
  hash: string;
  queryId?: string;
}

/** Extend Express Request */
declare global {
  namespace Express {
    interface Request {
      webAppData?: ValidatedWebAppData;
    }
  }
}

/**
 * Validate Telegram Mini App initData using HMAC-SHA256
 * Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(initData: string): ValidatedWebAppData | null {
  if (!initData || !BOT_TOKEN) return null;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;

    // Build data-check-string (sorted params excluding hash)
    params.delete("hash");
    const entries = Array.from(params.entries());
    entries.sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

    // HMAC-SHA256
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(BOT_TOKEN)
      .digest();

    const computedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (computedHash !== hash) {
      console.warn("[WebApp] Invalid hash");
      return null;
    }

    // Check auth_date is not too old (allow 24 hours)
    const authDate = parseInt(params.get("auth_date") || "0", 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 86400) {
      console.warn("[WebApp] initData expired");
      return null;
    }

    // Parse user
    const userStr = params.get("user");
    if (!userStr) return null;

    const user: WebAppUser = JSON.parse(userStr);

    return {
      user,
      authDate,
      hash,
      queryId: params.get("query_id") || undefined,
    };
  } catch (err) {
    console.error("[WebApp] validateInitData error:", err);
    return null;
  }
}

/**
 * Express middleware — validates X-Telegram-Init-Data header
 */
export function webAppAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const initData = req.headers["x-telegram-init-data"] as string | undefined;

  if (!initData) {
    res.status(401).json({ error: "Missing init data" });
    return;
  }

  const validated = validateInitData(initData);
  if (!validated) {
    res.status(403).json({ error: "Invalid init data" });
    return;
  }

  req.webAppData = validated;
  next();
}
