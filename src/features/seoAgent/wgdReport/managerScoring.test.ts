import { describe, expect, test } from "vitest";
import type {
  CrawlEvidence,
  LighthouseEvidence,
  PageEvidence,
  SourceCoverage,
  WgdFinding,
  WgdReportOptions,
} from "./types";
import type { YandexEvidence } from "./yandexEvidence";
import {
  calculateWgdReportAssessment,
  type WgdReportScoringInput,
} from "./managerScoring";

const HOME = "https://example.com/";
const ABOUT = "https://example.com/about";
const LAB_PROFILE = {
  measurementType: "lab" as const,
  fieldData: { source: "CrUX" as const, state: "not_collected" as const },
};

function options(overrides: Partial<WgdReportOptions> = {}): WgdReportOptions {
  return {
    url: HOME,
    domain: "example.com",
    market: "RU",
    language: "ru",
    region: "ru",
    crawlLimit: 20,
    lighthousePageLimit: 1,
    keywords: ["k1", "k2", "k3"],
    aiQueries: ["a1", "a2", "a3"],
    priorityUrls: [],
    outDir: "/tmp/report",
    sources: { dataForSeo: "not_applicable" },
    ...overrides,
  };
}

function page(url: string, overrides: Partial<PageEvidence> = {}): PageEvidence {
  return {
    requestedUrl: url,
    finalUrl: url,
    status: 200,
    contentType: "text/html; charset=utf-8",
    title: `Title ${url}`,
    description: `Description ${url}`,
    canonical: url,
    headings: { h1: [`Heading ${url}`], h2: [] },
    internalLinks: [],
    indexable: true,
    signalConflicts: [],
    inboundInternalLinks: 1,
    orphanCandidate: false,
    ...overrides,
  };
}

function crawlFor(
  pages: PageEvidence[],
  overrides: Partial<CrawlEvidence> = {}
): CrawlEvidence {
  return {
    attemptedUrlCount: pages.length,
    eligibleDiscoveredCount: pages.length,
    droppedEligibleCount: 0,
    truncated: false,
    pages,
    robots: {
      url: "https://example.com/robots.txt",
      status: 200,
      sitemapUrls: ["https://example.com/sitemap.xml"],
      access: {
        state: "measured",
        userAgent: "YandexBot",
        checkedUrlCount: pages.length,
        blockedUrls: [],
      },
    },
    sitemapCandidates: [{
      url: "https://example.com/sitemap.xml",
      source: "robots",
      status: 200,
      urls: pages.map((item) => item.finalUrl),
    }],
    discoveredUrls: pages.map((item) => item.requestedUrl),
    excludedUrls: [],
    brokenUrls: [],
    redirectChains: [],
    duplicateTitles: {},
    duplicateDescriptions: {},
    limitations: [],
    ...overrides,
  };
}

function lighthouse(
  url: string,
  device: "mobile" | "desktop",
  scores: Partial<Record<"performance" | "accessibility" | "best-practices" | "seo", number | null>>,
  overrides: Partial<LighthouseEvidence> = {}
): LighthouseEvidence {
  return {
    ...LAB_PROFILE,
    url,
    requestedUrl: url,
    finalUrl: url,
    device,
    status: "success",
    categoryScores: scores,
    ...overrides,
  };
}

function pair(
  url: string,
  mobile: [number, number, number] = [100, 100, 100],
  desktop: [number, number, number] = [100, 100, 100]
): LighthouseEvidence[] {
  return [
    lighthouse(url, "mobile", {
      performance: mobile[0], accessibility: mobile[1], "best-practices": mobile[2], seo: 0,
    }),
    lighthouse(url, "desktop", {
      performance: desktop[0], accessibility: desktop[1], "best-practices": desktop[2], seo: 100,
    }),
  ];
}

function rankCheck(
  query: string,
  position: number | undefined,
  checkedDepth: number | undefined = 20
): YandexEvidence["serpChecks"][number] {
  return {
    query,
    searchEngine: "yandex",
    provider: "yandex_search_api",
    targetDomain: "example.com",
    found: position !== undefined,
    ...(position !== undefined ? { position, matchedUrl: HOME } : {}),
    ...(checkedDepth !== undefined ? { checkedDepth } : {}),
    device: "desktop",
    checkedAt: "2026-09-01T10:00:00.000Z",
  };
}

