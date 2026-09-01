import type { SeoDeviceType, SeoSearchConsoleSnapshot } from "../types";
import { SeoProviderError, SeoProviderNotConfiguredError } from "./seoDataProvider";
import { buildGscDateRange, parsePositiveInteger } from "./googleSearchConsoleConfig";
import {
  fetchBoundedProviderText,
  ProviderBodyLimitError,
  ProviderDeadlineError,
} from "./boundedProviderHttp";

type YandexOAuthTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type YandexUserResponse = {
  user_id?: number | string;
};

export type YandexHostEntry = {
  host_id?: string;
  ascii_host_url?: string;
  unicode_host_url?: string;
  verified?: boolean;
  main_mirror?: {
    host_id?: string;
    ascii_host_url?: string;
    unicode_host_url?: string;
    verified?: boolean;
  };
};

type YandexHostsResponse = {
  hosts?: YandexHostEntry[];
};

type YandexQueryIndicatorPoint = {
  date?: string;
  value?: number;
};

type YandexQueryHistoryResponse = {
  indicators?: Record<string, YandexQueryIndicatorPoint[]>;
};

type YandexPopularQuery = {
  query_text?: string;
  indicators?: Record<string, number>;
};

type YandexPopularQueriesResponse = {
  queries?: YandexPopularQuery[];
  date_from?: string;
  date_to?: string;
};

const API_BASE_URL = "https://api.webmaster.yandex.net/v4";
const OAUTH_TOKEN_URL = "https://oauth.yandex.ru/token";
export const OWNER_PROVIDER_REQUEST_TIMEOUT_MS = 15_000;
export const OWNER_PROVIDER_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type YandexWebmasterSourceDeps = {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
};

