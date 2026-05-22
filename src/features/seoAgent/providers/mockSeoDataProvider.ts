import type {
  SeoCompetitorGap,
  SeoDataProvider,
  SeoDomainOverview,
  SeoKeywordOpportunity,
  SeoProviderInput,
  SeoUrlOpportunity,
} from "./seoDataProvider";
import { normalizeProviderDomain, urlForDomain } from "./seoDataProvider";

export class MockSeoDataProvider implements SeoDataProvider {
  async getDomainOverview(input: SeoProviderInput): Promise<SeoDomainOverview> {
    const domain = normalizeProviderDomain(input.domain);

    if (domain === "annavisas.com") {
      return {
        domain,
        market: input.market,
        visibilitySummary:
          "Mock SEO audit for Anna Visas found visa refusal, 214(b), FIFA 2026, and country-specific application pages as the strongest draft-task areas.",
        trend: "flat",
        notes: ["Mock provider", "Stage 02 provider contract"],
        visibilityIndex: 3.4,
        keywordCount: 18,
      };
    }

    if (domain === "amalphis.at") {
      return {
        domain,
        market: input.market,
        visibilitySummary:
          "Mock SEO audit for Amalphis found product, collection, wholesale, and local Austrian/German search-intent opportunities.",
        trend: "flat",
        notes: ["Mock provider", "Stage 02 provider contract"],
        visibilityIndex: 2.1,
        keywordCount: 11,
      };
    }

    return {
      domain,
      market: input.market,
      visibilitySummary:
        "Mock SEO audit used the default unknown-domain profile. Add a richer SEO config before Stage 03 SISTRIX integration.",
      trend: "unknown",
      notes: ["Mock provider", "Unknown domain fallback"],
    };
  }

  async getKeywordOpportunities(input: SeoProviderInput): Promise<SeoKeywordOpportunity[]> {
    const domain = normalizeProviderDomain(input.domain);

    if (domain === "annavisas.com") {
      return [
        {
          keyword: "FIFA 2026 visa USA",
          market: input.market,
          language: input.language,
          currentUrl: urlForDomain(domain, "/fifa-2026-us-visa/"),
          opportunityType: "keyword_quick_win",
          impact: "high",
          effort: "low",
          urgency: "high",
          suggestedEscalation: "fire",
          requiresOwnerApproval: true,
          reasoning:
            "The topic is seasonal, commercially relevant, and can be drafted before real SISTRIX data is connected.",
        },
      ];
    }

    if (domain === "amalphis.at") {
      return [
        {
          keyword: "griechisches Olivenöl",
          market: input.market,
          language: input.language,
          currentUrl: urlForDomain(domain, "/collections/all"),
          opportunityType: "content_optimization",
          impact: "medium",
          effort: "low",
          urgency: "low",
          reasoning:
            "Collection pages often rank for commercial category queries and can be improved without changing product logic.",
        },
      ];
    }

    return [];
  }

  async getCompetitorGaps(input: SeoProviderInput): Promise<SeoCompetitorGap[]> {
    const domain = normalizeProviderDomain(input.domain);

    if (domain === "annavisas.com") {
      return [
        {
          competitorDomain: input.competitors[0] || "example-visa-competitor.com",
          keyword: "US visa refusal help",
          competitorUrl: "https://example-visa-competitor.com/us-visa-refusal/",
          ourUrl: urlForDomain(domain, "/us-visa-refusal-214b/"),
          competitorVisibilityIndex: 4.8,
          overlapScore: 74,
          gapType: "content_gap",
          impact: "high",
          effort: "medium",
          urgency: "medium",
          reasoning:
            "Refusal intent is high urgency and matches Anna Visas' advisory expertise. A focused hub can capture informational and conversion traffic.",
        },
      ];
    }

    if (domain === "amalphis.at") {
      return [
        {
          competitorDomain: input.competitors[0] || "example-olive-oil-shop.at",
          keyword: "Olivenöl Großhandel Österreich",
          competitorUrl: "https://example-olive-oil-shop.at/wholesale",
          ourUrl: urlForDomain(domain, "/pages/wholesale"),
          competitorVisibilityIndex: 3.3,
          overlapScore: 61,
          gapType: "content_gap",
          impact: "high",
          effort: "medium",
          urgency: "medium",
          reasoning:
            "B2B intent is distinct from product-page intent and deserves a dedicated draft before task approval.",
        },
      ];
    }

    return [];
  }

  async getUrlOpportunities(input: SeoProviderInput): Promise<SeoUrlOpportunity[]> {
    const domain = normalizeProviderDomain(input.domain);

    if (domain === "annavisas.com") {
      return [
        {
          url: urlForDomain(domain, "/us-visa-refusal-214b/"),
          issueType: "content_gap",
          targetKeywords: ["214(b) refusal", "US visa refusal help", "visa denied next steps"],
          recommendedAction:
            "Draft a consolidated refusal recovery page with FAQs, proof examples, and internal links from visa service pages.",
          impact: "high",
          effort: "medium",
          urgency: "medium",
          reasoning:
            "Refusal intent is high urgency and matches Anna Visas' advisory expertise. A focused hub can capture informational and conversion traffic.",
        },
      ];
    }

    if (domain === "amalphis.at") {
      return [
        {
          url: urlForDomain(domain, "/pages/wholesale"),
          issueType: "content_gap",
          targetKeywords: ["Olivenöl Großhandel Österreich", "olive oil wholesale Austria", "B2B Olivenöl"],
          recommendedAction:
            "Draft a wholesale page with minimum order info, restaurant use cases, and inquiry CTA.",
          impact: "high",
          effort: "medium",
          urgency: "medium",
          reasoning:
            "B2B intent is distinct from product-page intent and deserves a dedicated draft before task approval.",
        },
        {
          url: urlForDomain(domain, "/collections/all"),
          issueType: "content_optimization",
          targetKeywords: ["griechisches Olivenöl", "Olivenöl kaufen Österreich", "extra natives Olivenöl"],
          recommendedAction:
            "Draft collection intro copy, internal links to flagship products, and FAQ snippets.",
          impact: "medium",
          effort: "low",
          urgency: "low",
          reasoning:
            "Collection pages often rank for commercial category queries and can be improved without changing product logic.",
        },
      ];
    }

    return [
      {
        url: urlForDomain(domain, "/"),
        issueType: "technical_issue",
        targetKeywords: [],
        recommendedAction:
          "Draft a technical checklist task covering indexability, titles, canonical tags, sitemap, and key template metadata.",
        impact: "medium",
        effort: "low",
        urgency: "low",
        reasoning:
          "Unknown domains need a safe first-pass task draft before deeper keyword or competitor analysis.",
      },
    ];
  }
}
