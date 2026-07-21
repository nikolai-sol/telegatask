import type { ZarukuSeoProductionConfig } from "../zarukuSeoProductionConfig";
import { cleanNumber, cleanString, type YandexWebmasterQuery } from "../zarukuWgdRunnerHelpers";

type YandexWebmasterEnv = Partial<
  Record<
    | "YANDEX_WEBMASTER_OAUTH_TOKEN"
    | "YANDEX_WEBMASTER_REFRESH_TOKEN"
    | "YANDEX_WEBMASTER_CLIENT_ID"
    | "YANDEX_WEBMASTER_CLIENT_SECRET",
    string
  >
>;

type YandexWebmasterResponse = Pick<Response, "ok" | "status" | "json">;

export type YandexQueryHistoryFetch = (url: string, init?: RequestInit) => Promise<YandexWebmasterResponse>;
export type YandexQueryHistoryNow = () => Date;

type QueryHistoryConfig = Pick<
  ZarukuSeoProductionConfig,
  "domain" | "yandexPopularQueryLimit" | "yandexQueryHistoryWindowDays"
>;

type QueryHistoryDeps = {
  env?: YandexWebmasterEnv;
  fetchImpl?: YandexQueryHistoryFetch;
  now?: YandexQueryHistoryNow;
};

export type YandexQueryHistoryDateRange = {
  startDate: string;
  endDate: string;
  days: number;
};

export type YandexQueryHistoryCollection = {
  schemaVersion: "seo_os_yandex_query_history_raw_v1";
  source: "yandex_webmaster";
  hostId: string | null;
  siteUrl: string | null;
  dateRange: YandexQueryHistoryDateRange;
  requestCount: number;
  endpointPaths: string[];
  rows: YandexWebmasterQuery[];
  raw: {
    history: Record<string, unknown>;
    popularQueries: Record<string, unknown>;
  };
};

const API_BASE_URL = "https://api.webmaster.yandex.net/v4";
const OAUTH_TOKEN_URL = "https://oauth.yandex.ru/token";

function defaultFetch(url: string, init?: RequestInit): Promise<YandexWebmasterResponse> {
  return fetch(url, init);
}

function readProcessEnv(): YandexWebmasterEnv {
  return {
    YANDEX_WEBMASTER_OAUTH_TOKEN: process.env.YANDEX_WEBMASTER_OAUTH_TOKEN,
    YANDEX_WEBMASTER_REFRESH_TOKEN: process.env.YANDEX_WEBMASTER_REFRESH_TOKEN,
    YANDEX_WEBMASTER_CLIENT_ID: process.env.YANDEX_WEBMASTER_CLIENT_ID,
    YANDEX_WEBMASTER_CLIENT_SECRET: process.env.YANDEX_WEBMASTER_CLIENT_SECRET,
  };
}

async function parseJson(response: YandexWebmasterResponse): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function queryHistoryDateRange(input: {
  now: YandexQueryHistoryNow;
  days: number;
}): YandexQueryHistoryDateRange {
  const safeDays = input.days > 0 ? input.days : 28;
  const end = input.now();
  end.setDate(end.getDate() - 3);
  const start = new Date(end);
  start.setDate(end.getDate() - (safeDays - 1));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    days: safeDays,
  };
}

async function getAccessToken(input: {
  env: YandexWebmasterEnv;
  fetchImpl: YandexQueryHistoryFetch;
  request: (url: string, init?: RequestInit) => Promise<YandexWebmasterResponse>;
}): Promise<string> {
  const direct = cleanString(input.env.YANDEX_WEBMASTER_OAUTH_TOKEN);
  if (direct) return direct;
  const refreshToken = cleanString(input.env.YANDEX_WEBMASTER_REFRESH_TOKEN);
  if (!refreshToken) return "";
  const response = await input.request(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: cleanString(input.env.YANDEX_WEBMASTER_CLIENT_ID),
      client_secret: cleanString(input.env.YANDEX_WEBMASTER_CLIENT_SECRET),
    }),
  });
  const json = await parseJson(response);
  return cleanString(json.access_token);
}

function hostMatchesDomain(host: Record<string, unknown>, domain: string): boolean {
  const ascii = cleanString(host.ascii_host_url);
  const unicode = cleanString(host.unicode_host_url);
  return ascii.includes(domain) || unicode.includes(domain);
}

