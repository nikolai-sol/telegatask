import { afterEach, describe, expect, test, vi } from "vitest";
import type { SeoRankProviderStatus, SeoSearchConsoleSnapshot, YandexRankCheck } from "../types";
import type { YandexAiProbe } from "../production/zaruku/zarukuWgdRunnerHelpers";
import type { WgdReportOptions } from "./types";
import { collectYandexEvidence } from "./yandexEvidence";

function ruOptions(): WgdReportOptions {
  return {
    url: "https://flowerlife-school.com/",
    domain: "flowerlife-school.com",
    market: "RU",
    language: "ru",
    region: "225",
    crawlLimit: 100,
    lighthousePageLimit: 6,
    keywords: ["цветок жизни школа", "курсы саморазвития"],
    aiQueries: ["Что такое школа Цветок жизни?", "Где пройти курс саморазвития?"],
    priorityUrls: [],
    outDir: "reports",
    sources: { dataForSeo: "not_applicable" },
  };
}

function connectedStatus(): SeoRankProviderStatus {
  return {
    state: "connected",
    message: "Yandex rank tracking completed",
    checkedAt: "2026-08-31T10:00:00.000Z",
  };
}

function rankCheck(query: string): YandexRankCheck {
  return {
    query,
    searchEngine: "yandex",
    provider: "yandex_search_api",
    targetDomain: "flowerlife-school.com",
    found: true,
    position: 2,
    matchedUrl: "https://flowerlife-school.com/",
    device: "desktop",
    region: "225",
    language: "ru",
    checkedAt: "2026-08-31T10:00:00.000Z",
  };
}

function probe(query: string, targetUsed: boolean): YandexAiProbe {
  return {
    channel: "Yandex Search API generative response",
    status: "checked",
    query,
    result: "Ответ",
    sources: ["https://flowerlife-school.com/"],
    sourceDetails: [{ url: "https://flowerlife-school.com/", title: "Flowerlife", used: targetUsed }],
    usedSources: targetUsed ? ["https://flowerlife-school.com/"] : [],
    targetFound: true,
    targetUsed,
    sourcePosition: 1,
    usedSourcePosition: targetUsed ? 1 : null,
  };
}

const snapshot: SeoSearchConsoleSnapshot = {
  property: "https:flowerlife-school.com:443",
  siteUrl: "https://flowerlife-school.com/",
  dateRange: { startDate: "2026-08-01", endDate: "2026-08-28", days: 28 },
  clicks: 10,
  impressions: 100,
  ctr: 10,
  averagePosition: 4,
  topQueries: ["цветок жизни"],
  topPages: [],
  countries: [],
  devices: ["ALL"],
};

