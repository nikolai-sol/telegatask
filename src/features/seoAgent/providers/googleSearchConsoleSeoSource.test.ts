import { beforeEach, describe, expect, test, vi } from "vitest";
import { GoogleSearchConsoleSeoSource } from "./googleSearchConsoleSeoSource";

vi.mock("../gscCredentialRepository", () => ({
  getStoredGscCredential: vi.fn(async () => ({
    teamId: "team-1",
    provider: "gsc",
    refreshToken: "stored-refresh-token",
    verifiedSiteUrls: ["https://zaruku.ru/"],
    updatedAt: 1,
  })),
}));

describe("GoogleSearchConsoleSeoSource canonical daily facts", () => {
  beforeEach(() => {
    process.env.GSC_ENABLED = "true";
    process.env.GSC_SITE_URL = "https://zaruku.ru/";
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://localhost/oauth";
    vi.restoreAllMocks();
  });

  test("pulls one Search Analytics day with query, page, country, and device dimensions", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://oauth2.googleapis.com/token") {
        return {
          ok: true,
          json: async () => ({ access_token: "access-token" }),
        } as Response;
      }
      expect(url).toBe(
        "https://searchconsole.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fzaruku.ru%2F/searchAnalytics/query"
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        startDate: "2026-07-14",
        endDate: "2026-07-14",
        dimensions: ["query", "page", "country", "device"],
        rowLimit: 25000,
      });
      return {
        ok: true,
        json: async () => ({
          rows: [
            {
              keys: [
                "подногтевая меланома фото",
                "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
                "rus",
                "MOBILE",
              ],
              impressions: 100,
              clicks: 4,
              ctr: 0.04,
              position: 8.5,
            },
          ],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const records = await new GoogleSearchConsoleSeoSource().getDailyQueryFacts("zaruku.ru", {
      teamId: "team-1",
      siteUrl: "https://zaruku.ru/",
      reportDate: "2026-07-14",
      rowLimit: 25000,
    });

    expect(records).toEqual([
      {
        reportDate: "2026-07-14",
        query: "подногтевая меланома фото",
        page: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
        country: "rus",
        device: "MOBILE",
        impressions: 100,
        clicks: 4,
        ctr: 0.04,
        position: 8.5,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
