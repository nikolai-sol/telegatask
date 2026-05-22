import {
  createSeoAnalysisRun,
  findSeoAnalysisRunById,
  updateSeoAnalysisRunStatus,
} from "./seoAnalysisRunRepository";
import {
  createSeoDraftTasks,
  findSeoDraftTaskById,
  listSeoDraftTasksByRun,
  markSeoDraftTaskConverted,
  updateSeoDraftTaskStatus as persistSeoDraftTaskStatus,
} from "./seoDraftTaskRepository";
import { BasicCrawlerSeoSource } from "./providers/basicCrawlerSeoSource";
import { GoogleSearchConsoleSeoSource } from "./providers/googleSearchConsoleSeoSource";
import { PageSpeedSeoSource } from "./providers/pageSpeedSeoSource";
import {
  normalizeProviderDomain,
  SeoProviderNotConfiguredError,
  type SeoCompetitorGap,
  type SeoDomainOverview,
  type SeoKeywordOpportunity,
  type SeoProviderInput,
  SeoProviderError,
  type SeoUrlOpportunity,
} from "./providers/seoDataProvider";
import {
  createRankingProvider,
  isRankingSource,
  resolveSeoSourceSelection,
} from "./providers/seoSourceRegistry";
import type {
  SeoAnalysisInput,
  SeoAnalysisRun,
  SeoCompetitorInsight,
  SeoConfidence,
  SeoCrawlerSnapshot,
  SeoConvertDraftTaskPriority,
  SeoDraftTaskConversionOptions,
  SeoDraftTask,
  SeoDraftTaskPriority,
  SeoDraftTaskStatus,
  SeoDraftTaskVisibility,
  SeoKeywordInsight,
  SeoOpportunity,
  SeoPageSpeedSnapshot,
  SeoPriority,
  SeoRecommendation,
  SeoSearchConsoleSnapshot,
  SeoSourceName,
  SeoSourceStatus,
  SeoTechnicalSnapshot,
} from "./types";
import { getCompanyById } from "../../repositories/companyRepository";
import { getTeamMemberRecord } from "../../repositories/teamMemberRepository";
import { createAgencyTask, getAgencyTaskById } from "../../services/firestore.service";
import type { AgencyTask } from "../../types/agency";

export class SeoDraftTaskError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "SeoDraftTaskError";
    this.statusCode = statusCode;
  }
}

type SeoDraftTaskConversionContext = {
  draftTask: SeoDraftTask;
  task: AgencyTask;
};

type RankingSourcePayload = {
  source: "mock" | "sistrix";
  overview: SeoDomainOverview;
  keywordItems: SeoKeywordOpportunity[];
  competitorItems: SeoCompetitorGap[];
  urlItems: SeoUrlOpportunity[];
};

type ExecutedSourceResult =
  | {
      source: SeoSourceName;
      status: "success";
      data?: RankingSourcePayload | SeoSearchConsoleSnapshot | SeoPageSpeedSnapshot | SeoCrawlerSnapshot;
    }
  | {
      source: SeoSourceName;
      status: "failed" | "not_configured";
      safeMessage: string;
    };

const KNOWN_SOURCE_NAMES: SeoSourceName[] = ["mock", "sistrix", "pagespeed", "crawler", "gsc"];

function emptySearchConsoleSnapshot(): SeoSearchConsoleSnapshot {
  return {
    siteUrl: null,
    clicks: null,
    impressions: null,
    ctr: null,
    averagePosition: null,
    topQueries: [],
    topPages: [],
    countries: [],
    devices: [],
  };
}

function emptyPageSpeedSnapshot(): SeoPageSpeedSnapshot {
  return {
    pageUrl: null,
    performanceScore: null,
    accessibilityScore: null,
    bestPracticesScore: null,
    seoScore: null,
    largestContentfulPaintMs: null,
    cumulativeLayoutShift: null,
    interactionToNextPaintMs: null,
    totalBlockingTimeMs: null,
  };
}

function emptyCrawlerSnapshot(): SeoCrawlerSnapshot {
  return {
    pageUrl: null,
    finalUrl: null,
    httpStatus: null,
    hasTitle: null,
    hasMetaDescription: null,
    hasH1: null,
    hasCanonical: null,
    robotsTxtReachable: null,
    sitemapXmlReachable: null,
    isIndexable: null,
  };
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function cleanNumber(value: number | undefined | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonEmptyArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function nonNull<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function firstNonNull<T>(...values: Array<T | null | undefined>): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );
}

function priorityFromSignals(params: {
  impact: "low" | "medium" | "high";
  effort: "low" | "medium" | "high";
  urgency: "low" | "medium" | "high";
}): SeoPriority {
  if (params.impact === "high" || params.urgency === "high") return "high";
  if (params.effort === "low" || params.impact === "medium" || params.urgency === "medium") return "medium";
  return "low";
}

function confidenceFromSignals(params: {
  impact: "low" | "medium" | "high";
  reasoning: string;
}): SeoConfidence {
  if (params.impact === "high") return "high";
  if (params.reasoning.trim()) return "medium";
  return "low";
}

function urlLabel(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return "page";

  try {
    const parsed = new URL(raw);
    return parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : parsed.hostname;
  } catch {
    return raw;
  }
}

function descriptionFromParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
}

function normalizeKeywords(value: string[]): string[] {
  return Array.from(
    new Set(
      nonEmptyArray(value)
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );
}

function slugify(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function validateDueDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new SeoDraftTaskError("Invalid dueDate", 400);
  }
  return parsed;
}

function normalizeKeywordInsights(items: SeoKeywordOpportunity[]): SeoKeywordInsight[] {
  return items
    .map((item) => {
      const keyword = String(item.keyword || "").trim();
      if (!keyword) return null;

      return {
        keyword,
        currentUrl: item.currentUrl || null,
        currentPosition: cleanNumber(item.currentPosition),
        searchVolume: cleanNumber(item.searchVolume),
        type: item.opportunityType,
        source: "provider",
      } satisfies SeoKeywordInsight;
    })
    .filter(Boolean) as SeoKeywordInsight[];
}

function normalizeCompetitorInsights(items: SeoCompetitorGap[]): SeoCompetitorInsight[] {
  const merged = new Map<string, SeoCompetitorInsight>();

  for (const item of items) {
    const domain = normalizeProviderDomain(item.competitorDomain);
    if (!domain) continue;

    const existing = merged.get(domain);
    if (!existing) {
      merged.set(domain, {
        domain,
        visibilityIndex: cleanNumber(item.competitorVisibilityIndex),
        overlapScore: cleanNumber(item.overlapScore),
      });
      continue;
    }

    if (existing.visibilityIndex === null) {
      existing.visibilityIndex = cleanNumber(item.competitorVisibilityIndex);
    }
    if (existing.overlapScore === null) {
      existing.overlapScore = cleanNumber(item.overlapScore);
    }
  }

  return Array.from(merged.values());
}

function createKeywordOpportunities(items: SeoKeywordOpportunity[]): SeoOpportunity[] {
  return items
    .map((item) => {
      const keyword = String(item.keyword || "").trim();
      if (!keyword) return null;

      const positionText = cleanNumber(item.currentPosition);
      return {
        type: "keyword",
        title: `Evaluate keyword opportunity: ${keyword}`,
        description: descriptionFromParts([
          positionText !== null ? `Current position: ${positionText}.` : null,
          item.currentUrl ? `Current URL: ${item.currentUrl}.` : null,
          item.reasoning,
        ]),
        targetKeywords: [keyword],
        priority: priorityFromSignals(item),
        confidence: confidenceFromSignals(item),
        source: "provider",
      } satisfies SeoOpportunity;
    })
    .filter(Boolean) as SeoOpportunity[];
}

function createCompetitorOpportunities(items: SeoCompetitorGap[]): SeoOpportunity[] {
  return items
    .map((item) => {
      const competitorDomain = normalizeProviderDomain(item.competitorDomain);
      if (!competitorDomain) return null;

      const keyword = String(item.keyword || "").trim();
      return {
        type: "competitor",
        title: keyword
          ? `Review competitor gap: ${competitorDomain} for ${keyword}`
          : `Review organic competitor: ${competitorDomain}`,
        description: descriptionFromParts([
          item.competitorUrl ? `Competitor URL: ${item.competitorUrl}.` : null,
          item.ourUrl ? `Our URL: ${item.ourUrl}.` : null,
          item.reasoning,
        ]),
        targetKeywords: keyword ? [keyword] : [],
        priority: priorityFromSignals(item),
        confidence: confidenceFromSignals(item),
        source: "provider",
      } satisfies SeoOpportunity;
    })
    .filter(Boolean) as SeoOpportunity[];
}

function createUrlOpportunities(items: SeoUrlOpportunity[]): SeoOpportunity[] {
  return items
    .map((item) => {
      const url = String(item.url || "").trim();
      if (!url) return null;

      const type = item.issueType === "technical_issue" ? "technical" : "content";
      const title =
        type === "technical"
          ? `Review technical SEO issue: ${urlLabel(url)}`
          : `Improve content coverage: ${urlLabel(url)}`;

      return {
        type,
        title,
        description: descriptionFromParts([item.recommendedAction, item.reasoning]),
        targetKeywords: nonEmptyArray(item.targetKeywords).filter((keyword) => String(keyword || "").trim().length > 0),
        priority: priorityFromSignals(item),
        confidence: confidenceFromSignals(item),
        source: "provider",
      } satisfies SeoOpportunity;
    })
    .filter(Boolean) as SeoOpportunity[];
}

function recommendationKey(item: SeoRecommendation): string {
  return `${item.type}:${item.title.toLowerCase()}`;
}

function opportunityKey(item: SeoOpportunity): string {
  return `${item.type}:${item.title.toLowerCase()}:${normalizeKeywords(item.targetKeywords).join("|")}`;
}

