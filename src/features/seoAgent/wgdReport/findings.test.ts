import { describe, expect, test } from "vitest";
import type { CrawlEvidence, LighthouseEvidence, PageEvidence } from "./types";
import type { YandexEvidence } from "./yandexEvidence";
import { buildWgdFindings } from "./findings";

const LAB_PROFILE = {
  measurementType: "lab" as const,
  fieldData: { source: "CrUX" as const, state: "not_collected" as const },
};

function page(overrides: Partial<PageEvidence> = {}): PageEvidence {
  return {
    requestedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    status: 200,
    title: "Flowers delivered today",
    description: "Welcome to our website",
    headings: { h1: [], h2: [] },
    images: { total: 3, missingAlt: 1 },
    wordCount: 90,
    indexable: false,
    ...overrides,
  };
}

function flowerlifeLikeEvidence() {
  const pages = [page()];
  const crawl: CrawlEvidence = {
    attemptedUrlCount: 1,
    eligibleDiscoveredCount: 2,
    droppedEligibleCount: 1,
    truncated: true,
    pages,
    robots: { url: "https://example.com/robots.txt", status: 200, sitemapUrls: [] },
    sitemapCandidates: [],
    discoveredUrls: ["https://example.com/", "https://example.com/unfetched"],
    excludedUrls: [],
    brokenUrls: ["https://example.com/broken"],
    redirectChains: [],
    duplicateTitles: {},
    duplicateDescriptions: {},
    limitations: ["Crawl stopped at the configured page limit."],
  };
  const lighthouse: LighthouseEvidence[] = [
    { ...LAB_PROFILE, url: "https://example.com/", device: "mobile", status: "success", categoryScores: { accessibility: 72, performance: 55 } },
    { ...LAB_PROFILE, url: "https://example.com/", device: "desktop", status: "success", categoryScores: { accessibility: 90, performance: 88 } },
  ];
  const yandex = {
    serpChecks: [],
    serpStatus: { state: "no_keywords", message: "No keywords", checkedAt: "2026-08-31T10:00:00.000Z" },
    aiProbes: [{
      channel: "Alice", status: "checked", query: "best flowers", result: "checked", sources: [],
      sourceDetails: [], usedSources: [], targetFound: false, targetUsed: false,
      sourcePosition: null, usedSourcePosition: null,
    }],
    aiSampleVisibility: { used: 0, checked: 1, rate: 0 },
    manualQueries: [],
    limitations: ["Alice AI visibility is a controlled sample."],
  } satisfies YandexEvidence;
  return { crawl, pages, lighthouse, yandex };
}

