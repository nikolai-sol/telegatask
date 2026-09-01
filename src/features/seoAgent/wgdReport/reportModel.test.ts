import { describe, expect, test } from "vitest";
import { buildPublishedWgdReport } from "./reportModel";
import { renderWgdHtml } from "./reportRenderer";
import type { CrawlEvidence, WgdReportPayload } from "./types";

const HOME = "https://example.com/";

function payload(): WgdReportPayload {
  const pages = [{
    requestedUrl: HOME,
    finalUrl: HOME,
    status: 200,
    contentType: "text/html",
    title: "Example",
    titleLength: 7,
    description: "A normalized description",
    descriptionLength: 24,
    canonical: HOME,
    headings: { h1: ["Example"], h2: [] },
    internalLinks: [],
    linksTruncated: false,
    images: { total: 1, missingAlt: 0 },
    wordCount: 420,
    indexable: true,
    signalConflicts: [],
    keywordAlignment: {
      state: "measured" as const,
      method: "normalized_token_presence" as const,
      checkedKeywords: 1,
      matches: [{ keyword: "example", fields: ["title" as const] }],
      unmatchedKeywords: [],
      note: "Normalized evidence retained.",
    },
    depth: 0,
    discoveryOrder: 0,
    discoverySources: ["start" as const],
    inboundInternalLinks: 1,
    orphanCandidate: false,
  }];
  const crawl: CrawlEvidence = {
    attemptedUrlCount: 1,
    eligibleDiscoveredCount: 1,
    droppedEligibleCount: 0,
    truncated: false,
    pages,
    robots: {
      url: "https://example.com/robots.txt",
      status: 200,
      sitemapUrls: [],
      access: { state: "measured", userAgent: "YandexBot", checkedUrlCount: 1, blockedUrls: [] },
    },
    sitemapCandidates: [],
    discoveredUrls: [HOME],
    excludedUrls: [],
    brokenUrls: [],
    redirectChains: [],
    duplicateTitles: {},
    duplicateDescriptions: {},
    limitations: [],
  };
  return {
    schemaVersion: "1.0",
    generatedAt: "2026-09-01T10:20:30.000Z",
    options: {
      url: HOME,
      domain: "example.com",
      market: "RU",
      language: "ru",
      region: "225",
      crawlLimit: 1,
      lighthousePageLimit: 1,
      keywords: ["example"],
      aiQueries: [],
      priorityUrls: [],
      outDir: "/tmp/reports",
      sources: { dataForSeo: "not_applicable" },
    },
    sources: [{ id: "crawl", state: "success" }],
    crawl,
    pages,
    lighthouse: [],
    yandex: {
      serpChecks: [{
        query: "example", searchEngine: "yandex", provider: "yandex_search_api",
        targetDomain: "example.com", found: true, position: 2, checkedDepth: 20,
        competitorsAbove: [{ position: 1, domain: "competitor.example", url: "https://competitor.example/", title: "Competitor" }],
        device: "desktop", checkedAt: "2026-09-01T10:20:00.000Z",
      }],
      serpStatus: {
        state: "connected", message: "Connected",
        metricsSummary: { requested: 1, partial: false, note: null },
      },
      aiProbes: [],
      aiSampleVisibility: { used: 0, checked: 0, rate: null },
      manualQueries: [],
      limitations: [],
    },
    findings: [{
      code: "missing_image_alt", severity: "medium", affectedUrl: HOME,
      evidence: "One image lacks alt text.", source: "crawl:page_html", confidence: "high",
      action: "Add alt text.", expectedEffect: "Better accessibility.",
      acceptanceCriterion: "No meaningful image lacks alt text.", verification: "Crawl again.",
    }],
    limitations: [],
    evidenceFiles: ["evidence/crawl.json", "evidence/lighthouse-home-mobile.json"],
    assessment: { displayScore: 100, status: "good", forged: true },
    groupedFindings: [{ code: "homepage_noindex", forged: true }],
  };
}

