import { describe, expect, test, vi } from "vitest";
import type { CrawlEvidence, LighthouseEvidence, SourceCoverage, WgdReportOptions, WgdReportPayload } from "./types";
import type { SeoSearchConsoleSnapshot } from "../types";
import type { YandexEvidence, YandexEvidenceDeps } from "./yandexEvidence";
import { runWgdReport, selectLighthouseUrls } from "./runWgdReport";
import { runSeoReportCli } from "../../../../scripts/runSeoReport";
import { SeoProviderNotConfiguredError } from "../providers/seoDataProvider";

const PUBLIC_DNS = async () => [{ address: "93.184.216.34", family: 4 as const }];
const LAB_PROFILE = {
  measurementType: "lab" as const,
  fieldData: { source: "CrUX" as const, state: "not_collected" as const },
};

function options(overrides: Partial<WgdReportOptions> = {}): WgdReportOptions {
  return {
    url: "https://example.com/",
    domain: "example.com",
    market: "RU",
    language: "ru",
    region: "225",
    crawlLimit: 20,
    lighthousePageLimit: 6,
    keywords: ["example query"],
    aiQueries: ["What is Example?"],
    priorityUrls: ["https://example.com/pricing", "https://example.com/about"],
    outDir: "reports",
    sources: { dataForSeo: "not_applicable" },
    ...overrides,
  };
}

function crawl(): CrawlEvidence {
  return {
    attemptedUrlCount: 6,
    eligibleDiscoveredCount: 6,
    droppedEligibleCount: 0,
    truncated: false,
    pages: [
      { requestedUrl: "https://example.com/", finalUrl: "https://example.com/", status: 200, contentType: "text/html", indexable: true, depth: 0, discoveryOrder: 0 },
      { requestedUrl: "https://example.com/deep", finalUrl: "https://example.com/deep", status: 200, contentType: "text/html", indexable: true, depth: 2, discoveryOrder: 3 },
      { requestedUrl: "https://example.com/first", finalUrl: "https://example.com/first", status: 200, contentType: "text/html", indexable: true, depth: 1, discoveryOrder: 2 },
      { requestedUrl: "https://example.com/second", finalUrl: "https://example.com/second", status: 200, contentType: "text/html", indexable: true, depth: 1, discoveryOrder: 1 },
      { requestedUrl: "https://example.com/pricing", finalUrl: "https://example.com/pricing", status: 200, contentType: "text/html", indexable: true, depth: 3, discoveryOrder: 4 },
      { requestedUrl: "https://example.com/about", finalUrl: "https://example.com/about", status: 200, contentType: "text/html", indexable: true, depth: 3, discoveryOrder: 5 },
    ],
    robots: { url: "https://example.com/robots.txt", status: 200, sitemapUrls: [] },
    sitemapCandidates: [],
    discoveredUrls: ["https://example.com/", "https://example.com/second", "https://example.com/first", "https://example.com/deep", "https://example.com/pricing", "https://example.com/about"],
    excludedUrls: [],
    brokenUrls: [],
    redirectChains: [],
    duplicateTitles: {},
    duplicateDescriptions: {},
    limitations: [],
  };
}

function yandex(): YandexEvidence {
  return {
    serpChecks: [{
      query: "example query",
      searchEngine: "yandex",
      provider: "yandex_search_api",
      targetDomain: "example.com",
      found: true,
      position: 1,
      matchedUrl: "https://example.com/",
      device: "desktop",
      region: "225",
      language: "ru",
      checkedAt: "2026-08-31T10:00:00.000Z",
    }],
    serpStatus: { state: "connected", message: "safe", checkedAt: "2026-08-31T10:00:00.000Z" },
    aiProbes: [],
    aiSampleVisibility: { used: 0, checked: 0, rate: null },
    manualQueries: [],
    limitations: ["Controlled sample."],
  };
}

function twoPageCrawl(): CrawlEvidence {
  const result = crawl();
  result.pages = result.pages.slice(0, 2);
  result.discoveredUrls = result.pages.map((page) => page.requestedUrl);
  result.attemptedUrlCount = 2;
  result.eligibleDiscoveredCount = 2;
  return result;
}

function ownerSnapshot(property: string): SeoSearchConsoleSnapshot {
  return {
    property,
    siteUrl: "https://example.com/",
    dateRange: { startDate: "2026-08-01", endDate: "2026-08-28", days: 28 },
    clicks: 10,
    impressions: 100,
    ctr: 10,
    averagePosition: 2,
    topQueries: ["example"],
    topPages: ["https://example.com/"],
    countries: ["aut"],
    devices: ["DESKTOP"],
  };
}

function aiProbe(status: "checked" | "failed", query: string) {
  return {
    channel: "Yandex Search API generative response",
    status,
    query,
    result: status === "checked" ? "Alice AI probe checked." : "Alice AI probe did not return reportable evidence.",
    sources: [],
    sourceDetails: [],
    usedSources: [],
    targetFound: false,
    targetUsed: false,
    sourcePosition: null,
    usedSourcePosition: null,
  } as const;
}

