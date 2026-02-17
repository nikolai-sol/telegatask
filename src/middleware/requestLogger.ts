import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logInfo, logWarn, logError } from "../core/logger";
import { runWithRequestTelemetry, type RequestTelemetry } from "../core/telemetry/requestTelemetry";
import { isDebugEnabledForRequest } from "../core/debugSwitch";

function getRequestId(): string {
  // Short enough for log lines, unique enough for correlation.
  try {
    return crypto.randomUUID().slice(0, 12);
  } catch {
    return String(Date.now());
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Avoid logging static assets; it will explode logs.
  const path = String(req.path || "");
  if (path.startsWith("/mini-app")) return next();

  // Only log "API-like" routes by default.
  const shouldLog = path.startsWith("/api/") || path.startsWith("/debug/") || path.startsWith("/health");
  if (!shouldLog) return next();

  const requestId = getRequestId();
  // Make it visible to clients / debugging.
  res.setHeader("X-Request-Id", requestId);
  (res.locals as any).requestId = requestId;

  const startNs = process.hrtime.bigint();
  const method = String(req.method || "GET").toUpperCase();
  const route = String(req.originalUrl || req.url || path);

  const telemetry: RequestTelemetry = {
    requestId,
    firestoreReads: 0,
    firestoreWrites: 0,
    firestoreReadOps: 0,
    firestoreWriteOps: 0,
    firestoreOps: {},
  };
  (res.locals as any).telemetry = telemetry;

  runWithRequestTelemetry(telemetry, () => {
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      const status = res.statusCode || 0;

      const t = (res.locals as any).telemetry as RequestTelemetry | undefined;
      const debug = isDebugEnabledForRequest({
        telegramUserId: (res.locals as any).telegramUserId ?? null,
        userId: (res.locals as any).userId ?? null,
        teamId: (res.locals as any).teamId ?? null,
      });

      const rawUrl = String(req.originalUrl || req.url || "");
      const idx = rawUrl.indexOf("?");
      const qs = idx >= 0 ? rawUrl.slice(idx + 1) : "";
      const queryHash = qs ? crypto.createHash("sha1").update(qs).digest("hex").slice(0, 12) : null;

      const fields: Record<string, unknown> = {
        requestId,
        method,
        route: route.split("?")[0],
        status,
        durationMs: Math.round(durationMs),
        userId: (res.locals as any).userId ?? null,
        teamId: (res.locals as any).teamId ?? null,
        role: (res.locals as any).role ?? null,
        scope: (res.locals as any).scope ?? null,
        bucket: (res.locals as any).bucket ?? null,
        telegramUserId: (res.locals as any).telegramUserId ?? null,
        xCache: (res.getHeader("X-Cache") as string | undefined) ?? null,
        docsReturned: (res.locals as any).docsReturned ?? null,
        firestoreReads: t?.firestoreReads ?? null,
        firestoreWrites: t?.firestoreWrites ?? null,
        firestoreReadOps: t?.firestoreReadOps ?? null,
        firestoreWriteOps: t?.firestoreWriteOps ?? null,
      };

      if (debug) {
        fields.debug = true;
        fields.queryHash = queryHash;
        fields.ua = String(req.headers["user-agent"] || "").slice(0, 180) || null;
        fields.firestoreOps = t?.firestoreOps ?? null;
      }

      if (status >= 500) {
        logError("http_request", fields);
      } else if (status >= 400) {
        // 4xx are expected sometimes (auth/permissions), keep as WARN for visibility.
        logWarn("http_request", fields);
      } else {
        logInfo("http_request", fields);
      }
    });

    next();
  });
}