type OwnerHttpContext = {
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  signal?: AbortSignal;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readDeviceType(value: SeoDeviceType | null | undefined): string {
  if (value === "mobile") return "MOBILE";
  return cleanString(process.env.YANDEX_WEBMASTER_DEVICE_TYPE) || "ALL";
}

function boundedDependencyValue(value: number | undefined, maximum: number): number {
  if (!Number.isFinite(value)) return maximum;
  return Math.min(maximum, Math.max(1, Math.floor(value!)));
}

function failureReason(error: unknown): string {
  if (error instanceof ProviderDeadlineError) return "deadline";
  if (error instanceof ProviderBodyLimitError) return "body_limit";
  return "transport";
}

async function ownerRequest(
  context: OwnerHttpContext,
  url: string,
  init: RequestInit,
  category: string,
  safeMessage: string
): Promise<{ response: Response; text: string }> {
  try {
    return await fetchBoundedProviderText(
      context.fetchImpl,
      url,
      { ...init, ...(context.signal ? { signal: context.signal } : {}) },
      { timeoutMs: context.requestTimeoutMs, maximumBytes: context.maxResponseBytes }
    );
  } catch (error) {
    throw new SeoProviderError({
      category,
      safeMessage,
      statusCode: 502,
      internalCause: { reason: failureReason(error) },
    });
  }
}

function parseJson<T>(text: string, category: string, safeMessage: string): T {
  try {
    return JSON.parse(text || "{}") as T;
  } catch {
    throw new SeoProviderError({ category, safeMessage, statusCode: 502 });
  }
}

function ensureEnabled(): void {
  const enabled = cleanString(process.env.YANDEX_WEBMASTER_ENABLED).toLowerCase();
  if (enabled !== "true") {
    throw new SeoProviderNotConfiguredError("Yandex Webmaster source is not configured yet");
  }
}

async function refreshAccessToken(context: OwnerHttpContext): Promise<string> {
  const refreshToken = cleanString(process.env.YANDEX_WEBMASTER_REFRESH_TOKEN);
  const clientId = cleanString(process.env.YANDEX_WEBMASTER_CLIENT_ID);
  const clientSecret = cleanString(process.env.YANDEX_WEBMASTER_CLIENT_SECRET);
  if (!refreshToken) return "";
  if (!clientId || !clientSecret) {
    throw new SeoProviderNotConfiguredError("Yandex Webmaster OAuth client credentials are not configured yet");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const { response, text } = await ownerRequest(context, OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  }, "yandex_webmaster_auth", "Yandex Webmaster token refresh failed");
  const json = parseJson<YandexOAuthTokenResponse>(
    text,
    "yandex_webmaster_auth",
    "Yandex Webmaster token refresh failed"
  );
  if (!response.ok || !json.access_token) {
    throw new SeoProviderError({
      category: "yandex_webmaster_auth",
      statusCode: 502,
      safeMessage: "Yandex Webmaster token refresh failed",
      internalCause: {
        status: response.status,
      },
    });
  }
  return json.access_token;
}

async function getAccessToken(context: OwnerHttpContext): Promise<string> {
  const directToken = cleanString(process.env.YANDEX_WEBMASTER_OAUTH_TOKEN);
  if (directToken) return directToken;
  const refreshed = await refreshAccessToken(context);
  if (refreshed) return refreshed;
  throw new SeoProviderNotConfiguredError("Yandex Webmaster OAuth token is not configured yet");
}

async function webmasterGet<T>(
  path: string,
  accessToken: string,
  context: OwnerHttpContext,
  params?: URLSearchParams
): Promise<T> {
  const query = params && params.toString() ? `?${params.toString()}` : "";
  const { response, text } = await ownerRequest(context, `${API_BASE_URL}${path}${query}`, {
    headers: {
      Authorization: `OAuth ${accessToken}`,
      Accept: "application/json",
    },
  }, "yandex_webmaster_request", "Yandex Webmaster request failed");
  if (!response.ok) {
    throw new SeoProviderError({
      category: "yandex_webmaster_request",
      statusCode: response.status >= 500 ? 502 : 503,
      safeMessage: "Yandex Webmaster request failed",
      internalCause: {
        status: response.status,
        path,
      },
    });
  }
  return parseJson<T>(text, "yandex_webmaster_invalid_json", "Yandex Webmaster returned invalid data");
}

function exactOrigin(value: string): string | undefined {
  const text = cleanString(value);
  if (!text) return undefined;
  const hostId = /^(https?):([^/:]+):(\d+)$/i.exec(text);
  const input = hostId
    ? `${hostId[1]}://${hostId[2]}:${hostId[3]}/`
    : /^https?:\/\//i.test(text)
      ? text
      : "";
  if (!input) return undefined;
  try {
    const url = new URL(input);
    return !url.username && !url.password && (url.protocol === "http:" || url.protocol === "https:")
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

/** Select only an exact, verified audited origin; a configured id is only a filter. */
export function selectVerifiedYandexHost(
  hosts: YandexHostEntry[],
  auditedTarget: string,
  configuredHostId = cleanString(process.env.YANDEX_WEBMASTER_HOST_ID)
): YandexHostEntry | null {
  const targetOrigin = exactOrigin(auditedTarget);
  if (!targetOrigin) return null;
  return hosts.find((host) => {
    if (!host.verified) return false;
    if (configuredHostId && cleanString(host.host_id) !== configuredHostId) return false;
    const identities = [host.host_id, host.ascii_host_url, host.unicode_host_url]
      .map((value) => exactOrigin(cleanString(value)))
      .filter((value): value is string => Boolean(value));
    return identities.length > 0 && identities.every((origin) => origin === targetOrigin);
  }) || null;
}

function sumIndicator(points: YandexQueryIndicatorPoint[] | undefined): number | null {
  if (!Array.isArray(points)) return null;
  const values = points.map((item) => safeNumber(item.value)).filter((item): item is number => item !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function weightedAveragePosition(
  positions: YandexQueryIndicatorPoint[] | undefined,
  weights: YandexQueryIndicatorPoint[] | undefined
): number | null {
  if (!Array.isArray(positions)) return null;
  let weighted = 0;
  let weightSum = 0;
  for (const position of positions) {
    const value = safeNumber(position.value);
    if (value === null) continue;
    const weight = weights?.find((item) => item.date === position.date)?.value;
    const normalizedWeight = typeof weight === "number" && Number.isFinite(weight) && weight > 0 ? weight : 1;
    weighted += value * normalizedWeight;
    weightSum += normalizedWeight;
  }
  return weightSum > 0 ? weighted / weightSum : null;
}

function extractTopQueries(response: YandexPopularQueriesResponse): string[] {
  return (response.queries || [])
    .map((item) => cleanString(item.query_text))
    .filter(Boolean)
    .slice(0, 10);
}

export class YandexWebmasterSeoSource {
  private readonly fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(deps: YandexWebmasterSourceDeps = {}) {
    this.fetchImpl = deps.fetchImpl || ((url, init) => fetch(url, init));
    this.requestTimeoutMs = boundedDependencyValue(deps.requestTimeoutMs, OWNER_PROVIDER_REQUEST_TIMEOUT_MS);
    this.maxResponseBytes = boundedDependencyValue(deps.maxResponseBytes, OWNER_PROVIDER_MAX_RESPONSE_BYTES);
  }

  async getSnapshot(
    domain: string,
    options?: { device?: SeoDeviceType | null },
    signal?: AbortSignal
  ): Promise<SeoSearchConsoleSnapshot> {
    const context: OwnerHttpContext = {
      fetchImpl: this.fetchImpl,
      requestTimeoutMs: this.requestTimeoutMs,
      maxResponseBytes: this.maxResponseBytes,
      ...(signal ? { signal } : {}),
    };
    ensureEnabled();
    const accessToken = await getAccessToken(context);
    const user = await webmasterGet<YandexUserResponse>("/user", accessToken, context);
    const userId = cleanString(String(user.user_id || ""));
    if (!userId) {
      throw new SeoProviderError({
        category: "yandex_webmaster_user",
        safeMessage: "Yandex Webmaster user lookup failed",
        statusCode: 502,
      });
    }

    const hosts = await webmasterGet<YandexHostsResponse>(`/user/${encodeURIComponent(userId)}/hosts`, accessToken, context);
    const host = selectVerifiedYandexHost(hosts.hosts || [], domain);
    const hostId = cleanString(host?.host_id);
    if (!host || !hostId) {
      throw new SeoProviderNotConfiguredError(
        `Yandex Webmaster account does not have access to a verified host for ${domain}`
      );
    }

    const dateRangeDays = parsePositiveInteger(process.env.YANDEX_WEBMASTER_DEFAULT_DATE_RANGE_DAYS, 7);
    const dateRange = buildGscDateRange(dateRangeDays);
    const commonParams = new URLSearchParams();
    commonParams.append("query_indicator", "TOTAL_SHOWS");
    commonParams.append("query_indicator", "TOTAL_CLICKS");
    commonParams.append("query_indicator", "AVG_SHOW_POSITION");
    commonParams.append("query_indicator", "AVG_CLICK_POSITION");
    commonParams.set("device_type_indicator", readDeviceType(options?.device));
    if (dateRange.startDate) commonParams.set("date_from", dateRange.startDate);
    if (dateRange.endDate) commonParams.set("date_to", dateRange.endDate);

    const [history, popular] = await Promise.all([
      webmasterGet<YandexQueryHistoryResponse>(
        `/user/${encodeURIComponent(userId)}/hosts/${encodeURIComponent(hostId)}/search-queries/all/history`,
        accessToken,
        context,
        commonParams
      ),
      webmasterGet<YandexPopularQueriesResponse>(
        `/user/${encodeURIComponent(userId)}/hosts/${encodeURIComponent(hostId)}/search-queries/popular`,
        accessToken,
        context,
        new URLSearchParams({
          order_by: "TOTAL_SHOWS",
          query_indicator: "TOTAL_SHOWS",
          device_type_indicator: readDeviceType(options?.device),
          limit: "10",
          ...(dateRange.startDate ? { date_from: dateRange.startDate } : {}),
          ...(dateRange.endDate ? { date_to: dateRange.endDate } : {}),
        })
      ),
    ]);

    const indicators = history.indicators || {};
    const impressions = sumIndicator(indicators.TOTAL_SHOWS);
    const clicks = sumIndicator(indicators.TOTAL_CLICKS);
    const ctr = impressions && clicks !== null ? (clicks / impressions) * 100 : null;
    const averagePosition =
      weightedAveragePosition(indicators.AVG_SHOW_POSITION, indicators.TOTAL_SHOWS) ??
      weightedAveragePosition(indicators.AVG_CLICK_POSITION, indicators.TOTAL_CLICKS);

    return {
      property: hostId,
      siteUrl: cleanString(host.ascii_host_url) || cleanString(host.unicode_host_url) || null,
      dateRange: {
        startDate: popular.date_from || dateRange.startDate,
        endDate: popular.date_to || dateRange.endDate,
        days: dateRangeDays,
      },
      clicks,
      impressions,
      ctr,
      averagePosition,
      topQueries: extractTopQueries(popular),
      topPages: [],
      countries: [],
      devices: [readDeviceType(options?.device)],
    };
  }
}
