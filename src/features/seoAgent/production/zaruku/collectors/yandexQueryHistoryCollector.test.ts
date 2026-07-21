import { describe, expect, test } from "vitest";
import { zarukuSeoProductionConfig } from "../zarukuSeoProductionConfig";
import { collectYandexQueryHistory, type YandexQueryHistoryFetch } from "./yandexQueryHistoryCollector";

function response(status: number, body: unknown): Awaited<ReturnType<YandexQueryHistoryFetch>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("collectYandexQueryHistory", () => {
  test("collects 28d Yandex query rows and preserves raw history responses without live network", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: YandexQueryHistoryFetch = async (url, init) => {
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
      if (url.startsWith("https://api.webmaster.yandex.net/v4/user/user-1/hosts/zaruku-host/search-queries/all/history")) {
        const query = new URL(url).searchParams;
        expect(query.get("device_type_indicator")).toBe("ALL");
        expect(query.get("date_from")).toBe("2026-06-05");
        expect(query.get("date_to")).toBe("2026-07-02");
        expect(query.getAll("query_indicator")).toEqual(["TOTAL_SHOWS", "TOTAL_CLICKS", "AVG_SHOW_POSITION"]);
        return response(200, {
          indicators: {
            TOTAL_SHOWS: [{ date: "2026-06-05", value: 999 }],
          },
        });
      }
      if (url.startsWith("https://api.webmaster.yandex.net/v4/user/user-1/hosts/zaruku-host/search-queries/popular")) {
        const query = new URL(url).searchParams;
        expect(query.get("order_by")).toBe("TOTAL_SHOWS");
        expect(query.get("limit")).toBe("50");
        expect(query.get("date_from")).toBe("2026-06-05");
        expect(query.get("date_to")).toBe("2026-07-02");
        expect(query.getAll("query_indicator")).toEqual(["TOTAL_SHOWS", "TOTAL_CLICKS", "AVG_SHOW_POSITION"]);
        return response(200, {
          queries: [
            {
              query_text: "рак лечение",
              indicators: {
                TOTAL_SHOWS: 320,
                TOTAL_CLICKS: 12,
                AVG_SHOW_POSITION: 9.4,
              },
            },
            {
              query_text: "подногтевая меланома фото",
              indicators: {
                TOTAL_SHOWS: 99,
                TOTAL_CLICKS: 1,
                AVG_SHOW_POSITION: 5,
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    await expect(
      collectYandexQueryHistory(zarukuSeoProductionConfig, {
        env: {
          YANDEX_WEBMASTER_OAUTH_TOKEN: "direct-token",
        },
        fetchImpl,
        now: () => new Date("2026-07-05T12:00:00.000Z"),
      })
    ).resolves.toEqual({
      schemaVersion: "seo_os_yandex_query_history_raw_v1",
      source: "yandex_webmaster",
      hostId: "zaruku-host",
      siteUrl: "https://zaruku.ru/",
      dateRange: {
        startDate: "2026-06-05",
        endDate: "2026-07-02",
        days: 28,
      },
      requestCount: 4,
      endpointPaths: [
        "/user",
        "/user/user-1/hosts",
        "/user/user-1/hosts/zaruku-host/search-queries/all/history",
        "/user/user-1/hosts/zaruku-host/search-queries/popular",
      ],
      rows: [
        {
          query: "рак лечение",
          impressions: 320,
          clicks: 12,
          ctr: 3.75,
          averagePosition: 9.4,
        },
        {
          query: "подногтевая меланома фото",
          impressions: 99,
          clicks: 1,
          ctr: 1.0101010101010102,
          averagePosition: 5,
        },
      ],
      raw: {
        history: {
          indicators: {
            TOTAL_SHOWS: [{ date: "2026-06-05", value: 999 }],
          },
        },
        popularQueries: {
          queries: [
            {
              query_text: "рак лечение",
              indicators: {
                TOTAL_SHOWS: 320,
                TOTAL_CLICKS: 12,
                AVG_SHOW_POSITION: 9.4,
              },
            },
            {
              query_text: "подногтевая меланома фото",
              indicators: {
                TOTAL_SHOWS: 99,
                TOTAL_CLICKS: 1,
                AVG_SHOW_POSITION: 5,
              },
            },
          ],
        },
      },
    });
    expect(calls).toHaveLength(4);
  });

  test("returns an empty local collection when credentials are missing", async () => {
    const fetchImpl: YandexQueryHistoryFetch = async () => {
      throw new Error("fetch should not be called without Webmaster credentials");
    };

    const result = await collectYandexQueryHistory(zarukuSeoProductionConfig, {
      env: {},
      fetchImpl,
      now: () => new Date("2026-07-05T12:00:00.000Z"),
    });

    expect(result.rows).toEqual([]);
    expect(result.requestCount).toBe(0);
    expect(result.dateRange).toEqual({
      startDate: "2026-06-05",
      endDate: "2026-07-02",
      days: 28,
    });
  });
});