function aiProbe(query: string, targetUsed: boolean, status: "checked" | "failed" = "checked") {
  return {
    channel: "Yandex Search API generative response",
    status,
    query,
    result: status === "checked" ? "Checked answer" : "Failed probe",
    sources: [],
    sourceDetails: [],
    usedSources: [],
    targetFound: targetUsed,
    targetUsed,
    sourcePosition: null,
    usedSourcePosition: null,
  } as YandexEvidence["aiProbes"][number];
}

function yandex(
  serpChecks: YandexEvidence["serpChecks"],
  aiProbes: YandexEvidence["aiProbes"]
): YandexEvidence {
  const checked = aiProbes.filter((item) => item.status === "checked");
  const used = checked.filter((item) => item.targetUsed).length;
  return {
    serpChecks,
    serpStatus: {
      state: "connected",
      message: "Provider message must not affect scores",
      checkedAt: "2026-09-01T10:00:00.000Z",
    },
    aiProbes,
    aiSampleVisibility: {
      used,
      checked: checked.length,
      rate: checked.length ? used / checked.length : null,
    },
    manualQueries: [],
    limitations: [],
  };
}

function perfectInput(): WgdReportScoringInput {
  const pages = [
    page(HOME, { internalLinks: [ABOUT] }),
    page(ABOUT, { internalLinks: [HOME] }),
  ];
  return {
    options: options(),
    crawl: crawlFor(pages),
    pages,
    lighthouse: pair(HOME),
    yandex: yandex(
      [rankCheck("k1", 1), rankCheck("k2", 2), rankCheck("k3", 3)],
      [aiProbe("a1", true), aiProbe("a2", true), aiProbe("a3", true)]
    ),
    sources: [],
    findings: [],
  };
}

function componentScores(
  yandexScore: 0 | 100,
  lighthouseScore: 0 | 100,
  aliceScore: 0 | 100
): WgdReportScoringInput {
  const input = perfectInput();
  input.yandex = yandex(
    ["k1", "k2", "k3"].map((query) => rankCheck(query, yandexScore ? 1 : undefined)),
    ["a1", "a2", "a3"].map((query) => aiProbe(query, aliceScore === 100))
  );
  input.lighthouse = pair(
    HOME,
    [lighthouseScore, lighthouseScore, lighthouseScore],
    [lighthouseScore, lighthouseScore, lighthouseScore]
  );
  return input;
}