async function yandexGet(input: {
  pathname: string;
  accessToken: string;
  request: (url: string, init?: RequestInit) => Promise<YandexWebmasterResponse>;
  params?: URLSearchParams;
}): Promise<Record<string, unknown>> {
  const query = input.params && input.params.toString() ? `?${input.params.toString()}` : "";
  const response = await input.request(`${API_BASE_URL}${input.pathname}${query}`, {
    headers: {
      Authorization: `OAuth ${input.accessToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) return { errorStatus: response.status };
  return parseJson(response);
}

function indicatorValue(indicators: unknown, key: string): number | null {
  if (!indicators || typeof indicators !== "object") return null;
  return cleanNumber((indicators as Record<string, unknown>)[key]);
}

function queryRowsFromPopular(response: Record<string, unknown>): YandexWebmasterQuery[] {
  const queries = Array.isArray(response.queries) ? response.queries : [];
  return queries
    .map((item) => {
      const data = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const impressions = indicatorValue(data.indicators, "TOTAL_SHOWS");
      const clicks = indicatorValue(data.indicators, "TOTAL_CLICKS");
      return {
        query: cleanString(data.query_text),
        impressions,
        clicks,
        ctr: impressions && clicks !== null ? (clicks / impressions) * 100 : null,
        averagePosition: indicatorValue(data.indicators, "AVG_SHOW_POSITION"),
      };
    })
    .filter((item) => item.query);
}

function queryParams(input: {
  dateRange: YandexQueryHistoryDateRange;
  limit?: number;
  includeOrder?: boolean;
}): URLSearchParams {
  const params = new URLSearchParams({
    device_type_indicator: "ALL",
    date_from: input.dateRange.startDate,
    date_to: input.dateRange.endDate,
  });
  if (input.includeOrder) {
    params.set("order_by", "TOTAL_SHOWS");
    params.set("limit", String(input.limit || 50));
  }
  params.append("query_indicator", "TOTAL_SHOWS");
  params.append("query_indicator", "TOTAL_CLICKS");
  params.append("query_indicator", "AVG_SHOW_POSITION");
  return params;
}

export async function collectYandexQueryHistory(
  config: QueryHistoryConfig,
  deps: QueryHistoryDeps = {}
): Promise<YandexQueryHistoryCollection> {
  const env = deps.env || readProcessEnv();
  const fetchImpl = deps.fetchImpl || defaultFetch;
  const now = deps.now || (() => new Date());
  let requestCount = 0;
  const endpointPaths: string[] = [];
  const request = async (url: string, init?: RequestInit) => {
    requestCount += 1;
    if (url.startsWith(API_BASE_URL)) {
      endpointPaths.push(new URL(url).pathname.replace("/v4", ""));
    } else {
      endpointPaths.push(new URL(url).pathname);
    }
    return fetchImpl(url, init);
  };
  const dateRange = queryHistoryDateRange({
    now,
    days: config.yandexQueryHistoryWindowDays,
  });
  const empty: YandexQueryHistoryCollection = {
    schemaVersion: "seo_os_yandex_query_history_raw_v1",
    source: "yandex_webmaster",
    hostId: null,
    siteUrl: null,
    dateRange,
    requestCount,
    endpointPaths,
    rows: [],
    raw: {
      history: {},
      popularQueries: {},
    },
  };
  const accessToken = await getAccessToken({ env, fetchImpl, request });
  if (!accessToken) return { ...empty, requestCount, endpointPaths };
  const user = await yandexGet({ pathname: "/user", accessToken, request });
  const userId = cleanString(String(user.user_id || ""));
  if (!userId) return { ...empty, requestCount, endpointPaths };
  const hosts = await yandexGet({ pathname: `/user/${encodeURIComponent(userId)}/hosts`, accessToken, request });
  const host = Array.isArray(hosts.hosts)
    ? hosts.hosts.find((item) => {
        const data = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        return hostMatchesDomain(data, config.domain);
      })
    : null;
  const hostData = host && typeof host === "object" ? (host as Record<string, unknown>) : {};
  const hostId = cleanString(hostData.host_id);
  if (!hostId) return { ...empty, requestCount, endpointPaths };

  const historyPath = `/user/${encodeURIComponent(userId)}/hosts/${encodeURIComponent(hostId)}/search-queries/all/history`;
  const popularPath = `/user/${encodeURIComponent(userId)}/hosts/${encodeURIComponent(hostId)}/search-queries/popular`;
  const [history, popularQueries] = await Promise.all([
    yandexGet({
      pathname: historyPath,
      accessToken,
      request,
      params: queryParams({ dateRange }),
    }),
    yandexGet({
      pathname: popularPath,
      accessToken,
      request,
      params: queryParams({
        dateRange,
        limit: config.yandexPopularQueryLimit,
        includeOrder: true,
      }),
    }),
  ]);

  return {
    schemaVersion: "seo_os_yandex_query_history_raw_v1",
    source: "yandex_webmaster",
    hostId,
    siteUrl: cleanString(hostData.ascii_host_url) || cleanString(hostData.unicode_host_url) || null,
    dateRange,
    requestCount,
    endpointPaths,
    rows: queryRowsFromPopular(popularQueries),
    raw: {
      history,
      popularQueries,
    },
  };
}