async function runCoverageScenario(
  evidence: YandexEvidence | Error,
  optionOverrides: Partial<WgdReportOptions> = {}
): Promise<{ result: Awaited<ReturnType<typeof runWgdReport>>; payload: WgdReportPayload }> {
  let payload: WgdReportPayload | undefined;
  const result = await runWgdReport(options({ lighthousePageLimit: 1, ...optionOverrides }), {
    dnsResolver: PUBLIC_DNS,
    env: {
      YANDEX_SEARCH_API_KEY: "configured",
      YANDEX_SEARCH_FOLDER_ID: "configured",
      YANDEX_GEN_SEARCH_API_KEY: "configured",
      YANDEX_GEN_SEARCH_FOLDER_ID: "configured",
    },
    preflightDeps: {
      checkYandexHost: async () => false,
      checkGscProperty: async () => false,
    },
    crawlSite: async () => twoPageCrawl(),
    collectLighthouseProfiles: () => [
      { ...LAB_PROFILE, url: "https://example.com/", device: "mobile", status: "success" },
      { ...LAB_PROFILE, url: "https://example.com/", device: "desktop", status: "success" },
    ],
    collectYandexEvidence: async () => {
      if (evidence instanceof Error) throw evidence;
      return evidence;
    },
    writeArtifacts: async (written) => {
      payload = written;
      return {
        directory: "/memory/coverage",
        reportJson: "/memory/coverage/report.json",
        reportHtml: "/memory/coverage/report.html",
        evidenceFiles: [],
      };
    },
  });
  if (!payload) throw new Error("Expected in-memory payload");
  return { result, payload };
}

