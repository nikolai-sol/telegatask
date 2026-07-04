import type { SeoDeviceType, SeoSearchConsoleSnapshot } from "../types";
import { SeoProviderError, SeoProviderNotConfiguredError } from "./seoDataProvider";
import { buildGscDateRange, parsePositiveInteger } from "./googleSearchConsoleConfig";

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

type YandexHostEntry = {
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

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeDomain(value: string): string {
  const trimmed = cleanString(value);
  if (!trimmed) return "";
  try {
    return new URL(trimmed).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return trimmed
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/.*$/, "")
      .toLowerCase();
  }
}

function readDeviceType(value: SeoDeviceType | null | undefined): string {
  if (value === "mobile") return "MOBILE";
  return cleanString(process.env.YANDEX_WEBMASTER_DEVICE_TYPE) || "ALL";
}

async function parseJson<T>(response: Response, category: string, safeMessage: string): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new SeoProviderError({
      category,
      safeMessage,
      statusCode: 502,
      internalCause: error,
    });
  }
}

async function parseErrorBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}

function ensureEnabled(): void {
  const enabled = cleanString(process.env.YANDEX_WEBMASTER_ENABLED).toLowerCase();
  if (enabled !== "true") {
    throw new SeoProviderNotConfiguredError("Yandex Webmaster source is not configured yet");
  }
}

async function refreshAccessToken(): Promise<string> {
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
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = await parseJson<YandexOAuthTokenResponse>(
    response,
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
        body: json.error_description || json.error || json,
      },
    });
  }
  return json.access_token;
}

async function getAccessToken(): Promise<string> {
  const directToken = cleanString(process.env.YANDEX_WEBMASTER_OAUTH_TOKEN);
  if (directToken) return directToken;
  const refreshed = await refreshAccessToken();
  if (refreshed) return refreshed;
  throw new SeoProviderNotConfiguredError("Yandex Webmaster OAuth token is not configured yet");
}

async function webmasterGet<T>(path: string, accessToken: string, params?: URLSearchParams): Promise<T> {
  const query = params && params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`${API_BASE_URL}${path}${query}`, {
    headers: {
      Authorization: `OAuth ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new SeoProviderError({
      category: "yandex_webmaster_request",
      statusCode: response.status >= 500 ? 502 : 503,
      safeMessage: "Yandex Webmaster request failed",
      internalCause: {
        status: response.status,
        body: await parseErrorBody(response),
        path,
      },
    });
  }
  return parseJson<T>(response, "yandex_webmaster_invalid_json", "Yandex Webmaster returned invalid data");
}

function hostMatchesDomain(host: YandexHostEntry, domain: string): boolean {
  const normalizedDomain = normalizeDomain(domain);
  const candidates = [
    host.ascii_host_url,
    host.unicode_host_url,
    host.main_mirror?.ascii_host_url,
    host.main_mirror?.unicode_host_url,
  ].map((item) => normalizeDomain(cleanString(item)));
  return candidates.some(
    (candidate) =>
      candidate === normalizedDomain ||
      candidate.endsWith(`.${normalizedDomain}`) ||
      normalizedDomain.endsWith(`.${candidate}`)
  );
}

function pickHost(hosts: YandexHostEntry[], domain: string): YandexHostEntry | null {
  const configuredHostId = cleanString(process.env.YANDEX_WEBMASTER_HOST_ID);
  if (configuredHostId) {
    return hosts.find((host) => cleanString(host.host_id) === configuredHostId) || null;
  }
  return hosts.find((host) => host.verified && hostMatchesDomain(host, domain)) || null;
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
  async getSnapshot(
    domain: string,
    options?: { device?: SeoDeviceType | null }
  ): Promise<SeoSearchConsoleSnapshot> {
    ensureEnabled();
    const accessToken = await getAccessToken();
    const user = await webmasterGet<YandexUserResponse>("/user", accessToken);
    const userId = cleanString(String(user.user_id || ""));
    if (!userId) {
      throw new SeoProviderError({
        category: "yandex_webmaster_user",
        safeMessage: "Yandex Webmaster user lookup failed",
        statusCode: 502,
      });
    }

    const hosts = await webmasterGet<YandexHostsResponse>(`/user/${encodeURIComponent(userId)}/hosts`, accessToken);
    const host = pickHost(hosts.hosts || [], domain);
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
        commonParams
      ),
      webmasterGet<YandexPopularQueriesResponse>(
        `/user/${encodeURIComponent(userId)}/hosts/${encodeURIComponent(hostId)}/search-queries/popular`,
        accessToken,
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
