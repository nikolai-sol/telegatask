import type { ZarukuSeoProductionConfig } from "../zarukuSeoProductionConfig";
import { cleanNumber, cleanString, type YandexWebmasterQuery } from "../zarukuWgdRunnerHelpers";

type YandexWebmasterEnv = Partial<
  Record<
    "YANDEX_WEBMASTER_OAUTH_TOKEN" | "YANDEX_WEBMASTER_REFRESH_TOKEN" | "YANDEX_WEBMASTER_CLIENT_ID" | "YANDEX_WEBMASTER_CLIENT_SECRET",
    string
  >
>;

type YandexWebmasterResponse = Pick<Response, "ok" | "status" | "json">;

export type YandexWebmasterFetch = (url: string, init?: RequestInit) => Promise<YandexWebmasterResponse>;
export type YandexWebmasterNow = () => Date;

type PopularQueriesConfig = Pick<ZarukuSeoProductionConfig, "domain" | "yandexPopularQueryLimit">;

type PopularQueriesDeps = {
  env?: YandexWebmasterEnv;
  fetchImpl?: YandexWebmasterFetch;
  now?: YandexWebmasterNow;
};

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

async function getYandexWebmasterAccessToken(input: {
  env: YandexWebmasterEnv;
  fetchImpl: YandexWebmasterFetch;
}): Promise<string> {
  const direct = cleanString(input.env.YANDEX_WEBMASTER_OAUTH_TOKEN);
  if (direct) return direct;
  const refreshToken = cleanString(input.env.YANDEX_WEBMASTER_REFRESH_TOKEN);
  if (!refreshToken) return "";
  const response = await input.fetchImpl("https://oauth.yandex.ru/token", {
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

async function yandexWebmasterGet(input: {
  pathname: string;
  accessToken: string;
  fetchImpl: YandexWebmasterFetch;
  params?: URLSearchParams;
}): Promise<Record<string, unknown>> {
  const query = input.params && input.params.toString() ? `?${input.params.toString()}` : "";
  const response = await input.fetchImpl(`https://api.webmaster.yandex.net/v4${input.pathname}${query}`, {
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

function yandexDateRange(now: YandexWebmasterNow): { startDate: string; endDate: string } {
  const end = now();
  end.setDate(end.getDate() - 3);
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export async function collectYandexPopularQueries(
  config: PopularQueriesConfig,
  deps: PopularQueriesDeps = {}
): Promise<YandexWebmasterQuery[]> {
  const env = deps.env || readProcessEnv();
  const fetchImpl = deps.fetchImpl || defaultFetch;
  const now = deps.now || (() => new Date());
  const accessToken = await getYandexWebmasterAccessToken({ env, fetchImpl });
  if (!accessToken) return [];
  const user = await yandexWebmasterGet({ pathname: "/user", accessToken, fetchImpl });
  const userId = cleanString(String(user.user_id || ""));
  if (!userId) return [];
  const hosts = await yandexWebmasterGet({ pathname: `/user/${encodeURIComponent(userId)}/hosts`, accessToken, fetchImpl });
  const host = Array.isArray(hosts.hosts)
    ? hosts.hosts.find((item) => {
        const data = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        return cleanString(data.ascii_host_url).includes(config.domain) || cleanString(data.unicode_host_url).includes(config.domain);
      })
    : null;
  const hostId = host && typeof host === "object" ? cleanString((host as Record<string, unknown>).host_id) : "";
  if (!hostId) return [];
  const params = new URLSearchParams({
    order_by: "TOTAL_SHOWS",
    device_type_indicator: "ALL",
    limit: String(config.yandexPopularQueryLimit),
    date_from: yandexDateRange(now).startDate,
    date_to: yandexDateRange(now).endDate,
  });
  params.append("query_indicator", "TOTAL_SHOWS");
  params.append("query_indicator", "TOTAL_CLICKS");
  params.append("query_indicator", "AVG_SHOW_POSITION");
  const response = await yandexWebmasterGet({
    pathname: `/user/${encodeURIComponent(userId)}/hosts/${encodeURIComponent(hostId)}/search-queries/popular`,
    accessToken,
    fetchImpl,
    params,
  });
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