describe("runWgdReport", () => {
  test("rejects a resolved-private initial target before any collector runs", async () => {
    const crawlSite = vi.fn();
    const collectLighthouseProfiles = vi.fn();

    await expect(runWgdReport(options(), {
      dnsResolver: async () => [{ address: "169.254.169.254", family: 4 }],
      crawlSite,
      collectLighthouseProfiles,
    })).rejects.toThrow("URL must target a public internet host");

    expect(crawlSite).not.toHaveBeenCalled();
    expect(collectLighthouseProfiles).not.toHaveBeenCalled();
  });

  test("revalidates crawl-selected URLs and withholds a DNS-rebound target from Lighthouse", async () => {
    let resolutions = 0;
    const lighthouse = vi.fn(async () => []);
    let written: WgdReportPayload | undefined;

    const result = await runWgdReport(options({ lighthousePageLimit: 1 }), {
      dnsResolver: async () => {
        resolutions += 1;
        return [{ address: resolutions === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }];
      },
      crawlSite: async () => twoPageCrawl(),
      collectLighthouseProfiles: lighthouse,
      collectYandexEvidence: async () => yandex(),
      writeArtifacts: async (payload) => {
        written = payload;
        return {
          directory: "/memory/rebinding",
          reportJson: "/memory/rebinding/report.json",
          reportHtml: "/memory/rebinding/report.html",
          evidenceFiles: [],
        };
      },
    });

    expect(lighthouse).toHaveBeenCalledWith([]);
    expect(written?.lighthouse).toEqual([
      expect.objectContaining({ device: "mobile", error: "Lighthouse target failed public-network validation" }),
      expect.objectContaining({ device: "desktop", error: "Lighthouse target failed public-network validation" }),
    ]);
    expect(result.summary.lighthouseProfiles).toEqual({ requested: 2, successful: 0, failed: 2 });
  });

  test("writes a useful partial report without invoking DataForSEO or creating an execution plan", async () => {
    const calls: string[] = [];
    const checkDataForSeo = vi.fn(async () => true);
    const lighthouseUrls: string[][] = [];
    const written: WgdReportPayload[] = [];
    const partialProfiles: LighthouseEvidence[] = [
      { ...LAB_PROFILE, url: "https://example.com/", device: "mobile", status: "success", categoryScores: { performance: 82 } },
      { ...LAB_PROFILE, url: "https://example.com/", device: "desktop", status: "failed", error: "Lighthouse execution failed" },
    ];

    const result = await runWgdReport(options({ lighthousePageLimit: 1 }), {
      dnsResolver: PUBLIC_DNS,
      env: {
        DATAFORSEO_LOGIN: "configured-but-forbidden",
        DATAFORSEO_PASSWORD: "configured-but-forbidden",
        YANDEX_SEARCH_API_KEY: "configured",
        YANDEX_SEARCH_FOLDER_ID: "configured",
      },
      preflightDeps: {
        checkDataForSeo,
        checkYandexHost: async () => false,
        checkGscProperty: async () => false,
        now: () => new Date("2026-08-31T10:00:00.000Z"),
      },
      crawlSite: async () => {
        calls.push("crawl");
        return twoPageCrawl();
      },
      collectLighthouseProfiles: (urls) => {
        calls.push("lighthouse");
        lighthouseUrls.push(urls);
        return partialProfiles;
      },
      collectYandexEvidence: async () => {
        calls.push("yandex");
        return yandex();
      },
      writeArtifacts: async (payload) => {
        calls.push("write");
        written.push(payload);
        return {
          directory: "/memory/wgd-example",
          reportJson: "/memory/wgd-example/report.json",
          reportHtml: "/memory/wgd-example/report.html",
          evidenceFiles: ["evidence/crawl.json"],
        };
      },
      now: () => new Date("2026-08-31T10:00:30.000Z"),
    });

    expect(checkDataForSeo).not.toHaveBeenCalled();
    expect(calls.indexOf("crawl")).toBeLessThan(calls.indexOf("lighthouse"));
    expect(calls.indexOf("crawl")).toBeLessThan(calls.indexOf("yandex"));
    expect(lighthouseUrls).toEqual([["https://example.com/"]]);
    expect(result).toEqual({
      reportDir: "/memory/wgd-example",
      htmlPath: "/memory/wgd-example/report.html",
      jsonPath: "/memory/wgd-example/report.json",
      manualQueryPackPath: undefined,
      summary: {
        status: "partial",
        domain: "example.com",
        pagesCrawled: 2,
        findings: expect.any(Number),
        lighthouseProfiles: { requested: 2, successful: 1, failed: 1 },
        coverage: {
          dataforseo: "not_applicable",
          yandex_search: "success",
          alice_ai: "unavailable",
          yandex_webmaster: "owner_access_required",
          gsc: "owner_access_required",
          crawl: "success",
          lighthouse: "partial",
        },
      },
    });
    expect(written).toHaveLength(1);
    expect(written[0]).toEqual(expect.objectContaining({
      generatedAt: "2026-08-31T10:00:30.000Z",
      crawl: expect.objectContaining({ pages: expect.any(Array) }),
      lighthouse: partialProfiles,
      yandex: expect.objectContaining({ serpStatus: expect.objectContaining({ state: "connected" }) }),
      findings: expect.any(Array),
    }));
    expect(written[0].schemaVersion).toBeUndefined();
    expect(written[0].sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "dataforseo", state: "not_applicable" }),
      expect.objectContaining({ id: "lighthouse", state: "partial" }),
    ] as SourceCoverage[]));
    expect(JSON.stringify(result)).not.toContain("execution-plan");
    expect(JSON.stringify(written[0])).not.toContain("execution-plan");
  });

  test("treats a failure to fetch the starting public page as fatal", async () => {
    const collectLighthouseProfiles = vi.fn();
    const collectYandexEvidence = vi.fn();
    const writeArtifacts = vi.fn();
    const failed = crawl();
    failed.pages[0] = { ...failed.pages[0], status: 0, indexable: false, error: "fetch failed" };

    await expect(runWgdReport(options(), {
      dnsResolver: PUBLIC_DNS,
      env: {},
      crawlSite: async () => failed,
      collectLighthouseProfiles,
      collectYandexEvidence,
      writeArtifacts,
    })).rejects.toThrow("Public page fetch failed");

    expect(collectLighthouseProfiles).not.toHaveBeenCalled();
    expect(collectYandexEvidence).not.toHaveBeenCalled();
    expect(writeArtifacts).not.toHaveBeenCalled();
  });

  test("selects homepage, explicit priorities, then crawl depth and discovery order up to six pages", () => {
    expect(selectLighthouseUrls(options({ lighthousePageLimit: 99 }), crawl())).toEqual([
      "https://example.com/",
      "https://example.com/pricing",
      "https://example.com/about",
      "https://example.com/second",
      "https://example.com/first",
      "https://example.com/deep",
    ]);
  });

  test("passes explicit priority URLs to the bounded crawler in argument order", async () => {
    const crawlSite = vi.fn(async () => twoPageCrawl());
    const priorityUrls = ["https://example.com/unlinked-b", "https://example.com/unlinked-a"];

    await runWgdReport(options({ priorityUrls, lighthousePageLimit: 1 }), {
      dnsResolver: PUBLIC_DNS,
      env: {},
      preflightDeps: { checkYandexHost: async () => false, checkGscProperty: async () => false },
      crawlSite,
      collectLighthouseProfiles: async () => [],
      collectYandexEvidence: async () => yandex(),
      writeArtifacts: async () => ({
        directory: "/memory/priorities",
        reportJson: "/memory/priorities/report.json",
        reportHtml: "/memory/priorities/report.html",
        evidenceFiles: [],
      }),
    });

    expect(crawlSite).toHaveBeenCalledWith(
      expect.objectContaining({ priorityUrls, keywords: ["example query"], robotsUserAgent: "YandexBot" }),
      expect.any(Object)
    );
  });

  test("uses YandexBot robots evidence for Russian reports", async () => {
    const crawlSite = vi.fn(async () => twoPageCrawl());

    await runWgdReport(options({ market: "RU", language: "ru" }), {
      dnsResolver: PUBLIC_DNS,
      env: {},
      preflightDeps: { checkYandexHost: async () => false, checkGscProperty: async () => false },
      crawlSite,
      collectLighthouseProfiles: async () => [],
      collectYandexEvidence: async () => yandex(),
      writeArtifacts: async () => ({
        directory: "/memory/ru-robots",
        reportJson: "/memory/ru-robots/report.json",
        reportHtml: "/memory/ru-robots/report.html",
        evidenceFiles: [],
      }),
    });

    expect(crawlSite).toHaveBeenCalledWith(
      expect.objectContaining({ robotsUserAgent: "YandexBot" }),
      expect.any(Object)
    );
  });

  test("uses Googlebot robots evidence for non-Russian reports", async () => {
    const crawlSite = vi.fn(async () => twoPageCrawl());

    await runWgdReport(options({ market: "AT", language: "de" }), {
      dnsResolver: PUBLIC_DNS,
      env: {},
      preflightDeps: { checkYandexHost: async () => false, checkGscProperty: async () => false },
      crawlSite,
      collectLighthouseProfiles: async () => [],
      collectYandexEvidence: async () => yandex(),
      writeArtifacts: async () => ({
        directory: "/memory/non-ru-robots",
        reportJson: "/memory/non-ru-robots/report.json",
        reportHtml: "/memory/non-ru-robots/report.html",
        evidenceFiles: [],
      }),
    });

    expect(crawlSite).toHaveBeenCalledWith(
      expect.objectContaining({ robotsUserAgent: "Googlebot" }),
      expect.any(Object)
    );
  });

  test("never selects direct or repeatedly encoded mutation priority pages", () => {
    expect(selectLighthouseUrls(options({
      lighthousePageLimit: 6,
      priorityUrls: [
        "https://example.com/logout",
        "https://example.com/account/settings",
        "https://example.com/registration",
        "https://example.com/%2525252563heckout",
        "https://example.com/pricing",
      ],
    }), crawl())).toEqual([
      "https://example.com/",
      "https://example.com/pricing",
      "https://example.com/second",
      "https://example.com/first",
      "https://example.com/deep",
      "https://example.com/about",
    ]);
  });

  test("selects only crawl-validated priority redirects and reports deterministic skips", async () => {
    const evidence = crawl();
    evidence.pages.push(
      {
        requestedUrl: "https://example.com/audit-target",
        finalUrl: "https://example.com/checkout",
        status: 200,
        contentType: "text/html",
        indexable: true,
        depth: 1,
        discoveryOrder: 4,
      },
      {
        requestedUrl: "https://example.com/safe-audit",
        finalUrl: "https://example.com/safe-final",
        status: 200,
        contentType: "text/html",
        indexable: true,
        depth: 1,
        discoveryOrder: 5,
      }
    );
    evidence.redirectChains.push(
      {
        requestedUrl: "https://example.com/audit-target",
        finalUrl: "https://example.com/checkout",
        urls: ["https://example.com/audit-target", "https://example.com/checkout"],
      },
      {
        requestedUrl: "https://example.com/safe-audit",
        finalUrl: "https://example.com/safe-final",
        urls: ["https://example.com/safe-audit", "https://example.com/safe-final"],
      }
    );
    const lighthouseTargets: string[][] = [];
    let written: WgdReportPayload | undefined;

    await runWgdReport(options({
      lighthousePageLimit: 2,
      priorityUrls: [
        "https://example.com/audit-target",
        "https://example.com/not-crawled",
        "https://example.com/safe-audit",
      ],
    }), {
      dnsResolver: PUBLIC_DNS,
      env: {},
      preflightDeps: { checkYandexHost: async () => false, checkGscProperty: async () => false },
      crawlSite: async () => evidence,
      collectLighthouseProfiles: (urls) => {
        lighthouseTargets.push(urls);
        return urls.flatMap((url) => (["mobile", "desktop"] as const).map((device) => ({ ...LAB_PROFILE, url, device, status: "success" as const })));
      },
      collectYandexEvidence: async () => yandex(),
      writeArtifacts: async (payload) => {
        written = payload;
        return {
          directory: "/memory/priority-redirects",
          reportJson: "/memory/priority-redirects/report.json",
          reportHtml: "/memory/priority-redirects/report.html",
          evidenceFiles: [],
        };
      },
    });

    expect(lighthouseTargets).toEqual([[
      "https://example.com/",
      "https://example.com/safe-final",
    ]]);
    expect(written?.limitations).toEqual(expect.arrayContaining([
      "Priority URL skipped because crawl evidence did not validate a safe final page: https://example.com/audit-target",
      "Priority URL skipped because no successful crawl evidence was collected: https://example.com/not-crawled",
    ]));
  });

  test("uses lazy default owner sources once for access confirmation and snapshot collection", async () => {
    const yandexSnapshot = { ...ownerSnapshot("https:example.com:443"), siteUrl: "https://example.com/" };
    const gscSnapshot = { ...ownerSnapshot("sc-domain:example.com"), siteUrl: "sc-domain:example.com" };
    const getYandexSnapshot = vi.fn(async () => yandexSnapshot);
    const getGscSnapshot = vi.fn(async () => gscSnapshot);
    let receivedDeps: YandexEvidenceDeps | undefined;

    const result = await runWgdReport(options({ lighthousePageLimit: 1 }), {
      dnsResolver: PUBLIC_DNS,
      env: {
        YANDEX_WEBMASTER_OAUTH_TOKEN: "configured",
        GSC_ENABLED: "true",
        GOOGLE_OAUTH_CLIENT_ID: "configured",
        GOOGLE_OAUTH_CLIENT_SECRET: "configured",
        SEO_REPORT_GSC_TEAM_ID: "team-1",
        GSC_SITE_URL: "sc-domain:example.com",
      },
      ownerSourceFactories: {
        createYandexWebmaster: async () => ({ getSnapshot: getYandexSnapshot }),
        createGoogleSearchConsole: async () => ({ getSnapshot: getGscSnapshot }),
      },
      crawlSite: async () => twoPageCrawl(),
      collectLighthouseProfiles: () => [
        { ...LAB_PROFILE, url: "https://example.com/", device: "mobile", status: "success" },
        { ...LAB_PROFILE, url: "https://example.com/", device: "desktop", status: "success" },
      ],
      collectYandexEvidence: async (_reportOptions, evidenceDeps) => {
        receivedDeps = evidenceDeps;
        return {
          ...yandex(),
          yandexWebmasterSnapshot: await evidenceDeps?.getYandexWebmasterSnapshot?.(options()),
          gscSnapshot: await evidenceDeps?.getGscSnapshot?.(options()),
        };
      },
      writeArtifacts: async () => ({
        directory: "/memory/owners",
        reportJson: "/memory/owners/report.json",
        reportHtml: "/memory/owners/report.html",
        evidenceFiles: [],
      }),
    });

    expect(receivedDeps?.ownerAccess).toEqual({ yandexWebmaster: true, gsc: true });
    expect(getYandexSnapshot).toHaveBeenCalledOnce();
    expect(getYandexSnapshot).toHaveBeenCalledWith("https://example.com/", { device: null }, expect.any(AbortSignal));
    expect(getGscSnapshot).toHaveBeenCalledOnce();
    expect(getGscSnapshot).toHaveBeenCalledWith("example.com", {
      teamId: "team-1",
      siteUrl: "sc-domain:example.com",
    }, expect.any(AbortSignal));
    expect(result.summary.coverage).toEqual(expect.objectContaining({
      yandex_webmaster: "success",
      gsc: "success",
    }));
  });

  test("rejects mismatched Yandex Webmaster and GSC properties before confirmation or publication", async () => {
    const foreignYandex = { ...ownerSnapshot("https:foreign.example:443"), siteUrl: "https://foreign.example/" };
    const foreignGsc = { ...ownerSnapshot("sc-domain:foreign.example"), siteUrl: "sc-domain:foreign.example" };
    const getYandexSnapshot = vi.fn(async () => foreignYandex);
    const getGscSnapshot = vi.fn(async () => foreignGsc);
    let written: WgdReportPayload | undefined;

    const result = await runWgdReport(options({ lighthousePageLimit: 1 }), {
      dnsResolver: PUBLIC_DNS,
      env: {
        YANDEX_WEBMASTER_OAUTH_TOKEN: "configured",
        GSC_ENABLED: "true",
        GOOGLE_OAUTH_CLIENT_ID: "configured",
        GOOGLE_OAUTH_CLIENT_SECRET: "configured",
        SEO_REPORT_GSC_TEAM_ID: "team-1",
        GSC_SITE_URL: "sc-domain:example.com",
      },
      ownerSourceFactories: {
        createYandexWebmaster: async () => ({ getSnapshot: getYandexSnapshot }),
        createGoogleSearchConsole: async () => ({ getSnapshot: getGscSnapshot }),
      },
      crawlSite: async () => twoPageCrawl(),
      collectLighthouseProfiles: () => [],
      writeArtifacts: async (payload) => {
        written = payload;
        return {
          directory: "/memory/owner-mismatch",
          reportJson: "/memory/owner-mismatch/report.json",
          reportHtml: "/memory/owner-mismatch/report.html",
          evidenceFiles: [],
        };
      },
    });

    expect(getYandexSnapshot).toHaveBeenCalledOnce();
    expect(getGscSnapshot).toHaveBeenCalledOnce();
    expect(result.summary.coverage).toEqual(expect.objectContaining({
      yandex_webmaster: "owner_access_required",
      gsc: "owner_access_required",
    }));
    const published = written?.yandex as YandexEvidence | undefined;
    expect(published?.yandexWebmasterSnapshot).toBeUndefined();
    expect(published?.gscSnapshot).toBeUndefined();
    expect(JSON.stringify(written)).not.toContain("foreign.example");
  });

  test("preserves GSC URL-prefix scheme, origin, port, and path scope", async () => {
    const target = "https://example.com/blog/post";
    const crawlEvidence = twoPageCrawl();
    crawlEvidence.pages[0] = {
      ...crawlEvidence.pages[0],
      requestedUrl: target,
      finalUrl: target,
    };
    const runWithProperty = async (property: string) => {
      const result = await runWgdReport(options({ url: target, priorityUrls: [] }), {
        dnsResolver: PUBLIC_DNS,
        env: {
          GSC_ENABLED: "true",
          GOOGLE_OAUTH_CLIENT_ID: "configured",
          GOOGLE_OAUTH_CLIENT_SECRET: "configured",
          SEO_REPORT_GSC_TEAM_ID: "team-1",
        },
        ownerSourceFactories: {
          createGoogleSearchConsole: async () => ({
            getSnapshot: async () => ({ ...ownerSnapshot(property), siteUrl: property }),
          }),
        },
        crawlSite: async () => crawlEvidence,
        collectLighthouseProfiles: async () => [],
        collectYandexEvidence: async (_options, evidenceDeps) => ({
          ...yandex(),
          gscSnapshot: await evidenceDeps?.getGscSnapshot?.(options({ url: target })),
        }),
        writeArtifacts: async () => ({
          directory: "/memory/gsc-prefix",
          reportJson: "/memory/gsc-prefix/report.json",
          reportHtml: "/memory/gsc-prefix/report.html",
          evidenceFiles: [],
        }),
      });
      return result.summary.coverage.gsc;
    };

    expect(await runWithProperty("https://example.com/blog/")).toBe("success");
    expect(await runWithProperty("http://example.com/blog/")).toBe("owner_access_required");
    expect(await runWithProperty("https://example.com:444/blog/")).toBe("owner_access_required");
    expect(await runWithProperty("https://example.com/shop/")).toBe("owner_access_required");
  });

  test("classifies a missing matching owner property separately from transport failure", async () => {
    const runOwnerFailure = async (error: Error) => (await runWgdReport(options(), {
      dnsResolver: PUBLIC_DNS,
      env: {
        GSC_ENABLED: "true",
        GOOGLE_OAUTH_CLIENT_ID: "configured",
        GOOGLE_OAUTH_CLIENT_SECRET: "configured",
        SEO_REPORT_GSC_TEAM_ID: "team-1",
      },
      ownerSourceFactories: {
        createGoogleSearchConsole: async () => ({ getSnapshot: async () => { throw error; } }),
      },
      crawlSite: async () => twoPageCrawl(),
      collectLighthouseProfiles: async () => [],
      collectYandexEvidence: async () => yandex(),
      writeArtifacts: async () => ({
        directory: "/memory/owner-errors",
        reportJson: "/memory/owner-errors/report.json",
        reportHtml: "/memory/owner-errors/report.html",
        evidenceFiles: [],
      }),
    })).summary.coverage.gsc;

    expect(await runOwnerFailure(new SeoProviderNotConfiguredError("no matching property")))
      .toBe("owner_access_required");
    expect(await runOwnerFailure(new Error("transport failed"))).toBe("unavailable");
  });

  test("revalidates collector owner snapshots before publishing the payload", async () => {
    const matchingYandex = ownerSnapshot("https:example.com:443");
    const matchingGsc = ownerSnapshot("sc-domain:example.com");
    const foreignYandex = { ...ownerSnapshot("https:foreign.example:443"), siteUrl: "https://foreign.example/" };
    const foreignGsc = { ...ownerSnapshot("sc-domain:foreign.example"), siteUrl: "sc-domain:foreign.example" };
    let written: WgdReportPayload | undefined;

    const result = await runWgdReport(options({ lighthousePageLimit: 1 }), {
      dnsResolver: PUBLIC_DNS,
      env: {
        YANDEX_WEBMASTER_OAUTH_TOKEN: "configured",
        GSC_ENABLED: "true",
        GOOGLE_OAUTH_CLIENT_ID: "configured",
        GOOGLE_OAUTH_CLIENT_SECRET: "configured",
        SEO_REPORT_GSC_TEAM_ID: "team-1",
      },
      ownerSourceFactories: {
        createYandexWebmaster: async () => ({ getSnapshot: async () => matchingYandex }),
        createGoogleSearchConsole: async () => ({ getSnapshot: async () => matchingGsc }),
      },
      crawlSite: async () => twoPageCrawl(),
      collectLighthouseProfiles: () => [],
      collectYandexEvidence: async () => ({
        ...yandex(),
        yandexWebmasterSnapshot: foreignYandex,
        gscSnapshot: foreignGsc,
      }),
      writeArtifacts: async (payload) => {
        written = payload;
        return {
          directory: "/memory/collector-owner-mismatch",
          reportJson: "/memory/collector-owner-mismatch/report.json",
          reportHtml: "/memory/collector-owner-mismatch/report.html",
          evidenceFiles: [],
        };
      },
    });

    expect(result.summary.coverage).toEqual(expect.objectContaining({
      yandex_webmaster: "owner_access_required",
      gsc: "owner_access_required",
    }));
    const published = written?.yandex as YandexEvidence | undefined;
    expect(published?.yandexWebmasterSnapshot).toBeUndefined();
    expect(published?.gscSnapshot).toBeUndefined();
    expect(JSON.stringify(written)).not.toContain("foreign.example");
  });

  test("keeps failed default owner sources behind the confirmation gate and fixed safe states", async () => {
    const secret = "raw-owner-provider-secret";
    const getYandexSnapshot = vi.fn(async () => { throw new Error(secret); });
    const getGscSnapshot = vi.fn(async () => { throw new Error(secret); });
    let receivedDeps: YandexEvidenceDeps | undefined;
    let written: WgdReportPayload | undefined;

    const result = await runWgdReport(options({ lighthousePageLimit: 1 }), {
      dnsResolver: PUBLIC_DNS,
      env: {
        YANDEX_WEBMASTER_OAUTH_TOKEN: "configured",
        GSC_ENABLED: "true",
        GOOGLE_OAUTH_CLIENT_ID: "configured",
        GOOGLE_OAUTH_CLIENT_SECRET: "configured",
        SEO_REPORT_GSC_TEAM_ID: "team-1",
      },
      ownerSourceFactories: {
        createYandexWebmaster: async () => ({ getSnapshot: getYandexSnapshot }),
        createGoogleSearchConsole: async () => ({ getSnapshot: getGscSnapshot }),
      },
      crawlSite: async () => twoPageCrawl(),
      collectLighthouseProfiles: () => [],
      collectYandexEvidence: async (_reportOptions, evidenceDeps) => {
        receivedDeps = evidenceDeps;
        return yandex();
      },
      writeArtifacts: async (payload) => {
        written = payload;
        return {
          directory: "/memory/owner-failure",
          reportJson: "/memory/owner-failure/report.json",
          reportHtml: "/memory/owner-failure/report.html",
          evidenceFiles: [],
        };
      },
    });

    expect(receivedDeps?.ownerAccess).toEqual({ yandexWebmaster: false, gsc: false });
    expect(getYandexSnapshot).toHaveBeenCalledOnce();
    expect(getGscSnapshot).toHaveBeenCalledOnce();
    expect(result.summary.coverage).toEqual(expect.objectContaining({
      yandex_webmaster: "unavailable",
      gsc: "unavailable",
    }));
    expect(JSON.stringify(written)).not.toContain(secret);
  });

  test("propagates the preflight deadline abort signal into a hanging default owner transport", async () => {
    let transportAborted = false;
    const getYandexSnapshot = vi.fn((_domain: string, _options: unknown, signal?: AbortSignal) =>
      new Promise<SeoSearchConsoleSnapshot>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          transportAborted = true;
          reject(new Error("transport aborted"));
        }, { once: true });
      }));

    const result = await runWgdReport(options({ lighthousePageLimit: 1 }), {
      dnsResolver: PUBLIC_DNS,
      env: { YANDEX_WEBMASTER_OAUTH_TOKEN: "configured" },
      preflightDeps: { accessCheckTimeoutMs: 5 },
      ownerSourceFactories: {
        createYandexWebmaster: async () => ({ getSnapshot: getYandexSnapshot }),
      },
      crawlSite: async () => twoPageCrawl(),
      collectLighthouseProfiles: async () => [],
      collectYandexEvidence: async () => yandex(),
      writeArtifacts: async () => ({
        directory: "/memory/owner-timeout",
        reportJson: "/memory/owner-timeout/report.json",
        reportHtml: "/memory/owner-timeout/report.html",
        evidenceFiles: [],
      }),
    });

    expect(transportAborted).toBe(true);
    expect(result.summary.coverage.yandex_webmaster).toBe("unavailable");
  });

  test("reconciles a Yandex SERP provider error to unavailable coverage", async () => {
    const evidence = {
      ...yandex(),
      serpChecks: [],
      serpStatus: {
        state: "provider_error" as const,
        message: "Yandex rank checks were unavailable.",
        checkedAt: "2026-08-31T10:00:00.000Z",
      },
    };

    const { result } = await runCoverageScenario(evidence);

    expect(result.summary.coverage.yandex_search).toBe("unavailable");
  });

  test("reconciles all failed Alice probes to unavailable coverage", async () => {
    const evidence: YandexEvidence = {
      ...yandex(),
      aiProbes: [aiProbe("failed", "one"), aiProbe("failed", "two")],
      aiSampleVisibility: { used: 0, checked: 0, rate: null },
      manualQueries: [
        { source: "alice_ai", query: "one", reason: "failed" },
        { source: "alice_ai", query: "two", reason: "failed" },
      ],
    };

    const { result } = await runCoverageScenario(evidence, { aiQueries: ["one", "two"] });

    expect(result.summary.coverage.alice_ai).toBe("unavailable");
  });

  test("reconciles mixed checked and failed Alice probes to partial coverage", async () => {
    const evidence: YandexEvidence = {
      ...yandex(),
      aiProbes: [aiProbe("checked", "one"), aiProbe("failed", "two")],
      aiSampleVisibility: { used: 0, checked: 1, rate: 0 },
      manualQueries: [{ source: "alice_ai", query: "two", reason: "failed" }],
    };

    const { result } = await runCoverageScenario(evidence, { aiQueries: ["one", "two"] });

    expect(result.summary.coverage.alice_ai).toBe("partial");
  });

  test("marks Yandex inputs not applicable when no SERP or AI queries were requested", async () => {
    const evidence: YandexEvidence = {
      ...yandex(),
      serpChecks: [],
      serpStatus: { state: "no_keywords", message: "No keywords", checkedAt: "2026-08-31T10:00:00.000Z" },
    };

    const { result } = await runCoverageScenario(evidence, { keywords: [], aiQueries: [] });

    expect(result.summary.coverage).toEqual(expect.objectContaining({
      yandex_search: "not_applicable",
      alice_ai: "not_applicable",
    }));
  });

  test("reconciles the orchestration Yandex fallback to unavailable without leaking provider errors", async () => {
    const secret = "raw-yandex-fallback-secret";

    const { result, payload } = await runCoverageScenario(new Error(secret));

    expect(result.summary.status).toBe("partial");
    expect(result.summary.coverage).toEqual(expect.objectContaining({
      yandex_search: "unavailable",
      alice_ai: "unavailable",
    }));
    expect(JSON.stringify(payload)).not.toContain(secret);
  });
});