describe("calculateWgdReportAssessment technical scoring", () => {
  test("defines all 14 technical atomic rules with their exact weights", () => {
    const assessment = calculateWgdReportAssessment(perfectInput());

    expect(assessment.components.technical.rules.map(({ id, weight }) => [id, weight])).toEqual([
      ["http_success", 20], ["indexability", 25], ["robots_access", 5], ["sitemap", 10],
      ["canonical", 12], ["signal_conflicts", 3], ["title_present", 3], ["title_unique", 2],
      ["description_present", 3], ["description_unique", 2], ["h1_present", 5],
      ["broken_internal_links", 5], ["redirect_chains", 3], ["orphan_pages", 2],
    ]);
    expect(assessment.components.technical.score).toBe(100);
  });

  test("maps every technical rule to structured applicability, measurement, and pass counts", () => {
    const dropped = "https://example.com/dropped";
    const broken = ABOUT;
    const failed = page("https://example.com/failed", {
      status: 0,
      contentType: undefined,
      error: "timeout",
      title: undefined,
      description: undefined,
      canonical: undefined,
      headings: undefined,
      internalLinks: undefined,
      indexable: false,
      inboundInternalLinks: undefined,
      orphanCandidate: undefined,
    });
    const pages = [
      page(HOME, {
        title: "Duplicate",
        description: "Unique",
        internalLinks: [broken, dropped],
      }),
      page(ABOUT, {
        title: "Duplicate",
        description: undefined,
        canonical: undefined,
        headings: { h1: [], h2: [] },
        internalLinks: [HOME],
        indexable: false,
        metaRobots: "noindex",
        robots: "noindex",
        signalConflicts: [{ code: "robots_follow_disagreement", category: "robots" }],
        inboundInternalLinks: 0,
        orphanCandidate: true,
      }),
      failed,
    ];
    const crawl = crawlFor(pages, {
      attemptedUrlCount: 3,
      eligibleDiscoveredCount: 4,
      droppedEligibleCount: 1,
      truncated: true,
      robots: {
        url: "https://example.com/robots.txt",
        status: 200,
        sitemapUrls: [],
        access: {
          state: "measured",
          userAgent: "YandexBot",
          checkedUrlCount: 3,
          blockedUrls: [ABOUT],
        },
      },
      sitemapCandidates: [{
        url: "https://example.com/sitemap.xml",
        source: "common",
        status: 404,
        urls: [],
      }],
      discoveredUrls: [HOME, ABOUT, failed.requestedUrl],
      brokenUrls: [broken],
      redirectChains: [{ requestedUrl: HOME, finalUrl: HOME, urls: [HOME, `${HOME}hop`, HOME] }],
      duplicateTitles: { Duplicate: [HOME, ABOUT] },
      duplicateDescriptions: {},
    });
    const rules = Object.fromEntries(
      calculateWgdReportAssessment({ options: options(), crawl, pages }).components.technical.rules
        .map((rule) => [rule.id, rule])
    );

    expect(rules).toMatchObject({
      http_success: { applicableCount: 3, measuredCount: 2, passedCount: 2 },
      indexability: { applicableCount: 2, measuredCount: 2, passedCount: 1 },
      robots_access: { applicableCount: 1, measuredCount: 1, passedCount: 0 },
      sitemap: { applicableCount: 1, measuredCount: 1, passedCount: 0 },
      canonical: { applicableCount: 1, measuredCount: 1, passedCount: 1 },
      signal_conflicts: { applicableCount: 2, measuredCount: 2, passedCount: 1 },
      title_present: { applicableCount: 2, measuredCount: 2, passedCount: 2 },
      title_unique: { applicableCount: 2, measuredCount: 2, passedCount: 0 },
      description_present: { applicableCount: 2, measuredCount: 2, passedCount: 1 },
      description_unique: { applicableCount: 1, measuredCount: 1, passedCount: 1 },
      h1_present: { applicableCount: 2, measuredCount: 2, passedCount: 1 },
      broken_internal_links: { applicableCount: 3, measuredCount: 2, passedCount: 1 },
      redirect_chains: { applicableCount: 3, measuredCount: 2, passedCount: 1 },
      orphan_pages: { applicableCount: 1, measuredCount: 1, passedCount: 0 },
    });
    expect(rules.http_success).toMatchObject({ ruleCoverage: 2 / 3, passRate: 1 });
    expect(rules.broken_internal_links).toMatchObject({ ruleCoverage: 2 / 3, passRate: 1 / 2 });
  });

  test("keeps a timed-out internal target unmeasured instead of scoring it as broken", () => {
    const slowUrl = "https://example.com/slow";
    const home = page(HOME, { internalLinks: [slowUrl] });
    const timedOut = page(slowUrl, {
      status: 0,
      contentType: undefined,
      error: "timeout",
      indexable: false,
      signalConflicts: [],
    });
    const crawl = crawlFor([home, timedOut], {
      discoveredUrls: [HOME, slowUrl],
      brokenUrls: [slowUrl],
    });
    const technical = calculateWgdReportAssessment({
      options: options(), crawl, pages: [home, timedOut],
    }).components.technical;
    const brokenLinks = technical.rules.find((rule) => rule.id === "broken_internal_links");

    expect(brokenLinks).toMatchObject({
      applicableCount: 1,
      measuredCount: 0,
      passedCount: 0,
      ruleCoverage: 0,
      passRate: null,
    });
    expect(technical.score).toBe(100);
  });

  test.each([
    [
      "an unavailable child of a valid sitemap index",
      { url: "https://example.com/pages.xml", source: "sitemap" as const, urls: [], error: "timeout" },
      { measuredCount: 0, passedCount: 0, ruleCoverage: 0, passRate: null },
    ],
    [
      "a conclusively missing child of a valid sitemap index",
      { url: "https://example.com/pages.xml", source: "sitemap" as const, status: 404, urls: [] },
      { measuredCount: 1, passedCount: 0, ruleCoverage: 1, passRate: 0 },
    ],
  ])("does not treat sitemap-index child locations as site page evidence for %s", (_name, child, expected) => {
    const home = page(HOME);
    const crawl = crawlFor([home], {
      sitemapCandidates: [
        {
          url: "https://example.com/sitemap-index.xml",
          source: "robots",
          status: 200,
          urls: ["https://example.com/pages.xml"],
          isIndex: true,
        },
        child,
      ],
    });
    const sitemap = calculateWgdReportAssessment({
      options: options(), crawl, pages: [home],
    }).components.technical.rules.find((rule) => rule.id === "sitemap");

    expect(sitemap).toMatchObject({ applicableCount: 1, ...expected });
  });

  test("uses null ratios for zero applicability and zero coverage for applicable but unmeasured rules", () => {
    const input = perfectInput();
    input.pages = [input.pages![0]];
    input.crawl = crawlFor(input.pages, {
      robots: {
        url: "https://example.com/robots.txt",
        sitemapUrls: [],
        access: { state: "unavailable", userAgent: "YandexBot", checkedUrlCount: 0, blockedUrls: [] },
        error: "timeout",
      },
      sitemapCandidates: [{
        url: "https://example.com/sitemap.xml", source: "common", urls: [], error: "timeout",
      }],
    });

    const rules = Object.fromEntries(
      calculateWgdReportAssessment(input).components.technical.rules.map((rule) => [rule.id, rule])
    );
    expect(rules.orphan_pages).toMatchObject({
      applicableCount: 0, measuredCount: 0, passedCount: 0, ruleCoverage: null, passRate: null,
    });
    expect(rules.sitemap).toMatchObject({
      applicableCount: 1, measuredCount: 0, passedCount: 0, ruleCoverage: 0, passRate: null,
    });
    expect(rules.robots_access).toMatchObject({
      applicableCount: 1, measuredCount: 0, passedCount: 0, ruleCoverage: 0, passRate: null,
    });
  });

  test("multiplies atomic coverage by exact crawl completion", () => {
    const input = perfectInput();
    input.pages = [{ ...input.pages![0], internalLinks: [] }];
    input.crawl = crawlFor(input.pages, {
      attemptedUrlCount: 1,
      eligibleDiscoveredCount: 2,
      droppedEligibleCount: 1,
      truncated: true,
    });

    const technical = calculateWgdReportAssessment(input).components.technical;
    expect(technical.crawlCompletion).toBe(0.5);
    expect(technical.atomicRuleCoverage).toBe(1);
    expect(technical.collectionCoverage).toBe(0.5);
    expect(technical.scoringCoverage).toBe(0.5);
  });

  test("keeps technical scoring coverage at zero until the homepage is parsed as HTML", () => {
    const about = page(ABOUT);
    const crawl = crawlFor([about]);
    const technical = calculateWgdReportAssessment({
      options: options(), crawl, pages: [about],
    }).components.technical;

    expect(technical.collectionCoverage).toBeGreaterThan(0);
    expect(technical.scoringCoverage).toBe(0);
    expect(technical.effectiveWeight).toBe(0);
  });

  test("does not score top-level pages that are absent from otherwise valid crawl page evidence", () => {
    const forgedHomepage = page(HOME);
    const crawl = crawlFor([], {
      attemptedUrlCount: 1,
      eligibleDiscoveredCount: 1,
      robots: {
        url: "https://example.com/robots.txt",
        status: 200,
        sitemapUrls: [],
        access: { state: "measured", userAgent: "YandexBot", checkedUrlCount: 1, blockedUrls: [] },
      },
      discoveredUrls: [HOME],
    });

    const assessment = calculateWgdReportAssessment({
      options: options(), crawl, pages: [forgedHomepage],
    });

    expect(assessment.components.technical).toEqual(expect.objectContaining({
      score: null, scoringCoverage: 0, effectiveWeight: 0,
    }));
    expect(assessment.pages).toEqual([]);
  });
});