function dedupeRecommendations(items: SeoRecommendation[]): SeoRecommendation[] {
  const seen = new Set<string>();
  const deduped: SeoRecommendation[] = [];

  for (const item of items) {
    const key = recommendationKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function dedupeOpportunities(items: SeoOpportunity[]): SeoOpportunity[] {
  const seen = new Set<string>();
  const deduped: SeoOpportunity[] = [];

  for (const item of items) {
    const key = opportunityKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function createRecommendations(input: {
  keywords: SeoKeywordInsight[];
  competitors: SeoCompetitorInsight[];
  opportunities: SeoOpportunity[];
  urlItems: SeoUrlOpportunity[];
  overview: SeoDomainOverview | null;
  sourceStatuses: SeoSourceStatus[];
  searchConsole: SeoSearchConsoleSnapshot;
  pagespeed: SeoPageSpeedSnapshot;
  crawler: SeoCrawlerSnapshot;
}): SeoRecommendation[] {
  const recommendations: SeoRecommendation[] = [];
  const seen = new Set<string>();

  const push = (item: SeoRecommendation) => {
    const key = recommendationKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    recommendations.push(item);
  };

  if (input.keywords.length > 0) {
    const topKeyword = input.keywords[0];
    push({
      type: "content",
      title: `Plan content around ${topKeyword.keyword}`,
      description: topKeyword.currentUrl
        ? `Review and expand the current ranking page for ${topKeyword.keyword} before drafting new assets.`
        : `Prepare content coverage for ${topKeyword.keyword} and adjacent search intent.`,
      priority: "medium",
    });
  }

  if (input.competitors.length > 0) {
    const topCompetitor = input.competitors[0];
    push({
      type: "competitive",
      title: `Benchmark competitor coverage: ${topCompetitor.domain}`,
      description:
        "Review overlapping topics, ranking pages, and category coverage before deciding on follow-up content work.",
      priority: "medium",
    });
  }

  if (input.urlItems.some((item) => item.issueType === "technical_issue")) {
    push({
      type: "technical",
      title: "Review baseline technical SEO health",
      description:
        "Check indexability, canonicals, titles, sitemap coverage, and template metadata before assuming content is the main constraint.",
      priority: "medium",
    });
  }

  const dataIsThin =
    input.keywords.length === 0 &&
    input.competitors.length === 0 &&
    input.opportunities.length <= 1 &&
    input.overview?.visibilityIndex === undefined &&
    input.overview?.keywordCount === undefined &&
    input.pagespeed.performanceScore === null &&
    input.crawler.httpStatus === null;

  if (
    input.searchConsole.impressions !== null &&
    input.searchConsole.impressions > 0 &&
    input.searchConsole.ctr !== null &&
    input.searchConsole.ctr < 2
  ) {
    push({
      type: "content",
      title: "Improve low-CTR search snippets",
      description:
        "Search Console data shows impressions with weak click-through rate. Review titles, meta descriptions, and snippet intent alignment.",
      priority: "medium",
    });
  }

  if (
    input.searchConsole.impressions !== null &&
    input.searchConsole.impressions >= 100 &&
    input.searchConsole.averagePosition !== null &&
    input.searchConsole.averagePosition > 8
  ) {
    push({
      type: "content",
      title: "Improve rankings for existing query demand",
      description:
        "Search Console data shows impressions but average positions remain weak. Prioritize query-to-page mapping and on-page improvements.",
      priority: "medium",
    });
  }

  if (input.pagespeed.performanceScore !== null && input.pagespeed.performanceScore < 60) {
    push({
      type: "technical",
      title: "Improve homepage performance",
      description:
        "PageSpeed Insights reports a low performance score for the homepage. Focus on load performance before assuming content is the only constraint.",
      priority: "high",
    });
  }

  if (input.pagespeed.seoScore !== null && input.pagespeed.seoScore < 80) {
    push({
      type: "technical",
      title: "Review homepage technical SEO checks",
      description:
        "PageSpeed Insights flagged weaker SEO checks on the homepage. Review crawlability, metadata, and template-level technical issues.",
      priority: "medium",
    });
  }

  if (
    (input.pagespeed.largestContentfulPaintMs !== null && input.pagespeed.largestContentfulPaintMs > 2500) ||
    (input.pagespeed.cumulativeLayoutShift !== null && input.pagespeed.cumulativeLayoutShift > 0.1) ||
    (input.pagespeed.interactionToNextPaintMs !== null && input.pagespeed.interactionToNextPaintMs > 200) ||
    (input.pagespeed.totalBlockingTimeMs !== null && input.pagespeed.totalBlockingTimeMs > 200)
  ) {
    push({
      type: "technical",
      title: "Review Core Web Vitals on the homepage",
      description:
        "PageSpeed Insights shows at least one weak Core Web Vitals or blocking metric. Validate render, layout stability, and interaction bottlenecks.",
      priority: "medium",
    });
  }

  if (input.crawler.hasTitle === false) {
    push({
      type: "technical",
      title: "Add a homepage title tag",
      description: "The crawler did not detect a homepage title tag. Add a unique, intent-aligned title before deeper SEO analysis.",
      priority: "high",
    });
  }

  if (input.crawler.hasMetaDescription === false) {
    push({
      type: "technical",
      title: "Add a homepage meta description",
      description: "The crawler did not detect a homepage meta description. Add one to improve snippet coverage and CTR control.",
      priority: "medium",
    });
  }

  if (input.crawler.hasH1 === false) {
    push({
      type: "technical",
      title: "Add a primary homepage H1",
      description: "The crawler did not detect a homepage H1. Add a clear primary heading aligned with the page's main search intent.",
      priority: "medium",
    });
  }

  if (input.crawler.hasCanonical === false) {
    push({
      type: "technical",
      title: "Add a homepage canonical tag",
      description: "The crawler did not detect a canonical tag on the homepage. Add one to reduce ambiguity around the preferred URL.",
      priority: "medium",
    });
  }

  if (input.crawler.robotsTxtReachable === false || input.crawler.sitemapXmlReachable === false) {
    push({
      type: "technical",
      title: "Review indexing infrastructure",
      description:
        "The crawler could not confirm robots.txt or sitemap.xml on the domain. Verify that search engines can discover and understand the site structure.",
      priority: "medium",
    });
  }

  if (input.crawler.isIndexable === false) {
    push({
      type: "technical",
      title: "Check homepage indexability signals",
      description:
        "The crawler detected a noindex-style signal on the homepage response. Verify whether index blocking is intentional.",
      priority: "high",
    });
  }

  const gscStatus = input.sourceStatuses.find((item) => item.source === "gsc");
  if (!gscStatus || gscStatus.status === "skipped" || gscStatus.status === "not_configured") {
    push({
      type: "tracking",
      title: "Connect Google Search Console for real query data",
      description:
        "Search Console is not connected for this run. Connect it to access clicks, impressions, CTR, and average position data.",
      priority: "medium",
    });
  }

  const pagespeedStatus = input.sourceStatuses.find((item) => item.source === "pagespeed");
  if (!pagespeedStatus || pagespeedStatus.status === "skipped" || pagespeedStatus.status === "not_configured") {
    push({
      type: "tracking",
      title: "Run PageSpeed audit for technical performance data",
      description:
        "PageSpeed data is missing for this run. Add the PageSpeed source to capture homepage performance and technical SEO signals.",
      priority: "low",
    });
  }

  if (dataIsThin || recommendations.length === 0) {
    push({
      type: "tracking",
      title: "Improve SEO tracking coverage",
      description:
        "The provider returned limited data. Expand keyword coverage, competitor inputs, and baseline tracking before drawing stronger conclusions.",
      priority: "high",
    });
  }

  return recommendations;
}

function createSummary(input: {
  overview: SeoDomainOverview | null;
  keywords: SeoKeywordInsight[];
  competitors: SeoCompetitorInsight[];
}) {
  return {
    visibilityIndex: cleanNumber(input.overview?.visibilityIndex),
    keywordCount:
      cleanNumber(input.overview?.keywordCount) ??
      (input.keywords.length > 0 ? input.keywords.length : null),
    competitorCount: input.competitors.length > 0 ? input.competitors.length : null,
  };
}

function createTechnicalSnapshot(input: {
  crawler: SeoCrawlerSnapshot;
  pagespeed: SeoPageSpeedSnapshot;
}): SeoTechnicalSnapshot {
  const highlights: string[] = [];

  if (input.crawler.hasTitle === false) highlights.push("Homepage title missing");
  if (input.crawler.hasMetaDescription === false) highlights.push("Homepage meta description missing");
  if (input.crawler.hasH1 === false) highlights.push("Homepage H1 missing");
  if (input.crawler.hasCanonical === false) highlights.push("Homepage canonical missing");
  if (input.crawler.robotsTxtReachable === false) highlights.push("robots.txt not reachable");
  if (input.crawler.sitemapXmlReachable === false) highlights.push("sitemap.xml not reachable");
  if (input.crawler.isIndexable === false) highlights.push("Homepage may be blocked from indexing");
  if (input.pagespeed.performanceScore !== null && input.pagespeed.performanceScore < 60) {
    highlights.push("Low PageSpeed performance score");
  }
  if (input.pagespeed.seoScore !== null && input.pagespeed.seoScore < 80) {
    highlights.push("PageSpeed SEO score below target");
  }

  return {
    issueCount: highlights.length > 0 ? highlights.length : null,
    highlights,
  };
}

function scoreVisibility(visibilityIndex: number | null): number | null {
  if (visibilityIndex === null) return null;
  return clampScore(Math.log10(visibilityIndex + 1) * 70);
}

function scoreOpportunity(opportunities: SeoOpportunity[]): number | null {
  if (opportunities.length === 0) return null;

  const weights: Record<SeoPriority, number> = {
    low: 1,
    medium: 2,
    high: 3,
  };
  const total = opportunities.reduce((sum, item) => sum + weights[item.priority], 0);
  return clampScore((total / 18) * 100);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function scoreCompetitorPressure(input: {
  competitors: SeoCompetitorInsight[];
  domainVisibilityIndex: number | null;
}): number | null {
  if (input.competitors.length === 0) return null;

  const countScore = Math.min(60, input.competitors.length * 15);
  const overlapAverage = average(
    input.competitors
      .map((item) => cleanNumber(item.overlapScore))
      .filter((value): value is number => value !== null)
  );

  let strengthScore = 0;
  const domainVisibilityIndex = input.domainVisibilityIndex;
  if (domainVisibilityIndex !== null && domainVisibilityIndex > 0) {
    const ratios = input.competitors
      .map((item) =>
        item.visibilityIndex !== null ? item.visibilityIndex / domainVisibilityIndex : null
      )
      .filter((value): value is number => value !== null && Number.isFinite(value) && value > 1);
    const averageRatio = average(ratios);
    if (averageRatio !== null) {
      strengthScore += Math.min(25, (averageRatio - 1) * 20);
    }
  }

  if (overlapAverage !== null) {
    strengthScore += Math.min(15, overlapAverage * 0.15);
  }

  return clampScore(countScore + strengthScore);
}

function scoreOverall(input: {
  visibilityScore: number | null;
  opportunityScore: number | null;
  competitorPressureScore: number | null;
}): number | null {
  const components: Array<{ weight: number; value: number }> = [];

  if (input.visibilityScore !== null) {
    components.push({ weight: 0.45, value: input.visibilityScore });
  }
  if (input.opportunityScore !== null) {
    components.push({ weight: 0.25, value: 100 - input.opportunityScore });
  }
  if (input.competitorPressureScore !== null) {
    components.push({ weight: 0.3, value: 100 - input.competitorPressureScore });
  }

  if (components.length < 2) return null;

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const totalValue = components.reduce((sum, item) => sum + item.value * item.weight, 0);
  return clampScore(totalValue / totalWeight);
}

function mapRunPriorityToDraftPriority(priority: SeoPriority): SeoDraftTaskPriority {
  return priority === "high" ? "priority" : "normal";
}

function normalizeConvertPriority(
  inputPriority: SeoConvertDraftTaskPriority | undefined,
  draftPriority: SeoDraftTaskPriority
): "normal" | "high" {
  if (inputPriority === "priority") return "high";
  if (inputPriority === "normal") return "normal";
  if (draftPriority === "priority" || draftPriority === "fire") return "high";
  return "normal";
}

function defaultVisibility(companyId: string | null): SeoDraftTaskVisibility {
  return companyId ? "team" : "private";
}

function draftTaskSourceId(sourceType: "opportunity" | "recommendation", title: string, keywords: string[]): string {
  const keywordKey = normalizeKeywords(keywords).join("-");
  return `${sourceType}:${slugify(title)}:${slugify(keywordKey || "none")}`;
}

function buildDraftTaskFromOpportunity(input: {
  teamId: string;
  run: SeoAnalysisRun;
  opportunity: SeoOpportunity;
}): Omit<SeoDraftTask, "id"> | null {
  const title = String(input.opportunity.title || "").trim();
  if (!title) return null;

  const keywords = normalizeKeywords(input.opportunity.targetKeywords);
  if (input.opportunity.type === "keyword" && keywords.length === 0) return null;

  let mappedTitle = title;
  let description = input.opportunity.description || "Review this SEO opportunity and decide on the next action.";

  if (input.opportunity.type === "keyword") {
    const keyword = keywords[0];
    mappedTitle = `Evaluate SEO keyword opportunity: ${keyword}`;
    description = "Review current ranking, search intent, and content coverage for this keyword.";
  } else if (input.opportunity.type === "competitor") {
    const competitor = title.replace(/^Review competitor gap:\s*/i, "").replace(/^Review organic competitor:\s*/i, "").trim();
    mappedTitle = competitor
      ? `Review organic SEO competitor: ${competitor}`
      : "Review organic SEO competitor";
    description = "Analyze why this domain appears as an organic competitor and identify content or keyword gaps.";
  } else if (input.opportunity.type === "technical") {
    mappedTitle = title;
    description = input.opportunity.description || "Review the technical SEO issue and document the required fixes.";
  } else if (input.opportunity.type === "content") {
    mappedTitle = title;
    description = input.opportunity.description || "Review content coverage and define the next SEO action.";
  }

  if (!mappedTitle.trim()) return null;

  const now = new Date().toISOString();
  return {
    teamId: input.teamId,
    runId: input.run.id,
    domain: input.run.domain,
    sourceType: "opportunity",
    sourceId: draftTaskSourceId("opportunity", mappedTitle, keywords),
    title: mappedTitle,
    description,
    priority: mapRunPriorityToDraftPriority(input.opportunity.priority),
    status: "draft",
    targetKeywords: keywords,
    suggestedCompanyId: input.run.companyId || null,
    realTaskId: null,
    convertedAt: null,
    convertedByUserId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildDraftTaskFromRecommendation(input: {
  teamId: string;
  run: SeoAnalysisRun;
  recommendation: SeoRecommendation;
}): Omit<SeoDraftTask, "id"> | null {
  const title = String(input.recommendation.title || "").trim();
  if (!title) return null;

  let description =
    input.recommendation.description || "Review this SEO recommendation and decide whether it should become real work later.";

  if (input.recommendation.type === "tracking" && /tracking coverage/i.test(title)) {
    description =
      "Review whether the domain has enough keyword, competitor, and visibility data for reliable SEO analysis.";
  }

  const now = new Date().toISOString();
  return {
    teamId: input.teamId,
    runId: input.run.id,
    domain: input.run.domain,
    sourceType: "recommendation",
    sourceId: draftTaskSourceId("recommendation", title, []),
    title,
    description,
    priority: mapRunPriorityToDraftPriority(input.recommendation.priority),
    status: "draft",
    targetKeywords: [],
    suggestedCompanyId: input.run.companyId || null,
    realTaskId: null,
    convertedAt: null,
    convertedByUserId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function dedupeDraftTasks(tasks: Array<Omit<SeoDraftTask, "id">>): Array<Omit<SeoDraftTask, "id">> {
  const seen = new Set<string>();
  const deduped: Array<Omit<SeoDraftTask, "id">> = [];

  for (const task of tasks) {
    const key = `${slugify(task.title)}:${normalizeKeywords(task.targetKeywords).join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(task);
  }

  return deduped;
}

function isSuccessSourceResult(
  item: ExecutedSourceResult
): item is Extract<ExecutedSourceResult, { status: "success" }> {
  return item.status === "success";
}

function toSourceStatus(result: ExecutedSourceResult, selectedSources: SeoSourceName[]): SeoSourceStatus {
  if (!selectedSources.includes(result.source)) {
    return {
      source: result.source,
      status: "skipped",
      safeMessage: "Source not selected for this run",
    };
  }

  if (result.status === "success") {
    return { source: result.source, status: "success" };
  }

  return {
    source: result.source,
    status: result.status,
    safeMessage: result.safeMessage,
  };
}

async function runRankingSource(
  source: "mock" | "sistrix",
  providerInput: SeoProviderInput
): Promise<ExecutedSourceResult> {
  try {
    const provider = createRankingProvider(source);
    const [overview, keywordItems, competitorItems, urlItems] = await Promise.all([
      provider.getDomainOverview(providerInput),
      provider.getKeywordOpportunities(providerInput),
      provider.getCompetitorGaps(providerInput),
      provider.getUrlOpportunities(providerInput),
    ]);

    return {
      source,
      status: "success",
      data: {
        source,
        overview,
        keywordItems: nonEmptyArray(keywordItems),
        competitorItems: nonEmptyArray(competitorItems),
        urlItems: nonEmptyArray(urlItems),
      },
    };
  } catch (err) {
    if (err instanceof SeoProviderNotConfiguredError) {
      return {
        source,
        status: "not_configured",
        safeMessage: err.message,
      };
    }
    if (err instanceof SeoProviderError) {
      return {
        source,
        status: "failed",
        safeMessage: err.safeMessage,
      };
    }
    throw err;
  }
}

async function runPageSpeedSource(domain: string): Promise<ExecutedSourceResult> {
  try {
    const snapshot = await new PageSpeedSeoSource().getSnapshot(domain);
    return {
      source: "pagespeed",
      status: "success",
      data: snapshot,
    };
  } catch (err) {
    if (err instanceof SeoProviderNotConfiguredError) {
      return {
        source: "pagespeed",
        status: "not_configured",
        safeMessage: err.message,
      };
    }
    if (err instanceof SeoProviderError) {
      return {
        source: "pagespeed",
        status: "failed",
        safeMessage: err.safeMessage,
      };
    }
    throw err;
  }
}

async function runCrawlerSource(domain: string): Promise<ExecutedSourceResult> {
  try {
    const snapshot = await new BasicCrawlerSeoSource().getSnapshot(domain);
    return {
      source: "crawler",
      status: "success",
      data: snapshot,
    };
  } catch (err) {
    if (err instanceof SeoProviderNotConfiguredError) {
      return {
        source: "crawler",
        status: "not_configured",
        safeMessage: err.message,
      };
    }
    if (err instanceof SeoProviderError) {
      return {
        source: "crawler",
        status: "failed",
        safeMessage: err.safeMessage,
      };
    }
    throw err;
  }
}

async function runGscSource(domain: string): Promise<ExecutedSourceResult> {
  try {
    const snapshot = await new GoogleSearchConsoleSeoSource().getSnapshot(domain);
    return {
      source: "gsc",
      status: "success",
      data: snapshot,
    };
  } catch (err) {
    if (err instanceof SeoProviderNotConfiguredError) {
      return {
        source: "gsc",
        status: "not_configured",
        safeMessage: err.message,
      };
    }
    if (err instanceof SeoProviderError) {
      return {
        source: "gsc",
        status: "failed",
        safeMessage: err.safeMessage,
      };
    }
    throw err;
  }
}

async function executeSelectedSource(
  source: SeoSourceName,
  providerInput: SeoProviderInput
): Promise<ExecutedSourceResult> {
  if (isRankingSource(source)) {
    return runRankingSource(source, providerInput);
  }
  if (source === "pagespeed") return runPageSpeedSource(providerInput.domain);
  if (source === "crawler") return runCrawlerSource(providerInput.domain);
  return runGscSource(providerInput.domain);
}

export async function runSeoAnalysis(input: SeoAnalysisInput): Promise<SeoAnalysisRun> {
  const providerInput: SeoProviderInput = {
    teamId: input.teamId,
    companyId: input.companyId,
    domain: normalizeProviderDomain(input.config.domain),
    market: input.config.markets[0] || "AT",
    language: input.config.languages[0] || "de",
    competitors: input.config.competitors,
    importantSections: input.config.importantSections,
    mode: input.mode,
  };

  const selection = resolveSeoSourceSelection(input.sources);
  const executed = await Promise.all(
    selection.selectedSources.map((source) => executeSelectedSource(source, providerInput))
  );

  const sourceStatuses = KNOWN_SOURCE_NAMES.map((source) => {
    const result = executed.find((item) => item.source === source);
    if (!result) {
      return toSourceStatus(
        {
          source,
          status: "failed",
          safeMessage: "Source execution missing",
        },
        selection.selectedSources
      );
    }
    return toSourceStatus(result, selection.selectedSources);
  });

  const rankingPayloads = executed
    .filter((item): item is Extract<ExecutedSourceResult, { status: "success" }> => {
      return isSuccessSourceResult(item) && isRankingSource(item.source);
    })
    .map((item) => item.data as RankingSourcePayload);

  const successfulResults = executed.filter(isSuccessSourceResult);
  const searchConsole =
    (successfulResults.find((item) => item.source === "gsc")?.data as SeoSearchConsoleSnapshot | undefined) ??
    emptySearchConsoleSnapshot();
  const pagespeed =
    (successfulResults.find((item) => item.source === "pagespeed")?.data as SeoPageSpeedSnapshot | undefined) ??
    emptyPageSpeedSnapshot();
  const crawler =
    (successfulResults.find((item) => item.source === "crawler")?.data as SeoCrawlerSnapshot | undefined) ??
    emptyCrawlerSnapshot();

  const overview = rankingPayloads[0]?.overview ?? null;
  const keywordItems = rankingPayloads.flatMap((item) => item.keywordItems);
  const competitorItems = rankingPayloads.flatMap((item) => item.competitorItems);
  const urlItems = rankingPayloads.flatMap((item) => item.urlItems);

  const successfulSources = sourceStatuses.filter((item) => item.status === "success");
  if (successfulSources.length === 0) {
    const primaryFailure = executed[0];
    if (selection.mode === "single" && primaryFailure?.status === "not_configured") {
      throw new SeoProviderNotConfiguredError(primaryFailure.safeMessage);
    }
    if (selection.mode === "single" && primaryFailure?.status === "failed") {
      throw new SeoProviderError({
        category: "seo_source_failed",
        safeMessage: primaryFailure.safeMessage,
        statusCode: 503,
      });
    }
    throw new SeoProviderError({
      category: "seo_sources_unavailable",
      safeMessage: "No SEO data sources produced usable data",
      statusCode: 503,
    });
  }

  const keywords = normalizeKeywordInsights(keywordItems);
  const competitors = normalizeCompetitorInsights(competitorItems);
  const opportunities = dedupeOpportunities([
    ...createKeywordOpportunities(keywordItems),
    ...createCompetitorOpportunities(competitorItems),
    ...createUrlOpportunities(urlItems),
  ]);
  const recommendations = dedupeRecommendations(
    createRecommendations({
      keywords,
      competitors,
      opportunities,
      urlItems,
      overview,
      sourceStatuses,
      searchConsole,
      pagespeed,
      crawler,
    })
  );
  const summary = createSummary({ overview, keywords, competitors });
  const visibility = {
    visibilityIndex: summary.visibilityIndex,
    trend: overview?.trend ?? "unknown",
    notes: uniqueStrings(rankingPayloads.flatMap((item) => nonEmptyArray(item.overview.notes))),
  } as const;
  const technical = createTechnicalSnapshot({ crawler, pagespeed });
  const visibilityScore = scoreVisibility(summary.visibilityIndex);
  const opportunityScore = scoreOpportunity(opportunities);
  const competitorPressureScore = scoreCompetitorPressure({
    competitors,
    domainVisibilityIndex: summary.visibilityIndex,
  });
  const scores = {
    visibilityScore,
    opportunityScore,
    competitorPressureScore,
    overallSeoScore: scoreOverall({
      visibilityScore,
      opportunityScore,
      competitorPressureScore,
    }),
  };

  return createSeoAnalysisRun({
    teamId: input.teamId,
    companyId: input.companyId,
    configId: input.config.id,
    mode: input.mode,
    provider: selection.mode === "multi" || selection.selectedSources.length > 1 ? "multi_source" : selection.selectedSources[0],
    sources: selection.selectedSources,
    sourceStatuses,
    domain: providerInput.domain,
    summary,
    visibility,
    keywords,
    competitors,
    technical,
    searchConsole,
    pagespeed,
    crawler,
    opportunities,
    recommendations,
    scores,
    createdByUserId: input.createdByUserId,
  });
}

export async function approveSeoRun(runId: string): Promise<void> {
  await updateSeoAnalysisRunStatus(runId, "approved");
}

export async function generateSeoDraftTasksForRun(teamId: string, runId: string): Promise<SeoDraftTask[]> {
  const run = await findSeoAnalysisRunById(runId);
  if (!run) {
    throw new SeoDraftTaskError("SEO analysis run not found", 404);
  }
  if (run.teamId !== teamId) {
    throw new SeoDraftTaskError("Access denied", 403);
  }
  if (run.status === "failed") {
    throw new SeoDraftTaskError("Cannot generate draft tasks for a failed SEO analysis run", 400);
  }

  const existing = await listSeoDraftTasksByRun(teamId, runId);
  if (existing.length > 0) return existing;

  const generated = dedupeDraftTasks([
    ...run.opportunities
      .map((opportunity) => buildDraftTaskFromOpportunity({ teamId, run, opportunity }))
      .filter(Boolean) as Array<Omit<SeoDraftTask, "id">>,
    ...run.recommendations
      .map((recommendation) => buildDraftTaskFromRecommendation({ teamId, run, recommendation }))
      .filter(Boolean) as Array<Omit<SeoDraftTask, "id">>,
  ]);

  if (generated.length === 0) return [];
  return createSeoDraftTasks({ teamId, tasks: generated });
}

export async function listSeoDraftTasksForRun(teamId: string, runId: string): Promise<SeoDraftTask[]> {
  const run = await findSeoAnalysisRunById(runId);
  if (!run) {
    throw new SeoDraftTaskError("SEO analysis run not found", 404);
  }
  if (run.teamId !== teamId) {
    throw new SeoDraftTaskError("Access denied", 403);
  }

  return listSeoDraftTasksByRun(teamId, runId);
}

export async function updateSeoDraftTaskStatus(input: {
  teamId: string;
  draftTaskId: string;
  status: SeoDraftTaskStatus;
}): Promise<SeoDraftTask> {
  const existing = await findSeoDraftTaskById(input.teamId, input.draftTaskId);
  if (!existing) {
    throw new SeoDraftTaskError("SEO draft task not found", 404);
  }

  const updated = await persistSeoDraftTaskStatus(input);
  if (!updated) {
    throw new SeoDraftTaskError("SEO draft task not found", 404);
  }
  return updated;
}

export async function convertSeoDraftTaskToRealTask(input: {
  teamId: string;
  userId: string;
  draftTaskId: string;
  options: SeoDraftTaskConversionOptions;
}): Promise<SeoDraftTaskConversionContext> {
  const draftTask = await findSeoDraftTaskById(input.teamId, input.draftTaskId);
  if (!draftTask) {
    throw new SeoDraftTaskError("SEO draft task not found", 404);
  }
  if (draftTask.status === "draft") {
    throw new SeoDraftTaskError("SEO draft task is not approved yet", 400);
  }
  if (draftTask.status === "rejected") {
    throw new SeoDraftTaskError("Rejected SEO draft tasks cannot be converted", 400);
  }

  if (draftTask.realTaskId) {
    const existingTask = await getAgencyTaskById(draftTask.realTaskId);
    if (existingTask) {
      return { draftTask, task: existingTask };
    }
    throw new SeoDraftTaskError("SEO draft task is already linked to a real task", 409);
  }

  const rawCompanyId = input.options.companyId;
  const requestedCompanyId =
    typeof rawCompanyId === "string" ? rawCompanyId.trim() : rawCompanyId === null ? null : undefined;
  const explicitHomeTask = requestedCompanyId === null || (!requestedCompanyId && input.options.visibility === "private");
  const fallbackCompanyId = draftTask.suggestedCompanyId || "";
  const selectedCompanyId = explicitHomeTask ? "" : typeof requestedCompanyId === "string" ? requestedCompanyId : fallbackCompanyId;

  let resolvedCompanyId: string | null = null;
  if (selectedCompanyId) {
    const company = await getCompanyById(selectedCompanyId);
    if (!company) {
      throw new SeoDraftTaskError("Company not found", 404);
    }
    if (company.teamId !== input.teamId) {
      throw new SeoDraftTaskError("Access denied", 403);
    }
    resolvedCompanyId = company.id;
  }

  const visibility = input.options.visibility ?? defaultVisibility(resolvedCompanyId);
  if (visibility !== "private" && visibility !== "team") {
    throw new SeoDraftTaskError("Invalid visibility", 400);
  }
  if (resolvedCompanyId && visibility !== "team") {
    throw new SeoDraftTaskError("Company SEO tasks must use team visibility", 400);
  }
  if (!resolvedCompanyId && visibility !== "private") {
    throw new SeoDraftTaskError("Home SEO tasks must use private visibility", 400);
  }

  const assignedUserId =
    typeof input.options.assignedUserId === "string" && input.options.assignedUserId.trim()
      ? input.options.assignedUserId.trim()
      : undefined;
  if (assignedUserId) {
    const teamMember = await getTeamMemberRecord(input.teamId, assignedUserId);
    if (!teamMember || teamMember.status !== "active") {
      throw new SeoDraftTaskError("Assigned user is not an active team member", 400);
    }
  }
  const dueDate = validateDueDate(input.options.dueDate);
  const priority = normalizeConvertPriority(input.options.priority, draftTask.priority);
  const keywordLine = draftTask.targetKeywords.length
    ? `Target keywords: ${draftTask.targetKeywords.join(", ")}`
    : "";
  const description = [
    draftTask.description,
    "",
    "Created from SEO analysis draft task.",
    `Domain: ${draftTask.domain}`,
    keywordLine,
  ]
    .filter(Boolean)
    .join("\n");

  const task = await createAgencyTask({
    teamId: input.teamId,
    companyId: resolvedCompanyId || undefined,
    visibility,
    assignedTo: assignedUserId,
    createdBy: input.userId,
    title: draftTask.title,
    description,
    status: "todo",
    priority,
    isFire: false,
    dueDate,
  });

  const updatedDraftTask = await markSeoDraftTaskConverted({
    teamId: input.teamId,
    draftTaskId: draftTask.id,
    realTaskId: task.id,
    convertedByUserId: input.userId,
  });
  if (!updatedDraftTask) {
    throw new SeoDraftTaskError("SEO draft task not found", 404);
  }

  return {
    draftTask: updatedDraftTask,
    task,
  };
}
