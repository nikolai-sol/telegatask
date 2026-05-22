import { SeoProviderError, SeoProviderNotConfiguredError } from "../seoDataProvider";

export type SistrixClientConfig = {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
};

export class SistrixProviderError extends SeoProviderError {
  constructor(input: {
    safeMessage: string;
    statusCode?: number;
    category: string;
    internalCause?: unknown;
  }) {
    super(input);
    this.name = "SistrixProviderError";
  }
}

function normalizeBaseUrl(value: string): string {
  const raw = String(value || "").trim() || "https://api.sistrix.com";
  return raw.replace(/\/+$/, "");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function classifyHttpError(status: number): SistrixProviderError {
  if (status === 401 || status === 403) {
    return new SistrixProviderError({
      safeMessage: "SISTRIX provider authentication failed",
      statusCode: 503,
      category: "auth",
      internalCause: { status },
    });
  }

  if (status === 429) {
    return new SistrixProviderError({
      safeMessage: "SISTRIX provider rate limit reached",
      statusCode: 503,
      category: "rate_limit",
      internalCause: { status },
    });
  }

  return new SistrixProviderError({
    safeMessage: "SISTRIX provider is temporarily unavailable",
    statusCode: 503,
    category: "http",
    internalCause: { status },
  });
}

function getSistrixErrorText(payload: unknown): string {
  if (!isObject(payload)) return "";
  if (typeof payload.error === "string") return payload.error;
  if (isObject(payload.error)) return JSON.stringify(payload.error).slice(0, 500);
  if (typeof payload.errormsg === "string") return payload.errormsg;
  if (typeof payload.error_message === "string") return payload.error_message;
  return "";
}

function errorFromSistrixPayload(payload: unknown): SistrixProviderError | null {
  const raw = getSistrixErrorText(payload);
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (lower.includes("api") && (lower.includes("key") || lower.includes("auth"))) {
    return new SistrixProviderError({
      safeMessage: "SISTRIX provider authentication failed",
      statusCode: 503,
      category: "auth",
    });
  }

  if (lower.includes("limit") || lower.includes("credit") || lower.includes("quota")) {
    return new SistrixProviderError({
      safeMessage: "SISTRIX provider rate limit reached",
      statusCode: 503,
      category: "rate_limit",
    });
  }

  return new SistrixProviderError({
    safeMessage: "SISTRIX provider returned an unexpected response",
    statusCode: 503,
    category: "vendor_error",
  });
}

export class SistrixClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config: SistrixClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.apiKey = String(config.apiKey || "").trim();
    this.timeoutMs = Math.max(1000, Number(config.timeoutMs || 12000));

    if (!this.apiKey) {
      throw new SeoProviderNotConfiguredError("SISTRIX provider is not configured yet");
    }
  }

  async requestJson(endpoint: string, params: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = new URL(`${this.baseUrl}/${endpoint.replace(/^\/+/, "")}`);
      url.searchParams.set("api_key", this.apiKey);
      url.searchParams.set("format", "json");
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }

      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { accept: "application/json" },
      });

      if (!response.ok) {
        throw classifyHttpError(response.status);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new SistrixProviderError({
          safeMessage: "SISTRIX provider returned an unexpected response",
          statusCode: 503,
          category: "parse",
          internalCause: error instanceof Error ? { name: error.name, message: error.message } : "parse_failed",
        });
      }

      const payloadError = errorFromSistrixPayload(payload);
      if (payloadError) throw payloadError;

      return payload;
    } catch (error) {
      if (error instanceof SeoProviderNotConfiguredError || error instanceof SistrixProviderError) {
        throw error;
      }

      const name = error instanceof Error ? error.name : "";
      const safeMessage = name === "AbortError"
        ? "SISTRIX provider is temporarily unavailable"
        : "SISTRIX provider is temporarily unavailable";

      throw new SistrixProviderError({
        safeMessage,
        statusCode: 503,
        category: name === "AbortError" ? "timeout" : "network",
        internalCause: error instanceof Error ? { name: error.name, message: error.message } : "network_error",
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