describe("calculateWgdReportAssessment external component scoring", () => {
  test("uses exact Yandex position bands and excludes checks without sufficient depth provenance", () => {
    const keywords = ["top3", "top10", "top20", "missing20", "missing-depth", "shallow-missing"];
    const result = calculateWgdReportAssessment({
      options: options({ keywords }),
      yandex: yandex([
        rankCheck("top3", 3),
        rankCheck("top10", 10),
        rankCheck("top20", 20),
        rankCheck("missing20", undefined, 20),
        { ...rankCheck("missing-depth", 1), checkedDepth: undefined },
        rankCheck("shallow-missing", undefined, 19),
      ], []),
    }).components.yandex;

    expect(result).toMatchObject({
      score: 60,
      collected: 4,
      requested: 6,
      collectionCoverage: 4 / 6,
      scoringCoverage: 4 / 6,
    });
  });

  test("requires at least three Yandex queries and 60 percent coverage", () => {
    const threeOfFive = calculateWgdReportAssessment({
      options: options({ keywords: ["1", "2", "3", "4", "5"] }),
      yandex: yandex([rankCheck("1", 1), rankCheck("2", 1), rankCheck("3", 1)], []),
    }).components.yandex;
    const twoOfThree = calculateWgdReportAssessment({
      options: options({ keywords: ["1", "2", "3"] }),
      yandex: yandex([rankCheck("1", 1), rankCheck("2", 1)], []),
    }).components.yandex;
    const threeOfSix = calculateWgdReportAssessment({
      options: options({ keywords: ["1", "2", "3", "4", "5", "6"] }),
      yandex: yandex([rankCheck("1", 1), rankCheck("2", 1), rankCheck("3", 1)], []),
    }).components.yandex;

    expect(threeOfFive.scoringCoverage).toBe(0.6);
    expect(twoOfThree).toMatchObject({ collectionCoverage: 2 / 3, scoringCoverage: 0 });
    expect(threeOfSix).toMatchObject({ collectionCoverage: 0.5, scoringCoverage: 0 });
  });

  test("counts at most one valid Yandex observation for each unique requested query", () => {
    const duplicate = rankCheck("k1", 1);
    const result = calculateWgdReportAssessment({
      options: options(),
      yandex: yandex([duplicate, { ...duplicate }, { ...duplicate }], []),
    }).components.yandex;

    expect(result).toMatchObject({
      collected: 1,
      requested: 3,
      collectionCoverage: 1 / 3,
      scoringCoverage: 0,
    });
  });

  test("does not replace the first unscorable Yandex observation with a later duplicate", () => {
    const first = { ...rankCheck("k1", 1), position: 0.5, checkedDepth: 0.5 };
    const result = calculateWgdReportAssessment({
      options: options(),
      yandex: yandex([first, rankCheck("k1", 1)], []),
    }).components.yandex;

    expect(result).toMatchObject({ collected: 0, requested: 3, scoringCoverage: 0 });
  });

  test("rejects contradictory misses but scores a coherent depth-20 miss", () => {
    const contradictory = {
      ...rankCheck("k1", undefined),
      found: false,
      position: 2,
      matchedUrl: HOME,
    };
    const coherentMiss = rankCheck("k2", undefined, 20);
    const result = calculateWgdReportAssessment({
      options: options({ keywords: ["k1", "k2"] }),
      yandex: yandex([contradictory, coherentMiss], []),
    }).components.yandex;

    expect(result).toMatchObject({
      score: 0, collected: 1, requested: 2, collectionCoverage: 0.5, scoringCoverage: 0,
    });
  });

  test("ignores duplicate and malformed requested Yandex query entries", () => {
    const result = calculateWgdReportAssessment({
      options: options({ keywords: ["k1", "k1", "", null] as unknown as string[] }),
      yandex: yandex([rankCheck("k1", 1)], []),
    }).components.yandex;

    expect(result).toMatchObject({ collected: 1, requested: 1, collectionCoverage: 1, scoringCoverage: 0 });
  });

  test("scores only complete Lighthouse pairs with the exact formula", () => {
    const incompleteUrl = "https://example.com/incomplete";
    const failedUrl = "https://example.com/failed";
    const result = calculateWgdReportAssessment({
      options: options(),
      lighthouse: [
        ...pair(HOME, [50, 90, 100], [80, 70, 60]),
        lighthouse(incompleteUrl, "mobile", {
          performance: 100, accessibility: 100, "best-practices": 100,
        }),
        lighthouse(incompleteUrl, "desktop", { performance: 100, accessibility: 100 }),
        lighthouse(failedUrl, "mobile", {
          performance: 100, accessibility: 100, "best-practices": 100,
        }),
        lighthouse(failedUrl, "desktop", {
          performance: 100, accessibility: 100, "best-practices": 100,
        }, { status: "failed", error: "timeout" }),
      ],
    }).components.lighthouse;

    expect(result).toMatchObject({
      score: 65,
      collected: 1,
      requested: 3,
      collectionCoverage: 1 / 3,
      scoringCoverage: 1 / 3,
      worstMobileUrl: HOME,
    });
  });

  test("rejects fractional rank provenance and out-of-range Lighthouse category scores", () => {
    const result = calculateWgdReportAssessment({
      options: options(),
      yandex: yandex(
        ["k1", "k2", "k3"].map((query) => ({
          ...rankCheck(query, 1), position: 0.5, checkedDepth: 0.5,
        })),
        []
      ),
      lighthouse: pair(HOME, [1000, 1000, 1000], [1000, 1000, 1000]),
    });

    expect(result.components.yandex).toEqual(expect.objectContaining({
      score: null, collected: 0, scoringCoverage: 0,
    }));
    expect(result.components.lighthouse).toEqual(expect.objectContaining({
      score: null, collected: 0, scoringCoverage: 0,
    }));
  });

  test("rejects a Lighthouse profile when any nested category score is outside its domain", () => {
    const invalidPair = pair(HOME);
    invalidPair[0]!.categoryScores = {
      ...invalidPair[0]!.categoryScores,
      seo: 999,
    };

    const assessment = calculateWgdReportAssessment({
      options: options(),
      pages: [page(HOME)],
      lighthouse: invalidPair,
    });

    expect(assessment.components.lighthouse).toEqual(expect.objectContaining({
      score: null, collected: 0, scoringCoverage: 0,
    }));
    expect(assessment.pages[0]?.groups.lighthouse).toEqual(expect.objectContaining({
      measuredWeight: 0, earnedPoints: 0, score: null,
    }));
  });

  test("breaks equal worst-mobile Lighthouse scores by requested URL", () => {
    const a = "https://example.com/a";
    const b = "https://example.com/b";
    const result = calculateWgdReportAssessment({
      options: options(),
      lighthouse: [
        ...pair(b, [40, 100, 100], [100, 100, 100]),
        ...pair(a, [40, 100, 100], [100, 100, 100]),
      ],
    }).components.lighthouse;

    expect(result.worstMobileUrl).toBe(a);
  });

  test("applies the Alice three-query and 60 percent gate and handles a zero denominator", () => {
    const scored = calculateWgdReportAssessment({
      options: options({ aiQueries: ["1", "2", "3", "4", "5"] }),
      yandex: yandex([], [aiProbe("1", true), aiProbe("2", true), aiProbe("3", false)]),
    }).components.alice;
    const empty = calculateWgdReportAssessment({
      options: options({ aiQueries: [] }),
      yandex: yandex([], []),
    }).components.alice;

    expect(scored).toMatchObject({
      score: 67, collected: 3, requested: 5, collectionCoverage: 0.6, scoringCoverage: 0.6,
    });
    expect(empty).toMatchObject({
      score: null, collected: 0, requested: 0, collectionCoverage: 0, scoringCoverage: 0,
    });
  });

  test("counts at most one valid Alice observation for each unique requested query", () => {
    const duplicate = aiProbe("a1", true);
    const result = calculateWgdReportAssessment({
      options: options(),
      yandex: yandex([], [duplicate, { ...duplicate }, { ...duplicate }]),
    }).components.alice;

    expect(result).toMatchObject({
      collected: 1,
      requested: 3,
      collectionCoverage: 1 / 3,
      scoringCoverage: 0,
    });
  });

  test("does not replace the first unavailable Alice observation with a later duplicate", () => {
    const first = { ...aiProbe("a1", false), status: "failed" as const };
    const result = calculateWgdReportAssessment({
      options: options(),
      yandex: yandex([], [first, aiProbe("a1", true)]),
    }).components.alice;

    expect(result).toMatchObject({ collected: 0, requested: 3, scoringCoverage: 0 });
  });

  test("ignores duplicate and malformed requested Alice query entries", () => {
    const result = calculateWgdReportAssessment({
      options: options({ aiQueries: ["a1", "a1", "", null] as unknown as string[] }),
      yandex: yandex([], [aiProbe("a1", true)]),
    }).components.alice;

    expect(result).toMatchObject({ collected: 1, requested: 1, collectionCoverage: 1, scoringCoverage: 0 });
  });

  test("ignores owner-access gaps, findings prose, and Lighthouse SEO scores", () => {
    const baselineInput = perfectInput();
    const baseline = calculateWgdReportAssessment(baselineInput);
    const sources: SourceCoverage[] = [{
      id: "yandex_webmaster",
      state: "owner_access_required",
      message: "English owner error must not be parsed",
    }];
    const findings: WgdFinding[] = [{
      code: "arbitrary",
      severity: "critical",
      evidence: "English evidence claims the score is zero",
      source: "test",
      confidence: "high",
      action: "English action claims a penalty",
      expectedEffect: "None",
      acceptanceCriterion: "None",
      verification: "None",
    }];
    const lighthouseWithOppositeSeo = baselineInput.lighthouse!.map((item) => ({
      ...item,
      categoryScores: { ...item.categoryScores, seo: item.device === "mobile" ? 100 : 0 },
    }));

    expect(calculateWgdReportAssessment({
      ...baselineInput,
      lighthouse: lighthouseWithOppositeSeo,
      sources,
      findings,
    })).toEqual(baseline);
  });
});