describe("buildPublishedWgdReport", () => {
  test("publishes schema 2 with recalculated scores and all finding groups while retaining normalized evidence", () => {
    const published = buildPublishedWgdReport(payload());

    expect(published.schemaVersion).toBe("2.0");
    expect(published.assessment).not.toHaveProperty("forged");
    expect(published.assessment.displayScore).not.toBe(100);
    expect(published.assessment.pages).toEqual([
      expect.objectContaining({ url: HOME, score: expect.any(Number) }),
    ]);
    expect(published.groupedFindings).toEqual([
      expect.objectContaining({ code: "missing_image_alt", affectedUrls: [HOME] }),
    ]);
    expect(published.crawl).toEqual(expect.objectContaining({
      attemptedUrlCount: 1, eligibleDiscoveredCount: 1, droppedEligibleCount: 0, truncated: false,
    }));
    expect(published.pages[0]).toEqual(expect.objectContaining({
      titleLength: 7,
      descriptionLength: 24,
      signalConflicts: [],
      keywordAlignment: expect.objectContaining({ method: "normalized_token_presence" }),
      discoverySources: ["start"],
    }));
    expect(published.yandex.serpChecks[0]).toEqual(expect.objectContaining({ checkedDepth: 20 }));
    expect(published.yandex.serpChecks[0].competitorsAbove).toEqual([
      { position: 1, domain: "competitor.example", url: "https://competitor.example/", title: "Competitor" },
    ]);
    expect(published.yandex.serpStatus.metricsSummary).toEqual({ requested: 1, partial: false, note: null });
    expect(published.evidenceFiles).toEqual([
      "evidence/crawl.json", "evidence/lighthouse-home-mobile.json",
    ]);
  });

  test("is idempotent and replaces forged derived fields on every call", () => {
    const first = buildPublishedWgdReport(payload());
    const forgedAgain = {
      ...first,
      assessment: { ...first.assessment, displayScore: 100, forged: true },
      groupedFindings: [{ code: "homepage_noindex", forged: true }],
    } as unknown as WgdReportPayload;

    expect(buildPublishedWgdReport(first)).toEqual(first);
    expect(buildPublishedWgdReport(forgedAgain)).toEqual(first);
  });

  test("fails closed when a legacy crawl omits required coverage counters", () => {
    const legacy = payload();
    delete (legacy.crawl as Partial<CrawlEvidence>).attemptedUrlCount;
    delete (legacy.crawl as Partial<CrawlEvidence>).eligibleDiscoveredCount;

    const published = buildPublishedWgdReport(legacy);

    expect(published.assessment.state).toBe("insufficient_data");
    expect(published.assessment.components.technical).toEqual(expect.objectContaining({
      score: null,
      scoringCoverage: 0,
      effectiveWeight: 0,
    }));
    expect(published.crawl).toEqual(expect.objectContaining({ pages: expect.any(Array) }));
    expect(published.crawl).not.toHaveProperty("attemptedUrlCount");
  });

  test.each([
    { attemptedUrlCount: 5, eligibleDiscoveredCount: 1, droppedEligibleCount: 7, truncated: false },
    { attemptedUrlCount: 1, eligibleDiscoveredCount: 3, droppedEligibleCount: 1, truncated: true },
    { attemptedUrlCount: 1, eligibleDiscoveredCount: 1, droppedEligibleCount: 0, truncated: true },
    { attemptedUrlCount: 1, eligibleDiscoveredCount: 2, droppedEligibleCount: 1, truncated: false },
  ])("fails technical scoring closed for inconsistent crawl relations %#", (counters) => {
    const inconsistent = payload();
    Object.assign(inconsistent.crawl as CrawlEvidence, counters);

    const published = buildPublishedWgdReport(inconsistent);

    expect(published.assessment.components.technical).toEqual(expect.objectContaining({
      score: null,
      scoringCoverage: 0,
      effectiveWeight: 0,
    }));
    expect(published.crawl).toEqual(expect.objectContaining(counters));
  });

  test("fails technical scoring closed when nested crawl scoring dependencies are malformed", () => {
    const malformed = payload();
    (malformed.crawl as unknown as Record<string, unknown>).robots = null;

    const published = buildPublishedWgdReport(malformed);

    expect(published.assessment.components.technical).toEqual(expect.objectContaining({
      score: null, scoringCoverage: 0, effectiveWeight: 0,
    }));
    expect(published.crawl).toEqual(expect.objectContaining({ robots: null }));
  });

  test("keeps a coherent crawl scorable when non-HTML attempts have no page record", () => {
    const nonHtml = payload();
    Object.assign(nonHtml.crawl as CrawlEvidence, {
      attemptedUrlCount: 2,
      eligibleDiscoveredCount: 3,
      droppedEligibleCount: 1,
      truncated: true,
      discoveredUrls: [HOME, "https://example.com/download.pdf"],
      robots: {
        ...(nonHtml.crawl as CrawlEvidence).robots,
        access: {
          ...(nonHtml.crawl as CrawlEvidence).robots.access,
          checkedUrlCount: 2,
        },
      },
    });

    const technical = buildPublishedWgdReport(nonHtml).assessment.components.technical;

    expect(technical.score).not.toBeNull();
    expect(technical.scoringCoverage).toBeGreaterThan(0);
  });

  test("fails technical scoring closed when top-level pages contradict the crawl page identities", () => {
    const contradictory = payload();
    (contradictory.crawl as CrawlEvidence).pages = [];

    const published = buildPublishedWgdReport(contradictory);

    expect(published.assessment.components.technical).toEqual(expect.objectContaining({
      score: null, scoringCoverage: 0, effectiveWeight: 0,
    }));
    expect(published.assessment.pages).toEqual([]);
  });

  test.each(["crawl pages", "discovered URLs", "top-level pages"] as const)(
    "fails technical scoring closed for duplicate %s identities",
    (duplicateLocation) => {
      const duplicate = payload();
      const crawl = duplicate.crawl as CrawlEvidence;
      if (duplicateLocation === "crawl pages") {
        crawl.pages = [crawl.pages[0]!, { ...crawl.pages[0]! }];
      } else if (duplicateLocation === "discovered URLs") {
        crawl.discoveredUrls = [HOME, HOME];
      } else {
        duplicate.pages = [duplicate.pages![0]!, { ...duplicate.pages![0]! }];
      }
      Object.assign(crawl, {
        attemptedUrlCount: 2,
        eligibleDiscoveredCount: 2,
        robots: {
          ...crawl.robots,
          access: { ...crawl.robots.access, checkedUrlCount: 2 },
        },
      });
      if (duplicateLocation !== "discovered URLs") {
        crawl.discoveredUrls = [HOME, "https://example.com/non-html.pdf"];
      }

      const published = buildPublishedWgdReport(duplicate);

      expect(published.assessment.components.technical).toEqual(expect.objectContaining({
        score: null, scoringCoverage: 0, effectiveWeight: 0,
      }));
      expect(published.assessment.pages).toEqual([]);
    }
  );

  test("uses a narrow safe legacy crawl view for finding groups without trusting it for scoring", () => {
    const legacy = payload();
    delete (legacy.crawl as Partial<CrawlEvidence>).attemptedUrlCount;
    (legacy.crawl as CrawlEvidence).duplicateTitles = {
      Example: [HOME, "https://example.com/about"],
    };
    legacy.findings = [{
      code: "duplicate_titles", severity: "high",
      evidence: "Duplicate title.", source: "crawl:duplicates", confidence: "high",
      action: "Make titles unique.", expectedEffect: "Clearer pages.",
      acceptanceCriterion: "Titles differ.", verification: "Crawl again.",
    }];

    const published = buildPublishedWgdReport(legacy);

    expect(published.assessment.components.technical.scoringCoverage).toBe(0);
    expect(published.groupedFindings).toEqual([
      expect.objectContaining({
        code: "duplicate_titles",
        affectedUrls: [HOME, "https://example.com/about"],
      }),
    ]);
  });

  test("ignores malformed array elements without throwing or breaking idempotence", () => {
    const malformed = payload();
    malformed.pages = [
      null,
      malformed.pages![0],
      { ...malformed.pages![0], headings: "broken" },
      { requestedUrl: HOME },
    ] as unknown as typeof malformed.pages;
    malformed.sources = [
      null,
      { id: "bad" },
      malformed.sources![0],
      { ...malformed.sources![0], details: [] },
    ] as unknown as typeof malformed.sources;
    malformed.lighthouse = [
      null,
      { device: "mobile" },
      { url: HOME, device: "mobile", categoryScores: "broken" },
    ] as unknown as typeof malformed.lighthouse;
    malformed.findings = [
      null,
      malformed.findings[0],
      { ...malformed.findings[0], affectedUrl: 42 },
      { code: "broken" },
    ] as unknown as typeof malformed.findings;
    const yandex = malformed.yandex as Record<string, unknown>;
    yandex.serpChecks = [null, ...(yandex.serpChecks as unknown[])];
    yandex.aiProbes = [null, { status: "checked" }];

    expect(() => renderWgdHtml(malformed)).not.toThrow();
    const published = buildPublishedWgdReport(malformed);

    expect(published.pages).toHaveLength(1);
    expect(published.sources).toEqual([{ id: "crawl", state: "success" }]);
    expect(published.lighthouse).toEqual([]);
    expect(published.findings).toHaveLength(1);
    expect((published.yandex as { serpChecks: unknown[] }).serpChecks).toHaveLength(1);
    expect((published.yandex as { aiProbes: unknown[] }).aiProbes).toEqual([]);
    expect(buildPublishedWgdReport(published)).toEqual(published);
  });

  test("retains valid unavailable Alice probes without counting them as checked", () => {
    const unavailable = payload();
    unavailable.options.aiQueries = ["a1", "a2"];
    (unavailable.yandex as Record<string, unknown>).aiProbes = [
      { query: "a1", status: "not_configured" },
      { query: "a2", status: "permission_denied" },
    ];

    const published = buildPublishedWgdReport(unavailable);

    expect((published.yandex as { aiProbes: Array<{ status: string }> }).aiProbes.map((item) => item.status))
      .toEqual(["not_configured", "permission_denied"]);
    expect(published.assessment.components.alice).toEqual(expect.objectContaining({
      collected: 0, scoringCoverage: 0,
    }));
  });

  test("fails closed for finite numbers outside collector evidence domains", () => {
    const adversarial = payload();
    const page = adversarial.pages![0];
    page.status = 200.5;
    page.inboundInternalLinks = 0.5;
    const crawl = adversarial.crawl as CrawlEvidence;
    crawl.pages = [page];
    crawl.sitemapCandidates = [{
      url: "https://example.com/sitemap.xml",
      source: "common",
      status: 200.5,
      urls: [HOME],
      isIndex: "not-a-boolean" as unknown as boolean,
    }];
    adversarial.options.keywords = ["q1", "q2", "q3"];
    (adversarial.yandex as Record<string, unknown>).serpChecks = ["q1", "q2", "q3"].map((query) => ({
      query,
      searchEngine: "yandex",
      provider: "yandex_search_api",
      targetDomain: "example.com",
      found: true,
      position: 0.5,
      checkedDepth: 0.5,
      device: "desktop",
      checkedAt: "2026-09-01T10:20:00.000Z",
    }));
    adversarial.lighthouse = ["mobile", "desktop"].map((device) => ({
      measurementType: "lab",
      fieldData: { source: "CrUX", state: "not_collected" },
      url: HOME,
      device,
      status: "success",
      categoryScores: { performance: 1000, accessibility: 1000, "best-practices": 1000 },
      metrics: { largestContentfulPaintMs: -1 },
    })) as typeof adversarial.lighthouse;

    const published = buildPublishedWgdReport(adversarial);

    expect(published.pages).toEqual([]);
    expect(published.lighthouse).toEqual([]);
    expect(published.assessment.components.technical.scoringCoverage).toBe(0);
    expect(published.assessment.components.yandex).toEqual(expect.objectContaining({
      score: null, collected: 0, scoringCoverage: 0,
    }));
    expect(published.assessment.components.lighthouse).toEqual(expect.objectContaining({
      score: null, collected: 0, scoringCoverage: 0,
    }));
    expect(published.assessment.state).toBe("insufficient_data");
  });

  test("accepts the page error sentinel but rejects non-HTTP status numbers", () => {
    const sentinel = payload();
    sentinel.pages![0].status = 0;
    sentinel.pages![0].error = "Fetch failed";
    (sentinel.crawl as CrawlEvidence).pages[0].status = 0;
    (sentinel.crawl as CrawlEvidence).pages[0].error = "Fetch failed";
    expect(buildPublishedWgdReport(sentinel).pages).toHaveLength(1);

    const invalidPage = payload();
    invalidPage.pages![0].status = 42;
    (invalidPage.crawl as CrawlEvidence).pages[0].status = 42;
    expect(buildPublishedWgdReport(invalidPage).pages).toEqual([]);

    const invalidRobots = payload();
    (invalidRobots.crawl as CrawlEvidence).robots.status = 42;
    expect(buildPublishedWgdReport(invalidRobots).assessment.components.technical.scoringCoverage).toBe(0);

    const invalidSitemap = payload();
    (invalidSitemap.crawl as CrawlEvidence).sitemapCandidates = [{
      url: "https://example.com/sitemap.xml", source: "common", status: 42, urls: [HOME],
    }];
    expect(buildPublishedWgdReport(invalidSitemap).assessment.components.technical.scoringCoverage).toBe(0);
  });

  test("rejects a contradictory Yandex miss and presents only coherent miss evidence", () => {
    const contradictory = payload();
    const contradictoryYandex = contradictory.yandex as Record<string, unknown>;
    contradictoryYandex.serpChecks = [{
      query: "example", searchEngine: "yandex", provider: "yandex_search_api",
      targetDomain: "example.com", found: false, position: 2, matchedUrl: HOME,
      checkedDepth: 20, device: "desktop", checkedAt: "2026-09-01T10:20:00.000Z",
    }];

    const publishedContradiction = buildPublishedWgdReport(contradictory);
    const contradictoryHtml = renderWgdHtml(contradictory);

    expect(publishedContradiction.yandex?.serpChecks).toEqual([]);
    expect(publishedContradiction.assessment.components.yandex.collected).toBe(0);
    expect(contradictoryHtml).toContain("Проверка не выполнена");
    expect(contradictoryHtml).not.toContain("Не найден среди первых 20 результатов");

    const coherent = payload();
    (coherent.yandex as Record<string, unknown>).serpChecks = [{
      query: "example", searchEngine: "yandex", provider: "yandex_search_api",
      targetDomain: "example.com", found: false, checkedDepth: 20,
      topResultDomains: ["competitor.example"],
      device: "desktop", checkedAt: "2026-09-01T10:20:00.000Z",
    }];

    const publishedMiss = buildPublishedWgdReport(coherent);
    const coherentHtml = renderWgdHtml(coherent);

    expect(publishedMiss.yandex?.serpChecks).toHaveLength(1);
    expect(publishedMiss.assessment.components.yandex).toEqual(expect.objectContaining({
      score: 0, collected: 1,
    }));
    expect(coherentHtml).toContain("Не найден среди первых 20 результатов");
  });

  test("canonicalizes query lists once for JSON, assessment, and HTML presentation", () => {
    const duplicates = payload();
    duplicates.options.keywords = ["  Café SEO  ", "cafe\u0301 seo", "CAFÉ SEO"];
    duplicates.options.aiQueries = ["  AI Café  ", "ai cafe\u0301", "AI CAFÉ"];
    const yandex = duplicates.yandex as Record<string, unknown>;
    yandex.serpChecks = [{
      query: "Café SEO", searchEngine: "yandex", provider: "yandex_search_api",
      targetDomain: "example.com", found: true, position: 2, checkedDepth: 20,
      device: "desktop", checkedAt: "2026-09-01T10:20:00.000Z",
    }];
    yandex.aiProbes = [{ query: "AI Café", status: "checked", targetFound: true, targetUsed: true }];

    const published = buildPublishedWgdReport(duplicates);
    const html = renderWgdHtml(duplicates);

    expect(published.options.keywords).toEqual(["Café SEO"]);
    expect(published.options.aiQueries).toEqual(["AI Café"]);
    expect(published.assessment.components.yandex.requested).toBe(1);
    expect(published.assessment.components.alice.requested).toBe(1);
    expect(html.match(/<td>Café SEO<\/td>/g)).toHaveLength(1);
    expect(html.match(/<td>AI Café<\/td>/g)).toHaveLength(1);
    expect(html).toContain("<strong>1 / 1</strong>");
  });

  test("uses the first structurally valid observation for duplicate canonical queries everywhere", () => {
    const conflicting = payload();
    conflicting.options.keywords = ["  Café SEO  "];
    conflicting.options.aiQueries = ["  AI Café  "];
    const yandex = conflicting.yandex as Record<string, unknown>;
    yandex.serpChecks = [
      {
        query: "CAFE\u0301 SEO", searchEngine: "yandex", provider: "yandex_search_api",
        targetDomain: "example.com", found: true, position: 0.5, checkedDepth: 0.5,
        device: "desktop", checkedAt: "2026-09-01T10:20:00.000Z",
      },
      {
        query: "café seo", searchEngine: "yandex", provider: "yandex_search_api",
        targetDomain: "example.com", found: true, position: 2, checkedDepth: 20,
        device: "desktop", checkedAt: "2026-09-01T10:21:00.000Z",
      },
    ];
    yandex.aiProbes = [
      { query: "AI CAFE\u0301", status: "failed", result: "Provider unavailable" },
      { query: "ai café", status: "checked", targetFound: true, targetUsed: true },
    ];
    yandex.aiSampleVisibility = { used: 1, checked: 1, rate: 1 };

    const published = buildPublishedWgdReport(conflicting);
    const html = renderWgdHtml(conflicting);

    expect(published.yandex?.serpChecks).toHaveLength(1);
    expect(published.yandex?.serpChecks[0]).toMatchObject({ query: "Café SEO", found: true });
    expect(published.yandex?.serpChecks[0]).not.toHaveProperty("position");
    expect(published.yandex?.aiProbes).toHaveLength(1);
    expect(published.yandex?.aiProbes[0]).toMatchObject({ query: "AI Café", status: "failed" });
    expect(published.yandex?.aiSampleVisibility).toEqual({ used: 0, checked: 0, rate: null });
    expect(published.assessment.components.yandex.collected).toBe(0);
    expect(published.assessment.components.alice.collected).toBe(0);
    expect(html.match(/<td>Café SEO<\/td>/g)).toHaveLength(1);
    expect(html.match(/<td>AI Café<\/td>/g)).toHaveLength(1);
    expect(html).not.toContain("Provider unavailable");
    expect(html).toContain("Проверка не выполнена");
  });
});
