import type {
  SeoEffort,
  SeoImpact,
  SeoOpportunity,
  SeoPriority,
  SeoQueryIntent,
  SeoSearchConsoleSnapshot,
  SeoUrgency,
} from "./types";

type GscOpportunityEngineInput = {
  domain: string;
  market: string;
  language: string;
  snapshot: SeoSearchConsoleSnapshot;
};

type QueryGroup = {
  key: string;
  title: string;
  queries: string[];
  intent: SeoQueryIntent;
  targetUrl: string | null;
  opportunityType: "content_optimization" | "keyword_quick_win" | "content_gap";
  impact: SeoImpact;
  effort: SeoEffort;
  urgency: SeoUrgency;
  priority: SeoPriority;
  recommendedAction: string;
  reasoning: string;
};

const BRAND_TERMS = ["amalphis"];
const PRODUCT_TERMS = ["divo", "olive oil", "olivenöl", "extra virgin", "5 liter", "5l"];
const B2B_TERMS = ["lebensmittel produktion", "hersteller", "produktion", "direkt vom hersteller", "b2b"];

function normalizeText(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function classifyIntent(query: string): SeoQueryIntent {
  const normalized = normalizeText(query);
  if (!normalized) return "unknown";
  if (normalized.includes("olivenöl 5 liter") || normalized.includes("olive oil 5 liter") || normalized.includes("5 liter")) {
    return "category";
  }
  if (includesAny(normalized, B2B_TERMS)) return "b2b";
  if (includesAny(normalized, BRAND_TERMS)) return "brand";
  if (includesAny(normalized, PRODUCT_TERMS)) return "product";
  if (normalized.includes("olivenöl") || normalized.includes("olive oil")) return "category";
  if (
    normalized.includes("wie ") ||
    normalized.includes("what ") ||
    normalized.includes("warum ") ||
    normalized.includes("guide") ||
    normalized.includes("faq")
  ) {
    return "informational";
  }
  return "unknown";
}

function isLowSignalUnknownQuery(query: string, intent: SeoQueryIntent): boolean {
  if (intent !== "unknown") return false;
  const normalized = normalizeText(query).replace(/[^a-z0-9]+/g, "");
  if (!normalized) return true;
  if (normalized.length <= 4) return true;
  return false;
}

function inferredTargetUrl(snapshot: SeoSearchConsoleSnapshot, query: string, intent: SeoQueryIntent): string | null {
  const pages = snapshot.topPages || [];
  const normalizedQuery = normalizeText(query);

  const directMatch = pages.find((page) => normalizeText(page).includes(normalizedQuery.replace(/\s+/g, "-")));
  if (directMatch) return directMatch;

  if (intent === "brand") {
    return pages.find((page) => page.includes("amalphis.at/") && !page.includes("/products/")) || pages[0] || null;
  }
  if (intent === "product") {
    return pages.find((page) => page.includes("/products/")) || pages[0] || null;
  }
  if (intent === "category") {
    return pages.find((page) => page.includes("/collections/")) || pages[0] || null;
  }
  if (intent === "b2b") {
    return pages.find((page) => page.includes("shop.")) || pages[0] || null;
  }
  return pages[0] || null;
}

function buildSingleQueryOpportunity(input: {
  snapshot: SeoSearchConsoleSnapshot;
  market: string;
  language: string;
  query: string;
}): QueryGroup | null {
  const query = String(input.query || "").trim();
  if (!query) return null;

  const intent = classifyIntent(query);
  const impressions = input.snapshot.impressions ?? 0;
  const ctr = input.snapshot.ctr ?? 0;
  const averagePosition = input.snapshot.averagePosition ?? null;
  const targetUrl = inferredTargetUrl(input.snapshot, query, intent);
  if (isLowSignalUnknownQuery(query, intent)) return null;

  const hasLowCtrOpportunity = impressions > 0 && ctr <= 1 && averagePosition !== null && averagePosition <= 20;
  const hasStrikingDistanceOpportunity =
    impressions > 0 && averagePosition !== null && averagePosition >= 8 && averagePosition <= 20;

  let opportunityType: QueryGroup["opportunityType"] = "content_optimization";
  let impact: SeoImpact = impressions >= 100 ? "high" : "medium";
  let effort: SeoEffort = "medium";
  let urgency: SeoUrgency = hasStrikingDistanceOpportunity ? "high" : "medium";
  let priority: SeoPriority = impressions >= 100 ? "high" : "medium";
  let title = `Improve organic query coverage for ${query}`;
  let recommendedAction =
    `Optimize the page receiving impressions for "${query}". Review title/meta/H1, improve query-to-page alignment, and add stronger internal links from relevant pages.`;
  let reasoning =
    `Search Console shows real demand for "${query}" on ${input.snapshot.property || input.snapshot.siteUrl || "the connected property"}.`;

  if (hasStrikingDistanceOpportunity) {
    opportunityType = "keyword_quick_win";
    title = `Push ${query} into stronger rankings`;
    recommendedAction =
      `Optimize the page receiving impressions for "${query}". Review headings, expand the main content block for this query, and add internal links from relevant product or category pages.`;
    reasoning =
      `Average position is in the striking-distance range, so on-page relevance and internal linking work can move this query without needing a new ranking source.`;
  } else if (hasLowCtrOpportunity) {
    opportunityType = "content_optimization";
    title = `Improve CTR for ${query}`;
    recommendedAction =
      `Optimize the page receiving impressions for "${query}". Improve title/meta snippet, align page copy with query intent, and add an FAQ block if that helps clarify the offer in search results.`;
    reasoning =
      `The query already earns impressions but click-through is weak, so snippet and intent alignment are the first lever to pull.`;
  }

  if (intent === "brand" && includesAny(normalizeText(query), ["amalphis"])) {
    title = "Strengthen Amalphis brand demand pages";
    recommendedAction =
      `Review the main Amalphis landing page and supporting brand pages. Tighten title/meta/H1 messaging, add a concise brand story block, and link clearly to the highest-converting product and collection pages.`;
    reasoning =
      `Brand demand already exists. The goal is to make sure branded searches land on the strongest page and convert into deeper product exploration.`;
  } else if (intent === "product" && includesAny(normalizeText(query), ["divo"])) {
    title = "Strengthen DIVO olive oil product intent pages";
    recommendedAction =
      `Optimize the page receiving impressions for the DIVO query set. Review title/meta/H1, add a stronger product intent block for DIVO olive oil in English and German where relevant, and add internal links from related product and collection pages.`;
    reasoning =
      `Several real GSC queries point to DIVO product intent. Grouping them into one optimization task is more actionable than treating each query separately.`;
  } else if (intent === "category" && includesAny(normalizeText(query), ["olivenöl 5 liter", "5 liter"])) {
    opportunityType = "content_gap";
    title = "Build stronger 5L olive oil category intent coverage";
    recommendedAction =
      `Optimize the page receiving impressions for "olivenöl 5 liter". Review title/meta/H1, add a German content block about 5L olive oil packaging and use cases, and add internal links from relevant product and category pages.`;
    reasoning =
      `The query suggests commercial category demand around 5L packaging. A stronger dedicated category or collection intent block should perform better than generic homepage coverage.`;
  } else if (intent === "b2b") {
    opportunityType = "content_gap";
    title = "Create B2B content for food production intent";
    recommendedAction =
      `Create or expand a B2B-focused landing page for "${query}". Add copy about supply reliability, packaging formats, production use cases, and a direct contact CTA for wholesale conversations.`;
    reasoning =
      `The query suggests B2B demand rather than retail purchase intent, so a dedicated wholesale/manufacturer-facing page is more appropriate than a standard product page.`;
    impact = "high";
    urgency = "medium";
    priority = "high";
  }

  return {
    key: `${intent}:${title}`,
    title,
    queries: [query],
    intent,
    targetUrl,
    opportunityType,
    impact,
    effort,
    urgency,
    priority,
    recommendedAction,
    reasoning,
  };
}

function mergeGroups(groups: QueryGroup[]): QueryGroup[] {
  const merged = new Map<string, QueryGroup>();

  for (const group of groups) {
    const existing = merged.get(group.key);
    if (!existing) {
      merged.set(group.key, { ...group, queries: Array.from(new Set(group.queries)) });
      continue;
    }

    existing.queries = Array.from(new Set([...existing.queries, ...group.queries]));
    if (!existing.targetUrl && group.targetUrl) existing.targetUrl = group.targetUrl;
    if (existing.priority === "medium" && group.priority === "high") existing.priority = "high";
    if (existing.impact === "medium" && group.impact === "high") existing.impact = "high";
    if (existing.urgency === "medium" && group.urgency === "high") existing.urgency = "high";
  }

  return Array.from(merged.values());
}

function categoryForOpportunityType(
  value: QueryGroup["opportunityType"]
): SeoOpportunity["type"] {
  if (value === "keyword_quick_win") return "keyword";
  return "content";
}

export function generateGscOpportunities(input: GscOpportunityEngineInput): SeoOpportunity[] {
  const queries = Array.isArray(input.snapshot.topQueries) ? input.snapshot.topQueries : [];
  if (queries.length === 0) return [];

  const grouped = mergeGroups(
    queries
      .map((query) =>
        buildSingleQueryOpportunity({
          snapshot: input.snapshot,
          market: input.market,
          language: input.language,
          query,
        })
      )
      .filter(Boolean) as QueryGroup[]
  );

  return grouped.map((group) => ({
    type: categoryForOpportunityType(group.opportunityType),
    opportunityType: group.opportunityType,
    intent: group.intent,
    title: group.title,
    description: `${group.recommendedAction} ${group.reasoning}`.trim(),
    targetUrl: group.targetUrl,
    targetKeywords: group.queries,
    market: input.market,
    language: input.language,
    impact: group.impact,
    effort: group.effort,
    urgency: group.urgency,
    priority: group.priority,
    confidence: "medium",
    source: "provider",
    recommendedAction: group.recommendedAction,
    reasoning: group.reasoning,
    evidence: [
      {
        source: "gsc",
        metric: "search_query",
        query: group.queries[0] || null,
        url: group.targetUrl,
        message: group.reasoning,
      },
    ],
  }));
}