describe("runSeoReportCli", () => {
  test("lists every supported option in help", async () => {
    const stdout: string[] = [];
    const code = await runSeoReportCli(["--help"], { stdout: (line) => stdout.push(line) });

    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("--url");
    expect(stdout.join("\n")).toContain("--market");
    expect(stdout.join("\n")).toContain("--language");
    expect(stdout.join("\n")).toContain("--region");
    expect(stdout.join("\n")).toContain("--keyword");
    expect(stdout.join("\n")).toContain("--ai-query");
    expect(stdout.join("\n")).toContain("--crawl-limit");
    expect(stdout.join("\n")).toContain("--lighthouse-page-limit");
    expect(stdout.join("\n")).toContain("--priority-url");
    expect(stdout.join("\n")).toContain("--out-dir");
  });

  test("prints only the safe result JSON on success", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const safeResult = {
      reportDir: "/reports/run",
      htmlPath: "/reports/run/report.html",
      jsonPath: "/reports/run/report.json",
      manualQueryPackPath: undefined,
      summary: {
        status: "success" as const,
        domain: "example.com",
        pagesCrawled: 1,
        findings: 0,
        lighthouseProfiles: { requested: 2, successful: 2, failed: 0 },
        coverage: { dataforseo: "not_applicable" as const, crawl: "success" as const, lighthouse: "success" as const },
      },
    };
    const runReport = vi.fn(async () => safeResult);

    const code = await runSeoReportCli(["--url", "example.com"], {
      runReport,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    expect(code).toBe(0);
    expect(runReport).toHaveBeenCalledOnce();
    expect(stdout).toEqual([JSON.stringify(safeResult, null, 2)]);
    expect(stderr).toEqual([]);
  });

  test("returns one for invalid and fatal runs without echoing secrets", async () => {
    const secret = "provider-token-must-not-leak";
    const invalidOutput: string[] = [];
    const fatalOutput: string[] = [];

    await expect(runSeoReportCli(["--url", `file://${secret}`], {
      stdout: (line) => invalidOutput.push(line),
      stderr: (line) => invalidOutput.push(line),
    })).resolves.toBe(1);
    await expect(runSeoReportCli(["--url", "example.com"], {
      runReport: async () => { throw new Error(secret); },
      stdout: (line) => fatalOutput.push(line),
      stderr: (line) => fatalOutput.push(line),
    })).resolves.toBe(1);

    expect(invalidOutput.join("\n")).not.toContain(secret);
    expect(fatalOutput.join("\n")).not.toContain(secret);
  });
});
