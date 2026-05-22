import type {
  SeoCompetitorGap,
  SeoDataProvider,
  SeoDomainOverview,
  SeoKeywordOpportunity,
  SeoProviderInput,
  SeoUrlOpportunity,
} from "./seoDataProvider";
import { normalizeProviderDomain, SeoProviderNotConfiguredError } from "./seoDataProvider";
import { SistrixClient } from "./sistrix/sistrixClient";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isObject(value)) return [];

  const directKeys = ["data", "result", "results", "answer", "items", "keywords", "competitors"];
  for (const key of directKeys) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested;
    if (isObject(nested)) {
      const nestedArray = toArray(nested);
      if (nestedArray.length) return nestedArray;
    }
  }

  const arrays = Object.values(value).filter(Array.isArray) as unknown[][];
  return arrays[0] ?? [];
}

function findObjectsDeep(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 5) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => findObjectsDeep(item, depth + 1));
  }
  if (!isObject(value)) return [];

  const keys = Object.keys(value);
  const hasMetricLikeKey = keys.some((key) =>
    ["kw", "keyword", "position", "url", "domain", "sichtbarkeitsindex", "value", "date", "competition"].includes(key)
  );
  const nested = Object.values(value).flatMap((item) => findObjectsDeep(item, depth + 1));
  return hasMetricLikeKey ? [value, ...nested] : nested;
}

function countryFromMarket(market: string): string {
  const raw = String(market || "").trim().toLowerCase();
  const map: Record<string, string> = {
    at: "at",
    de: "de",
    ch: "ch",
    us: "us",
    usa: "us",
    uk: "uk",
    gb: "uk",
  };
  return map[raw] || raw || "at";
}

function impactFromPosition(position: number | undefined): SeoKeywordOpportunity["impact"] {
  if (position === undefined) return "medium";
  if (position > 10 && position <= 30) return "high";
  if (position <= 10) return "medium";
  return "low";
}

function effortFromPosition(position: number | undefined): SeoKeywordOpportunity["effort"] {
  if (position === undefined) return "medium";
  if (position > 10 && position <= 30) return "low";
  if (position <= 10) return "medium";
  return "high";
}

export class SistrixSeoDataProvider implements SeoDataProvider {
  private readonly client: SistrixClient | null;

  constructor() {
    const apiKey = String(process.env.SISTRIX_API_KEY || "").trim();
    this.client = apiKey
      ? new SistrixClient({
          apiKey,
          baseUrl: process.env.SISTRIX_API_BASE_URL || "https://api.sistrix.com",
        })
      : null;
  }

  private getClient(): SistrixClient {
    if (!this.client) {
      throw new SeoProviderNotConfiguredError("SISTRIX provider is not configured yet");
    }
    return this.client;
  }

  async getDomainOverview(input: SeoProviderInput): Promise<SeoDomainOverview> {
    const domain = normalizeProviderDomain(input.domain);
    const payload = await this.getClient().requestJson("domain.overview", {
      domain,
      country: countryFromMarket(input.market),
    });
    const metricObjects = findObjectsDeep(payload);
    const visibility = metricObjects
      .map((item) => firstNumber(item.sichtbarkeitsindex, item.visibilityindex, item.visibility_index, item.value))
      .find((value) => value !== undefined);
    const keywordCount = metricObjects
      .map((item) => firstNumber(item["kwcount.seo"], item.kwcount_seo, item.kwcount, item.keywords))
      .find((value) => value !== undefined);
    const notes = [
      visibility !== undefined ? `Visibility index: ${visibility}` : "",
      keywordCount !== undefined ? `SEO keyword count: ${keywordCount}` : "",
    ].filter(Boolean);

    return {
      domain,
      market: input.market,
      visibilitySummary: notes.length
        ? `SISTRIX domain overview for ${domain}: ${notes.join("; ")}.`
        : `SISTRIX domain overview for ${domain} returned limited summary data.`,
      trend: "unknown",
      notes,
      visibilityIndex: visibility,
      keywordCount,
    };
  }

  async getKeywordOpportunities(input: SeoProviderInput): Promise<SeoKeywordOpportunity[]> {
    const payload = await this.getClient().requestJson("keyword.domain.seo", {
      domain: normalizeProviderDomain(input.domain),
      country: countryFromMarket(input.market),
      limit: 20,
    });

    return toArray(payload)
      .map((item) => (isObject(item) ? item : null))
      .filter(Boolean)
      .map((item) => {
        const keyword = firstString(item!.kw, item!.keyword, item!.key);
        const position = firstNumber(item!.position, item!.pos, item!.rank);
        const url = firstString(item!.url, item!.ranking_url);
        if (!keyword) return null;

        return {
          keyword,
          market: input.market,
          language: input.language,
          currentUrl: url || undefined,
          currentPosition: position,
          searchVolume: firstNumber(item!.traffic, item!.search_volume, item!.searchVolume),
          opportunityType: position !== undefined && position > 10 && position <= 30
            ? "keyword_quick_win"
            : "content_optimization",
          impact: impactFromPosition(position),
          effort: effortFromPosition(position),
          urgency: position !== undefined && position > 10 && position <= 30 ? "medium" : "low",
          reasoning: position !== undefined
            ? `SISTRIX reports ranking position ${position} for this keyword.`
            : "SISTRIX reports this keyword for the domain.",
        } satisfies SeoKeywordOpportunity;
      })
      .filter(Boolean) as SeoKeywordOpportunity[];
  }

  async getCompetitorGaps(input: SeoProviderInput): Promise<SeoCompetitorGap[]> {
    const payload = await this.getClient().requestJson("domain.competitors.seo", {
      domain: normalizeProviderDomain(input.domain),
      country: countryFromMarket(input.market),
      num: 10,
    });

    return toArray(payload)
      .map((item) => (isObject(item) ? item : null))
      .filter(Boolean)
      .map((item) => {
        const competitorDomain = firstString(item!.domain, item!.host, item!.hostname);
        if (!competitorDomain) return null;
        return {
          competitorDomain,
          keyword: "",
          competitorVisibilityIndex: firstNumber(
            item!.sichtbarkeitsindex,
            item!.visibilityindex,
            item!.visibility_index,
            item!.value
          ),
          overlapScore: firstNumber(item!.competition, item!.overlap, item!.overlap_score),
          gapType: "competitor_gap",
          impact: "medium",
          effort: "medium",
          urgency: "low",
          reasoning: "SISTRIX reports this domain as an organic search competitor.",
        } satisfies SeoCompetitorGap;
      })
      .filter(Boolean) as SeoCompetitorGap[];
  }

  async getUrlOpportunities(_input: SeoProviderInput): Promise<SeoUrlOpportunity[]> {
    return [];
  }
}
