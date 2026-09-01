import { describe, expect, test } from "vitest";
import type { CrawlEvidence, WgdFinding } from "./types";
import { buildAllManagerFindingGroups, buildManagerFindingGroups } from "./findingGroups";

function finding(overrides: Partial<WgdFinding> & Pick<WgdFinding, "code">): WgdFinding {
  return {
    code: overrides.code,
    severity: "medium",
    evidence: "Structured evidence only.",
    source: "test",
    confidence: "high",
    action: "Fix it.",
    expectedEffect: "A verified improvement.",
    acceptanceCriterion: "It is fixed.",
    verification: "Check it.",
    ...overrides,
  };
}

function crawl(overrides: Partial<CrawlEvidence> = {}): CrawlEvidence {
  return {
    attemptedUrlCount: 2,
    eligibleDiscoveredCount: 2,
    droppedEligibleCount: 0,
    truncated: false,
    pages: [],
    robots: { url: "https://example.com/robots.txt", sitemapUrls: [], access: { state: "measured", userAgent: "YandexBot", checkedUrlCount: 0, blockedUrls: [] } },
    sitemapCandidates: [],
    discoveredUrls: [],
    excludedUrls: [],
    brokenUrls: [],
    redirectChains: [],
    duplicateTitles: {},
    duplicateDescriptions: {},
    limitations: [],
    ...overrides,
  };
}

describe("buildManagerFindingGroups", () => {
  test("orders groups deterministically and takes the maximum severity", () => {
    const groups = buildManagerFindingGroups({
      findings: [
        finding({ code: "missing_h1", severity: "low", affectedUrl: "https://example.com/z" }),
        finding({ code: "missing_h1", severity: "high", affectedUrl: "https://example.com/a" }),
        finding({ code: "homepage_noindex", severity: "critical", affectedUrl: "https://example.com/" }),
        finding({ code: "missing_canonical", severity: "high", affectedUrl: "https://example.com/c" }),
      ],
    });

    expect(groups.map((group) => group.code)).toEqual(["homepage_noindex", "missing_h1", "missing_canonical"]);
    expect(groups.find((group) => group.code === "missing_h1")).toMatchObject({
      severity: "high",
      scope: "page",
      affectedUrls: ["https://example.com/a", "https://example.com/z"],
    });
  });

  test("uses typed crawl maps and lists for affected URLs without duplicates", () => {
    const groups = buildManagerFindingGroups({
      findings: [
        finding({ code: "duplicate_titles", severity: "high", scope: "site" }),
        finding({ code: "broken_internal_links", severity: "high", scope: "site" }),
      ],
      crawl: crawl({
        duplicateTitles: {
          one: ["https://example.com/b", "https://example.com/a"],
          two: ["https://example.com/a", "https://example.com/c"],
        },
        brokenUrls: ["https://example.com/broken", "https://example.com/broken"],
      }),
    });

    expect(groups.find((group) => group.code === "duplicate_titles")?.affectedUrls)
      .toEqual(["https://example.com/a", "https://example.com/b", "https://example.com/c"]);
    expect(groups.find((group) => group.code === "broken_internal_links")?.affectedUrls)
      .toEqual(["https://example.com/broken"]);
    expect(groups.find((group) => group.code === "duplicate_titles")?.scope).toBe("page");
  });

  test("does not treat URLs inside evidence prose as affected URLs", () => {
    const groups = buildManagerFindingGroups({
      findings: [finding({
        code: "missing_h1",
        evidence: "A hostile URL https://attacker.example/only-in-prose must not be displayed.",
      })],
    });

    expect(groups).toEqual([]);
  });

  test("uses catalog scope instead of descriptive legacy finding scope", () => {
    const groups = buildManagerFindingGroups({
      findings: [
        finding({ code: "missing_h1", affectedUrl: "https://example.com/page", scope: "legacy descriptive page scope" }),
        finding({ code: "missing_sitemap" }),
      ],
    });

    expect(groups.find((group) => group.code === "missing_h1")?.scope).toBe("page");
    expect(groups.find((group) => group.code === "missing_sitemap")?.scope).toBe("site");
  });

  test("keeps coverage, owner, Alice, and heuristic observations out of manager problems", () => {
    const groups = buildManagerFindingGroups({
      findings: [
        finding({ code: "owner_access_gap", scope: "owner-source coverage" }),
        finding({ code: "crawl_truncated", scope: "report coverage" }),
        finding({ code: "alice_ai_not_used", scope: "controlled Alice AI sample" }),
        finding({ code: "page_evidence_collection_failed", affectedUrl: "https://example.com/unavailable" }),
        finding({ code: "orphan_candidate", affectedUrl: "https://example.com/candidate" }),
        finding({ code: "generic_description", affectedUrl: "https://example.com/heuristic" }),
        finding({ code: "keyword_topic_alignment_gap", affectedUrl: "https://example.com/keywords" }),
        finding({ code: "thin_content_heuristic", affectedUrl: "https://example.com/thin" }),
      ],
    });

    expect(groups).toEqual([]);
  });

  test("returns no more than five manager groups", () => {
    const groups = buildManagerFindingGroups({
      findings: [
        finding({ code: "homepage_noindex", severity: "critical", affectedUrl: "https://example.com/" }),
        finding({ code: "indexability_signal_conflict", severity: "high", affectedUrl: "https://example.com/conflict" }),
        finding({ code: "missing_sitemap", severity: "high", scope: "site" }),
        finding({ code: "broken_internal_links", severity: "high", affectedUrl: "https://example.com/broken", scope: "site" }),
        finding({ code: "missing_h1", severity: "high", affectedUrl: "https://example.com/h1" }),
        finding({ code: "missing_canonical", severity: "high", affectedUrl: "https://example.com/canonical" }),
        finding({ code: "duplicate_titles", severity: "high", scope: "site" }),
      ],
    });

    expect(groups).toHaveLength(5);
    expect(groups.map((group) => group.code)).toEqual([
      "homepage_noindex", "indexability_signal_conflict", "missing_sitemap", "broken_internal_links", "missing_h1",
    ]);
  });

  test("keeps the complete ordered group set available for non-card manager sections", () => {
    const input = {
      findings: [
        finding({ code: "homepage_noindex", severity: "critical", affectedUrl: "https://example.com/" }),
        finding({ code: "indexability_signal_conflict", severity: "high", affectedUrl: "https://example.com/conflict" }),
        finding({ code: "missing_sitemap", severity: "high", scope: "site" }),
        finding({ code: "broken_internal_links", severity: "high", affectedUrl: "https://example.com/broken", scope: "site" }),
        finding({ code: "missing_h1", severity: "high", affectedUrl: "https://example.com/h1" }),
        finding({ code: "missing_canonical", severity: "high", affectedUrl: "https://example.com/canonical" }),
        finding({ code: "missing_image_alt", severity: "medium", affectedUrl: "https://example.com/image" }),
      ],
    };

    expect(buildManagerFindingGroups(input)).toHaveLength(5);
    expect(buildAllManagerFindingGroups(input).map((group) => group.code)).toEqual([
      "homepage_noindex", "indexability_signal_conflict", "missing_sitemap", "broken_internal_links",
      "missing_h1", "missing_canonical", "missing_image_alt",
    ]);
  });
});
