import { describe, expect, test, vi } from "vitest";
import type { WgdReportOptions } from "./types";
import { preflightProviders } from "./providerPreflight";

function ruOptions(): WgdReportOptions {
  return {
    url: "https://flowerlife-school.com/",
    domain: "flowerlife-school.com",
    market: "RU",
    language: "ru",
    region: "225",
    crawlLimit: 100,
    lighthousePageLimit: 6,
    keywords: ["цветок жизни школа"],
    aiQueries: ["Что такое школа Цветок жизни?"],
    priorityUrls: [],
    outDir: "reports",
    sources: { dataForSeo: "not_applicable" },
  };
}

describe("preflightProviders", () => {
  test("marks DataForSEO not applicable and distinguishes Yandex credentials from host access", async () => {
    const checkDataForSeo = vi.fn(async () => true);
    const checkYandexHost = vi.fn(async () => false);
    const checkGscProperty = vi.fn(async () => false);

    const coverage = await preflightProviders(
      ruOptions(),
      {
        YANDEX_SEARCH_API_KEY: "present",
        YANDEX_SEARCH_FOLDER_ID: "present",
        YANDEX_WEBMASTER_OAUTH_TOKEN: "present",
      },
      { checkDataForSeo, checkYandexHost, checkGscProperty }
    );

    expect(coverage.find((item) => item.id === "dataforseo")?.state).toBe("not_applicable");
    expect(coverage.find((item) => item.id === "yandex_search")?.state).toBe("success");
    expect(coverage.find((item) => item.id === "yandex_webmaster")?.state).toBe("owner_access_required");
    expect(checkDataForSeo).not.toHaveBeenCalled();
    expect(checkYandexHost).toHaveBeenCalledWith("flowerlife-school.com", expect.any(AbortSignal));
  });

  test("uses fixed safe messages when owner access checks throw", async () => {
    const secret = "oauth-secret-raw-provider-body";
    const coverage = await preflightProviders(
      ruOptions(),
      {
        YANDEX_WEBMASTER_OAUTH_TOKEN: "present",
        GSC_ENABLED: "true",
        GOOGLE_OAUTH_CLIENT_ID: "present",
        GOOGLE_OAUTH_CLIENT_SECRET: "present",
      },
      {
        checkYandexHost: async () => {
          throw new Error(secret);
        },
        checkGscProperty: async () => {
          throw { body: secret };
        },
      }
    );

    expect(coverage.find((item) => item.id === "yandex_webmaster")?.state).toBe("unavailable");
    expect(coverage.find((item) => item.id === "gsc")?.state).toBe("unavailable");
    expect(JSON.stringify(coverage)).not.toContain(secret);
    expect(JSON.stringify(coverage)).not.toContain("present");
  });

  test("aborts and safely classifies owner checks that never settle", async () => {
    let yandexSignal: AbortSignal | undefined;
    let gscSignal: AbortSignal | undefined;
    const coverage = await preflightProviders(
      ruOptions(),
      { YANDEX_WEBMASTER_OAUTH_TOKEN: "present" },
      {
        accessCheckTimeoutMs: 5,
        checkYandexHost: async (_domain, signal) => {
          yandexSignal = signal;
          return new Promise<boolean>(() => undefined);
        },
        checkGscProperty: async (_domain, signal) => {
          gscSignal = signal;
          return new Promise<boolean>(() => undefined);
        },
      }
    );

    expect(coverage.find((item) => item.id === "yandex_webmaster")?.state).toBe("unavailable");
    expect(coverage.find((item) => item.id === "gsc")?.state).toBe("unavailable");
    expect(yandexSignal?.aborted).toBe(true);
    expect(gscSignal?.aborted).toBe(true);
  });
});
