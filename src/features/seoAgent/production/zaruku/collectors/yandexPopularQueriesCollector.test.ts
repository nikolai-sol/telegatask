import { describe, expect, test } from "vitest";
import { zarukuSeoProductionConfig } from "../zarukuSeoProductionConfig";
import { collectYandexPopularQueries, type YandexWebmasterFetch } from "./yandexPopularQueriesCollector";

function response(status: number, body: unknown): Awaited<ReturnType<YandexWebmasterFetch>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("collectYandexPopularQueries", () => {
  test("returns yandexQueries output from fixture Webmaster responses without live network", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: YandexWebmasterFetch = async (url, init) => {
      calls.push({ url, init });
      if (url === "https://api.webmaster.yandex.net/v4/user") {
        expect(init?.headers).toEqual({
          Authorization: "OAuth direct-token",
          Accept: "application/json",
        });
        return response(200, { user_id: "user-1" });
      }
      if (url === "https://api.webmaster.yandex.net/v4/user/user-1/hosts") {
        return response(200, {
          hosts: [
            { host_id: "other-host", ascii_host_url: "https://example.com/" },
            { host_id: "zaruku-host", ascii_host_url: "https://zaruku.ru/" },
          ],
        });
      }
      if (url.startsWith("https://api.webmaster.yandex.net/v4/user/user-1/hosts/zaruku-host/search-queries/popular")) {
        const query = new URL(url).searchParams;
        expect(query.get("order_by")).toBe("TOTAL_SHOWS");
        expect(query.get("device_type_indicator")).toBe("ALL");
        expect(query.get("limit")).toBe("50");
        expect(query.get("date_from")).toBe("2026-06-24");
        expect(query.get("date_to")).toBe("2026-06-30");
        expect(query.getAll("query_indicator")).toEqual(["TOTAL_SHOWS", "TOTAL_CLICKS", "AVG_SHOW_POSITION"]);
        return response(200, {
          queries: [
            {
              query_text: " рак лечение ",
              indicators: {
                TOTAL_SHOWS: 100,
                TOTAL_CLICKS: 5,
                AVG_SHOW_POSITION: 8.2,
              },
            },
            {
              query_text: "онкология",
              indicators: {
                TOTAL_SHOWS: 0,
                TOTAL_CLICKS: 0,
                AVG_SHOW_POSITION: 3,
              },
            },
            {
              query_text: "",
              indicators: {
                TOTAL_SHOWS: 10,
                TOTAL_CLICKS: 1,
                AVG_SHOW_POSITION: 1,
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    await expect(
      collectYandexPopularQueries(zarukuSeoProductionConfig, {
        env: {
          YANDEX_WEBMASTER_OAUTH_TOKEN: "direct-token",
        },
        fetchImpl,
        now: () => new Date("2026-07-03T12:00:00.000Z"),
      })
    ).resolves.toEqual([
      {
        query: "рак лечение",
        impressions: 100,
        clicks: 5,
        ctr: 5,
        averagePosition: 8.2,
      },
      {
        query: "онкология",
        impressions: 0,
        clicks: 0,
        ctr: null,
        averagePosition: 3,
      },
    ]);
    expect(calls).toHaveLength(3);
  });

  test("returns empty yandexQueries when Webmaster credentials are missing", async () => {
    const fetchImpl: YandexWebmasterFetch = async () => {
      throw new Error("fetch should not be called without Webmaster credentials");
    };

    await expect(
      collectYandexPopularQueries(zarukuSeoProductionConfig, {
        env: {},
        fetchImpl,
        now: () => new Date("2026-07-03T12:00:00.000Z"),
      })
    ).resolves.toEqual([]);
  });

  test("preserves refresh-token access token exchange path", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: YandexWebmasterFetch = async (url, init) => {
      calls.push({ url, init });
      if (url === "https://oauth.yandex.ru/token") {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toEqual({
          "Content-Type": "application/x-www-form-urlencoded",
        });
        expect(String(init?.body)).toBe("grant_type=refresh_token&refresh_token=refresh-token&client_id=client-id&client_secret=client-secret");
        return response(200, { access_token: "refreshed-token" });
      }
      if (url === "https://api.webmaster.yandex.net/v4/user") {
        expect(init?.headers).toEqual({
          Authorization: "OAuth refreshed-token",
          Accept: "application/json",
        });
        return response(200, {});
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    await expect(
      collectYandexPopularQueries(zarukuSeoProductionConfig, {
        env: {
          YANDEX_WEBMASTER_REFRESH_TOKEN: "refresh-token",
          YANDEX_WEBMASTER_CLIENT_ID: "client-id",
          YANDEX_WEBMASTER_CLIENT_SECRET: "client-secret",
        },
        fetchImpl,
        now: () => new Date("2026-07-03T12:00:00.000Z"),
      })
    ).resolves.toEqual([]);
    expect(calls.map((call) => call.url)).toEqual(["https://oauth.yandex.ru/token", "https://api.webmaster.yandex.net/v4/user"]);
  });
});
