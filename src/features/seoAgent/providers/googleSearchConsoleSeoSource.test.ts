import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  GoogleSearchConsoleSeoSource,
  OWNER_PROVIDER_MAX_RESPONSE_BYTES,
} from "./googleSearchConsoleSeoSource";

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
        return new Response(JSON.stringify({ access_token: "access-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
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
      return new Response(JSON.stringify({
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
        }), { status: 200, headers: { "Content-Type": "application/json" } });
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

  test("aborts a hanging owner request at its per-call deadline", async () => {
    let aborted = false;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }));

    const source = new GoogleSearchConsoleSeoSource({ fetchImpl: fetchMock, requestTimeoutMs: 5 });
    await expect(source.getDailyQueryFacts("zaruku.ru", {
      teamId: "team-1",
      siteUrl: "https://zaruku.ru/",
      reportDate: "2026-07-14",
    })).rejects.toMatchObject({ safeMessage: "Google Search Console token refresh failed" });
    expect(aborted).toBe(true);
  });

  test("rejects an oversized owner response before JSON buffering", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "Content-Length": String(OWNER_PROVIDER_MAX_RESPONSE_BYTES + 1) },
    }));
    const source = new GoogleSearchConsoleSeoSource({ fetchImpl: fetchMock });

    await expect(source.getDailyQueryFacts("zaruku.ru", {
      teamId: "team-1",
      siteUrl: "https://zaruku.ru/",
      reportDate: "2026-07-14",
    })).rejects.toMatchObject({ safeMessage: "Google Search Console token refresh failed" });
  });

  test("does not retain raw provider error bodies in owner-source failures", async () => {
    const secret = "provider-secret-token-value";
    const source = new GoogleSearchConsoleSeoSource({
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ error_description: secret }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })),
    });

    const error = await source.getDailyQueryFacts("zaruku.ru", {
      teamId: "team-1",
      siteUrl: "https://zaruku.ru/",
      reportDate: "2026-07-14",
    }).catch((value: unknown) => value);
    expect(error).toMatchObject({ safeMessage: "Google Search Console token refresh failed" });
    expect(JSON.stringify(error)).not.toContain(secret);
  });
});