describe("calculateWgdReportAssessment overall scoring", () => {
  test("uses exact 39, 40, 60, and 80 status boundaries", () => {
    const criticalInput = componentScores(100, 100, 100);
    const criticalHome = { ...criticalInput.pages![0], indexable: false, robots: "noindex", metaRobots: "noindex" };
    criticalInput.pages = [criticalHome, criticalInput.pages![1]];
    criticalInput.crawl = crawlFor(criticalInput.pages);

    const critical = calculateWgdReportAssessment(criticalInput);
    const highRisk = calculateWgdReportAssessment(componentScores(0, 0, 0));
    const needsImprovement = calculateWgdReportAssessment(componentScores(0, 100, 0));
    const good = calculateWgdReportAssessment(componentScores(100, 0, 100));

    expect(critical).toMatchObject({ displayScore: 39, status: "critical" });
    expect(highRisk).toMatchObject({ displayScore: 40, status: "high_risk" });
    expect(needsImprovement).toMatchObject({ displayScore: 60, status: "needs_improvement" });
    expect(good).toMatchObject({ displayScore: 80, status: "good" });
  });

  test("uses the exact 80 and 60 completeness thresholds", () => {
    const scoredInput = perfectInput();
    scoredInput.lighthouse = [];
    const scored = calculateWgdReportAssessment(scoredInput);

    const preliminaryInput = perfectInput();
    preliminaryInput.crawl = undefined;
    preliminaryInput.pages = [];
    const preliminary = calculateWgdReportAssessment(preliminaryInput);

    const insufficientInput = { ...preliminaryInput, options: options({ aiQueries: [] }) };
    insufficientInput.yandex = yandex(
      [rankCheck("k1", 1), rankCheck("k2", 1), rankCheck("k3", 1)],
      []
    );
    const insufficient = calculateWgdReportAssessment(insufficientInput);

    expect(scored).toMatchObject({
      completeness: 80, state: "scored", displayScore: 100, status: "good",
    });
    expect(preliminary).toMatchObject({
      completeness: 60, state: "preliminary", displayScore: 100, status: null,
    });
    expect(insufficient).toMatchObject({
      completeness: 45, state: "insufficient_data", displayScore: null, status: null,
    });
  });

  test.each([
    ["homepage", [
      page(HOME, { indexable: false, robots: "noindex", metaRobots: "noindex", internalLinks: [ABOUT] }),
      page(ABOUT, { internalLinks: [HOME] }),
    ]],
    ["majority", [
      page(HOME, { internalLinks: [ABOUT] }),
      page(ABOUT, { indexable: false, robots: "noindex", metaRobots: "noindex", internalLinks: [HOME] }),
      page("https://example.com/third", {
        indexable: false,
        robots: "noindex",
        metaRobots: "noindex",
        internalLinks: [HOME],
      }),
    ]],
  ])("caps the site at 39 when %s indexability is blocked", (_name, pages) => {
    const input = perfectInput();
    input.pages = pages as PageEvidence[];
    input.crawl = crawlFor(input.pages);

    expect(calculateWgdReportAssessment(input)).toMatchObject({
      displayScore: 39,
      indexabilityCapApplied: true,
      status: "critical",
    });
  });
});