describe("buildWgdFindings", () => {
  test("prioritizes index blocking above metadata and accessibility findings", () => {
    const findings = buildWgdFindings(flowerlifeLikeEvidence());

    expect(findings[0]).toMatchObject({ code: "homepage_noindex", severity: "critical" });
    expect(findings.map((x) => x.code)).toEqual(expect.arrayContaining([
      "missing_sitemap", "missing_h1", "missing_canonical", "generic_description", "alice_ai_not_used",
    ]));
    expect(findings.every((x) => x.evidence && x.verification)).toBe(true);
  });

  test("adds deterministic cross-page rules and keeps heuristic labels explicit", () => {
    const input = flowerlifeLikeEvidence();
    const second = page({
      requestedUrl: "https://example.com/two",
      finalUrl: "https://example.com/two",
      title: "Flowers delivered today",
      description: "Welcome to our website",
      headings: { h1: ["Two"], h2: [] },
      canonical: "https://example.com/two",
      indexable: true,
    });
    input.pages.push(second);
    input.crawl.pages = input.pages;
    input.crawl.duplicateTitles = { "Flowers delivered today": input.pages.map((x) => x.finalUrl) };
    input.crawl.duplicateDescriptions = { "Welcome to our website": input.pages.map((x) => x.finalUrl) };

    const first = buildWgdFindings(input);
    const secondRun = buildWgdFindings(input);
    const codes = first.map((finding) => finding.code);

    expect(secondRun).toEqual(first);
    expect(codes).toEqual(expect.arrayContaining([
      "duplicate_titles", "duplicate_descriptions", "broken_internal_links", "thin_content_heuristic",
      "missing_image_alt", "crawl_truncated", "mobile_desktop_regression",
    ]));
    expect(first.find((x) => x.code === "thin_content_heuristic")?.evidence).toContain("Heuristic");
  });

  test("does not infer crawl truncation from non-HTML discoveries", () => {
    const input = flowerlifeLikeEvidence();
    input.pages = Array.from({ length: 14 }, (_, index) => page({
      requestedUrl: `https://example.com/page-${index + 1}`,
      finalUrl: `https://example.com/page-${index + 1}`,
      headings: { h1: [`Page ${index + 1}`], h2: [] },
      canonical: `https://example.com/page-${index + 1}`,
      indexable: true,
    }));
    input.crawl.pages = input.pages;
    input.crawl.discoveredUrls = [
      ...input.pages.map((item) => item.finalUrl),
      ...Array.from({ length: 7 }, (_, index) => `https://example.com/document-${index + 1}.pdf`),
    ];
    input.crawl.limitations = [];

    expect(buildWgdFindings(input).map((finding) => finding.code)).not.toContain("crawl_truncated");
  });

  test("emits actionable crawl coverage guidance from explicit truncation evidence", () => {
    const input = flowerlifeLikeEvidence();
    input.crawl.limitations = ["Page crawl truncated after 14 URLs."];

    expect(buildWgdFindings(input)).toContainEqual(expect.objectContaining({
      code: "crawl_truncated",
      evidence: expect.stringContaining("Page crawl truncated after 14 URLs."),
      action: expect.stringContaining("targeted follow-up crawl"),
      acceptanceCriterion: expect.stringContaining("explicitly classified as non-HTML or excluded"),
    }));
  });

  test("recognizes an explicit crawl frontier capacity limitation", () => {
    const input = flowerlifeLikeEvidence();
    input.crawl.limitations = ["Crawl frontier capacity limitation."];

    expect(buildWgdFindings(input)).toContainEqual(expect.objectContaining({ code: "crawl_truncated" }));
  });

  test("does not treat a 2xx soft-404 sitemap endpoint as parsed sitemap evidence", () => {
    const input = flowerlifeLikeEvidence();
    input.crawl.sitemapCandidates = [{
      url: "https://example.com/sitemap.xml",
      source: "common",
      status: 200,
      urls: [],
      isIndex: false,
    }];

    expect(buildWgdFindings(input)).toContainEqual(expect.objectContaining({ code: "missing_sitemap" }));
  });

  test("does not accept parsed sitemap locations from an unsuccessful response", () => {
    const input = flowerlifeLikeEvidence();
    input.crawl.sitemapCandidates = [{
      url: "https://example.com/sitemap.xml",
      source: "common",
      status: 500,
      urls: ["https://example.com/page"],
      isIndex: false,
    }];

    expect(buildWgdFindings(input)).toContainEqual(expect.objectContaining({ code: "missing_sitemap" }));
  });

  test("reports failed page collection without inferring on-page or indexability defects", () => {
    const input = flowerlifeLikeEvidence();
    const failedPage = page({
      status: 0,
      error: "timeout",
      headings: { h1: [], h2: [] },
      canonical: undefined,
      wordCount: 0,
      indexable: false,
    });
    input.pages.splice(0, 1, failedPage);
    input.crawl.pages = input.pages;

    const codes = buildWgdFindings(input).map((finding) => finding.code);

    expect(codes).toContain("page_evidence_collection_failed");
    expect(codes).not.toEqual(expect.arrayContaining([
      "homepage_noindex", "missing_h1", "missing_canonical", "generic_description",
      "thin_content_heuristic", "missing_image_alt",
    ]));
  });

  test("turns observed orphan, directive conflicts, and keyword heuristic gaps into explicit findings", () => {
    const input = flowerlifeLikeEvidence();
    const landing = page({
      requestedUrl: "https://example.com/landing",
      finalUrl: "https://example.com/landing",
      headings: { h1: ["Flower guide"], h2: [] },
      canonical: "https://example.com/different",
      indexable: false,
      discoverySources: ["priority"],
      inboundInternalLinks: 0,
      orphanCandidate: true,
      indexabilityConflicts: [
        "Meta robots and X-Robots-Tag disagree on index/noindex.",
        "Canonical points away from the final page URL.",
      ],
      keywordAlignment: {
        state: "measured",
        method: "normalized_token_presence",
        checkedKeywords: 2,
        matches: [],
        unmatchedKeywords: ["flower delivery", "vienna florist"],
        note: "Bounded lexical heuristic; this is not a relevance judgment.",
      },
    });
    input.pages = [landing];
    input.crawl.pages = input.pages;

    const findings = buildWgdFindings(input);

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "indexability_signal_conflict",
        affectedUrl: landing.finalUrl,
        evidence: expect.stringContaining("Meta robots and X-Robots-Tag"),
      }),
      expect.objectContaining({
        code: "orphan_candidate",
        affectedUrl: landing.finalUrl,
        evidence: expect.stringContaining("observed bounded crawl"),
      }),
      expect.objectContaining({
        code: "keyword_topic_alignment_gap",
        affectedUrl: landing.finalUrl,
        evidence: expect.stringMatching(/Heuristic:.*not a relevance judgment/i),
      }),
    ]));
  });

  test("does not invent keyword alignment findings when keywords are absent or evidence was not measurable", () => {
    const input = flowerlifeLikeEvidence();
    input.pages = [
      page({ keywordAlignment: {
        state: "no_keywords",
        method: "normalized_token_presence",
        checkedKeywords: 0,
        matches: [],
        unmatchedKeywords: [],
        note: "No requested keywords were supplied.",
      } }),
      page({
        requestedUrl: "https://example.com/unmeasured",
        finalUrl: "https://example.com/unmeasured",
        keywordAlignment: {
          state: "not_measured",
          method: "normalized_token_presence",
          checkedKeywords: 1,
          matches: [],
          unmatchedKeywords: ["flowers"],
          note: "No safe title, description, or H1 text was available.",
        },
      }),
    ];
    input.crawl.pages = input.pages;

    expect(buildWgdFindings(input).map((finding) => finding.code)).not.toContain("keyword_topic_alignment_gap");
  });

  test("counts unique accessibility failures from category provenance across device profiles", () => {
    const input = flowerlifeLikeEvidence();
    input.lighthouse = [
      {
        ...LAB_PROFILE,
        url: "https://example.com/",
        device: "mobile",
        status: "success",
        categoryScores: { accessibility: 80 },
        failedAudits: [
          { id: "button-name", categories: ["accessibility"] },
          { id: "color-contrast", categories: ["accessibility"] },
          { id: "heading-order", categories: ["accessibility"] },
          { id: "link-name", categories: ["accessibility"] },
          { id: "image-alt", title: "Image alt text", categories: ["seo"] },
        ],
      },
      {
        ...LAB_PROFILE,
        url: "https://example.com/",
        device: "desktop",
        status: "success",
        categoryScores: { accessibility: 86 },
        failedAudits: [
          { id: "button-name", categories: ["accessibility"] },
          { id: "target-size", categories: ["accessibility"] },
          { id: "aria-hidden-body", title: "ARIA check", categories: ["best-practices"] },
        ],
      },
    ];

    const accessibility = buildWgdFindings(input).find((finding) => finding.code === "accessibility_audits_failed");

    expect(accessibility?.evidence).toBe(
      "5 unique accessibility audits failed across Lighthouse lab profiles: button-name, color-contrast, heading-order, link-name, target-size."
    );
    expect(accessibility?.evidence).not.toContain("image-alt");
    expect(accessibility?.evidence).not.toContain("aria-hidden-body");
  });

  test("pairs Lighthouse profile findings by requested identity, not divergent final paths", () => {
    const input = flowerlifeLikeEvidence();
    input.lighthouse = [
      {
        ...LAB_PROFILE,
        url: "https://example.com/mobile-final",
        requestedUrl: "https://example.com/audit",
        finalUrl: "https://example.com/mobile-final",
        device: "mobile",
        status: "success",
        categoryScores: { performance: 55 },
      },
      {
        ...LAB_PROFILE,
        url: "https://example.com/desktop-final",
        requestedUrl: "https://example.com/audit",
        finalUrl: "https://example.com/desktop-final",
        device: "desktop",
        status: "success",
        categoryScores: { performance: 85 },
      },
    ];

    expect(buildWgdFindings(input)).toContainEqual(expect.objectContaining({
      code: "mobile_desktop_regression",
      affectedUrl: "https://example.com/audit",
    }));
  });

  test("does not derive normal Lighthouse findings from failed unsafe navigation evidence", () => {
    const input = flowerlifeLikeEvidence();
    input.lighthouse = [
      {
        ...LAB_PROFILE,
        url: "https://example.com/audit",
        requestedUrl: "https://example.com/audit",
        finalUrl: "https://other.example/landing",
        device: "mobile",
        status: "failed",
        categoryScores: { performance: 40, accessibility: 20 },
        error: "Lighthouse final navigation left the audited origin",
      },
      {
        ...LAB_PROFILE,
        url: "https://example.com/audit",
        requestedUrl: "https://example.com/audit",
        finalUrl: "https://other.example/landing",
        device: "desktop",
        status: "failed",
        categoryScores: { performance: 90, accessibility: 95 },
        error: "Lighthouse final navigation left the audited origin",
      },
    ];

    const codes = buildWgdFindings(input).map((finding) => finding.code);
    expect(codes).not.toContain("mobile_desktop_regression");
    expect(codes).not.toContain("accessibility_audits_failed");
  });
});