describe("collectYandexEvidence", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("uses RU provider inputs and reports AI visibility only as a controlled sample", async () => {
    const run = vi.fn(async () => ({
      checks: ruOptions().keywords.map(rankCheck),
      status: connectedStatus(),
    }));
    const collectAiProbes = vi.fn(async () => [probe(ruOptions().aiQueries[0], true), probe(ruOptions().aiQueries[1], false)]);

    const evidence = await collectYandexEvidence(ruOptions(), {
      env: {
        YANDEX_SEARCH_API_KEY: "search-secret",
        YANDEX_SEARCH_FOLDER_ID: "folder-secret",
        YANDEX_GEN_SEARCH_API_KEY: "ai-secret",
        YANDEX_GEN_SEARCH_FOLDER_ID: "ai-folder-secret",
      },
      serpSource: { run },
      collectAiProbes,
      ownerAccess: { yandexWebmaster: true, gsc: true },
      getYandexWebmasterSnapshot: async () => snapshot,
      getGscSnapshot: async () => ({ ...snapshot, property: "sc-domain:flowerlife-school.com" }),
    });

    expect(run).toHaveBeenCalledWith({
      targetDomain: "flowerlife-school.com",
      keywords: ruOptions().keywords,
      region: "225",
      language: "ru",
      device: "desktop",
    });
    expect(collectAiProbes).toHaveBeenCalledWith(
      {
        aiProbeChannel: "Yandex Search API generative response",
        aiProbeQueries: ruOptions().aiQueries,
        aiProbeTargetDomain: "flowerlife-school.com",
        aiProbeThrottleMs: 1300,
      },
      expect.objectContaining({ env: expect.any(Object) })
    );
    expect(evidence.aiProbes.map(({ targetUsed, sourcePosition, usedSourcePosition }) => ({
      targetUsed,
      sourcePosition,
      usedSourcePosition,
    }))).toEqual([
      { targetUsed: true, sourcePosition: 1, usedSourcePosition: 1 },
      { targetUsed: false, sourcePosition: 1, usedSourcePosition: null },
    ]);
    expect(evidence.aiSampleVisibility).toEqual({ used: 1, checked: 2, rate: 0.5 });
    expect(Object.keys(evidence.aiSampleVisibility)).toEqual(["used", "checked", "rate"]);
    expect(evidence.limitations.join(" ").toLowerCase()).toContain("controlled sample");
    expect(evidence.limitations.join(" ").toLowerCase()).not.toContain("share of voice");
    expect(evidence.yandexWebmasterSnapshot).toEqual(snapshot);
    expect(evidence.gscSnapshot?.property).toBe("sc-domain:flowerlife-school.com");
    expect(JSON.stringify(evidence)).not.toContain("search-secret");
  });

  test("preserves checked depth through safe normalization", async () => {
    const run = vi.fn(async () => ({
      checks: [{ ...rankCheck(ruOptions().keywords[0]), checkedDepth: 20 }],
      status: connectedStatus(),
    }));

    const evidence = await collectYandexEvidence(ruOptions(), {
      env: {
        YANDEX_SEARCH_API_KEY: "search-secret",
        YANDEX_SEARCH_FOLDER_ID: "folder-secret",
      },
      serpSource: { run },
    });

    expect(evidence.serpChecks[0].checkedDepth).toBe(20);
  });

  test("does not call providers without credentials and creates manual rows", async () => {
    const run = vi.fn();
    const collectAiProbes = vi.fn();
    const evidence = await collectYandexEvidence(ruOptions(), {
      env: {},
      serpSource: { run },
      collectAiProbes,
    });

    expect(run).not.toHaveBeenCalled();
    expect(collectAiProbes).not.toHaveBeenCalled();
    expect(evidence.serpChecks).toEqual([]);
    expect(evidence.aiProbes).toEqual([]);
    expect(evidence.aiSampleVisibility).toEqual({ used: 0, checked: 0, rate: null });
    expect(evidence.manualQueries).toHaveLength(4);
    expect(evidence.manualQueries.map((item) => item.query)).toEqual([
      ...ruOptions().keywords,
      ...ruOptions().aiQueries,
    ]);
  });

  test("does not collect owner snapshots until access is confirmed", async () => {
    const getYandexWebmasterSnapshot = vi.fn(async () => snapshot);
    const getGscSnapshot = vi.fn(async () => snapshot);
    const evidence = await collectYandexEvidence(ruOptions(), {
      env: {},
      ownerAccess: { yandexWebmaster: false, gsc: false },
      getYandexWebmasterSnapshot,
      getGscSnapshot,
    });

    expect(getYandexWebmasterSnapshot).not.toHaveBeenCalled();
    expect(getGscSnapshot).not.toHaveBeenCalled();
    expect(evidence.yandexWebmasterSnapshot).toBeUndefined();
    expect(evidence.gscSnapshot).toBeUndefined();
  });

  test("passes injected credentials and transport to the default Yandex SERP source", async () => {
    vi.stubEnv("YANDEX_SEARCH_API_KEY", "");
    vi.stubEnv("YANDEX_SEARCH_FOLDER_ID", "");
    vi.stubEnv("YANDEX_SEARCH_MODE", "");
    const serpFetch = vi.fn(async () => new Response(JSON.stringify({
        response: {
          rawData: "<response><results><grouping><group><doc><url>https://flowerlife-school.com/</url><title>Flowerlife</title></doc></group></grouping></results></response>",
        },
      }), { status: 200, headers: { "content-type": "application/json" } }));

    const evidence = await collectYandexEvidence(
      { ...ruOptions(), keywords: ["цветок жизни школа"], aiQueries: [] },
      {
        env: {
          YANDEX_SEARCH_API_KEY: "injected-api-key",
          YANDEX_SEARCH_FOLDER_ID: "injected-folder-id",
          YANDEX_SEARCH_MODE: "sync",
        },
        serpFetch,
      }
    );

    expect(serpFetch).toHaveBeenCalledTimes(1);
    expect(serpFetch).toHaveBeenCalledWith(
      "https://searchapi.api.cloud.yandex.net/v2/web/search",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Api-Key injected-api-key",
          "x-folder-id": "injected-folder-id",
        }),
      })
    );
    expect(evidence.serpStatus.state).toBe("connected");
    expect(evidence.serpChecks).toHaveLength(1);
  });

  test("retains a bounded natural-language Alice answer and sanitized source evidence", async () => {
    const usefulAnswer = "Школа помогает участникам изучать практики осознанности и предлагает вводный курс.";
    const evidence = await collectYandexEvidence(
      { ...ruOptions(), keywords: [], aiQueries: ["Что такое школа Цветок жизни?"] },
      {
        env: {
          YANDEX_GEN_SEARCH_API_KEY: "present",
          YANDEX_GEN_SEARCH_FOLDER_ID: "present",
        },
        collectAiProbes: async () => [{
          ...probe("Что такое школа Цветок жизни?", true),
          result: usefulAnswer,
          sources: [
            "https://user:password@flowerlife-school.com/about/?access_token=secret",
            "javascript:alert(1)",
          ],
          sourceDetails: [
            {
              url: "https://user:password@flowerlife-school.com/about/?access_token=secret",
              title: "О школе",
              used: true,
            },
            { url: "javascript:alert(1)", title: "Unsafe", used: false },
          ],
          usedSources: ["https://flowerlife-school.com/about/?token=secret"],
        }],
      }
    );

    expect(evidence.aiProbes[0]).toMatchObject({
      result: usefulAnswer,
      sources: ["https://flowerlife-school.com/about/"],
      sourceDetails: [{ url: "https://flowerlife-school.com/about/", title: "О школе", used: true }],
      usedSources: ["https://flowerlife-school.com/about/"],
      sourcePosition: 1,
      usedSourcePosition: 1,
    });
    expect(JSON.stringify(evidence)).not.toMatch(/password|access_token|secret|javascript:/);
  });

  test("caps retained Alice answer and source collections", async () => {
    const sourceUrls = Array.from({ length: 10 }, (_, index) => `https://source${index}.example/page`);
    const evidence = await collectYandexEvidence(
      { ...ruOptions(), keywords: [], aiQueries: ["bounded query"] },
      {
        env: { YANDEX_GEN_SEARCH_API_KEY: "present", YANDEX_GEN_SEARCH_FOLDER_ID: "present" },
        collectAiProbes: async () => [{
          ...probe("bounded query", true),
          result: `Полезный ответ ${"а".repeat(1500)}`,
          sources: [...sourceUrls, `https://example.com/${"x".repeat(3000)}`],
          sourceDetails: sourceUrls.map((url, index) => ({ url, title: `Source ${index}`, used: index === 0 })),
          usedSources: sourceUrls,
        }],
      }
    );

    expect(evidence.aiProbes[0].result.length).toBeLessThanOrEqual(1200);
    expect(evidence.aiProbes[0].result.endsWith("…")).toBe(true);
    expect(evidence.aiProbes[0].sources).toHaveLength(8);
    expect(evidence.aiProbes[0].sourceDetails).toHaveLength(8);
    expect(evidence.aiProbes[0].usedSources).toHaveLength(8);
  });

  test("rejects raw JSON/error payloads and redacts secret material from checked AI answers", async () => {
    const unsafeResult = JSON.stringify({
      error: "provider raw error",
      access_token: "raw-access-token",
      callback: "https://user:password@example.com/result?access_token=query-secret",
    });
    const evidence = await collectYandexEvidence(
      { ...ruOptions(), keywords: [], aiQueries: ["Что такое школа Цветок жизни?"] },
      {
        env: {
          YANDEX_GEN_SEARCH_API_KEY: "present",
          YANDEX_GEN_SEARCH_FOLDER_ID: "present",
        },
        collectAiProbes: async () => [{
          ...probe("Что такое школа Цветок жизни?", true),
          result: unsafeResult,
          rawProviderPayload: unsafeResult,
        }],
      }
    );

    expect(evidence.aiProbes[0].result).toBe("Alice AI answer was not retained because it was not safe natural-language evidence.");
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("provider raw error");
    expect(serialized).not.toContain("raw-access-token");
    expect(serialized).not.toContain("query-secret");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("rawProviderPayload");

    const redacted = await collectYandexEvidence(
      { ...ruOptions(), keywords: [], aiQueries: ["q"] },
      {
        env: { YANDEX_GEN_SEARCH_API_KEY: "present", YANDEX_GEN_SEARCH_FOLDER_ID: "present" },
        collectAiProbes: async () => [{
          ...probe("q", false),
          result: "Полезный ответ. Authorization: Bearer secret-token, api_key=private-key.",
        }],
      }
    );
    expect(redacted.aiProbes[0].result).toContain("Полезный ответ");
    expect(redacted.aiProbes[0].result).not.toMatch(/secret-token|private-key|Bearer/i);
  });

  test("turns hanging optional collectors into manual evidence within overall deadlines", async () => {
    const never = new Promise<never>(() => undefined);
    const evidence = await collectYandexEvidence(ruOptions(), {
      env: {
        YANDEX_SEARCH_API_KEY: "present",
        YANDEX_SEARCH_FOLDER_ID: "present",
        YANDEX_GEN_SEARCH_API_KEY: "present",
        YANDEX_GEN_SEARCH_FOLDER_ID: "present",
      },
      serpSource: { run: async () => never },
      collectAiProbes: async () => never,
      serpOverallTimeoutMs: 10,
      aiOverallTimeoutMs: 10,
    });

    expect(evidence.serpStatus.state).toBe("provider_error");
    expect(evidence.aiProbes).toEqual([]);
    expect(evidence.manualQueries.map((row) => row.query)).toEqual([
      ...ruOptions().keywords,
      ...ruOptions().aiQueries,
    ]);
  });

  test("redacts thrown provider errors and failed AI results", async () => {
    const secret = "raw-token-and-provider-response";
    const evidence = await collectYandexEvidence(ruOptions(), {
      env: {
        YANDEX_SEARCH_API_KEY: "present",
        YANDEX_SEARCH_FOLDER_ID: "present",
        YANDEX_GEN_SEARCH_API_KEY: "present",
        YANDEX_GEN_SEARCH_FOLDER_ID: "present",
      },
      serpSource: {
        run: async () => {
          throw new Error(secret);
        },
      },
      collectAiProbes: async () => [{
        ...probe(ruOptions().aiQueries[0], false),
        status: "failed",
        result: secret,
      }, {
        ...probe(ruOptions().aiQueries[1], false),
        status: "permission_denied",
        result: secret,
      }],
      ownerAccess: { yandexWebmaster: true, gsc: true },
      getYandexWebmasterSnapshot: async () => {
        throw new Error(secret);
      },
      getGscSnapshot: async () => {
        throw new Error(secret);
      },
    });

    expect(JSON.stringify(evidence)).not.toContain(secret);
    expect(evidence.serpStatus.state).toBe("provider_error");
    expect(evidence.aiProbes.every((item) => item.result === "Alice AI probe did not return reportable evidence.")).toBe(true);
    expect(evidence.manualQueries).toHaveLength(4);
    expect(evidence.yandexWebmasterSnapshot).toBeUndefined();
    expect(evidence.gscSnapshot).toBeUndefined();
  });
});