describe("calculateWgdReportAssessment page scoring", () => {
  test("redistributes an unavailable Lighthouse group across measured page checks", () => {
    const input = perfectInput();
    input.pages = [page(HOME, { internalLinks: [] })];
    input.crawl = crawlFor(input.pages);
    input.lighthouse = [];
    const withoutLighthouse = calculateWgdReportAssessment(input).pages[0];

    input.lighthouse = pair(HOME, [0, 0, 0], [0, 0, 0]);
    const measuredZeroLighthouse = calculateWgdReportAssessment(input).pages[0];

    expect(withoutLighthouse).toMatchObject({ score: 100, collectionCoverage: 0.85 });
    expect(withoutLighthouse.groups.lighthouse).toMatchObject({ measuredWeight: 0, earnedPoints: 0 });
    expect(measuredZeroLighthouse).toMatchObject({ score: 85, collectionCoverage: 1 });
  });

  test("excludes the page outgoing-link atom when a retained target was dropped before attempt", () => {
    const droppedUrl = "https://example.com/dropped";
    const home = page(HOME, { internalLinks: [droppedUrl] });
    const crawl = crawlFor([home], {
      attemptedUrlCount: 1,
      eligibleDiscoveredCount: 2,
      droppedEligibleCount: 1,
      truncated: true,
      discoveredUrls: [HOME],
    });
    const result = calculateWgdReportAssessment({
      options: options(), crawl, pages: [home], lighthouse: [],
    }).pages[0];

    expect(result).toMatchObject({ score: 100, collectionCoverage: 0.8 });
    expect(result.groups.internal_structure).toMatchObject({
      measuredWeight: 5,
      earnedPoints: 5,
    });
  });

  test("splits title and description points between presence and uniqueness", () => {
    const titleDuplicate = "https://example.com/title-duplicate";
    const descriptionDuplicate = "https://example.com/description-duplicate";
    const pages = [
      page(HOME, { title: "Same title", description: "Same description" }),
      page(titleDuplicate, { title: "Same title" }),
      page(descriptionDuplicate, { description: "Same description" }),
    ];
    const input: WgdReportScoringInput = {
      options: options(),
      crawl: crawlFor(pages, {
        duplicateTitles: { "Same title": [HOME, titleDuplicate] },
        duplicateDescriptions: { "Same description": [HOME, descriptionDuplicate] },
      }),
      pages,
      lighthouse: [],
    };

    const scores = Object.fromEntries(
      calculateWgdReportAssessment(input).pages.map((item) => [item.url, item.score])
    );
    expect(scores).toEqual({
      [HOME]: 91,
      [titleDuplicate]: 95,
      [descriptionDuplicate]: 96,
    });
  });

  test("treats parsed absence as a failed check but missing structured fields as unmeasured", () => {
    const missingTitle = page(HOME, { title: undefined });
    const missingHeadings = page(ABOUT, { headings: undefined });
    const emptyHeadings = page("https://example.com/empty-h1", { headings: { h1: [], h2: [] } });
    const pages = [missingTitle, missingHeadings, emptyHeadings];
    const result = calculateWgdReportAssessment({
      options: options(),
      crawl: crawlFor(pages),
      pages,
      lighthouse: [],
    }).pages;

    expect(result[0]).toMatchObject({ score: 95, collectionCoverage: 0.81 });
    expect(result[1]).toMatchObject({ score: 100, collectionCoverage: 0.78 });
    expect(result[2]).toMatchObject({ score: 92, collectionCoverage: 0.85 });
  });

  test("does not award page checks whose crawl or conflict provenance is unavailable", () => {
    const withoutCrawl = calculateWgdReportAssessment({
      options: options(),
      pages: [page(HOME, { internalLinks: [] })],
      lighthouse: [],
    }).pages[0];
    const missingConflicts = page(HOME, {
      internalLinks: [],
      signalConflicts: undefined as never,
    });
    const withoutConflicts = calculateWgdReportAssessment({
      options: options(),
      crawl: crawlFor([missingConflicts]),
      pages: [missingConflicts],
      lighthouse: [],
    }).pages[0];

    expect(withoutCrawl).toMatchObject({ score: 100, collectionCoverage: 0.775 });
    expect(withoutConflicts).toMatchObject({ score: 100, collectionCoverage: 0.77 });
  });

  test("caps an otherwise strong noindex page at 39", () => {
    const noindex = page(HOME, {
      indexable: false,
      robots: "noindex",
      metaRobots: "noindex",
    });
    const result = calculateWgdReportAssessment({
      options: options(),
      crawl: crawlFor([noindex]),
      pages: [noindex],
      lighthouse: pair(HOME),
    }).pages[0];

    expect(result).toMatchObject({
      score: 39,
      collectionCoverage: 1,
      noindexCapApplied: true,
    });
  });
});
