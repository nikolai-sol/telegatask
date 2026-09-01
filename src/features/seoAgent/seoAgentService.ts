import {
  createSeoAnalysisRun,
  findSeoAnalysisRunById,
  findSeoAnalysisRunByTeamAndId,
  updateSeoAnalysisRunStatusForTeam,
} from "./seoAnalysisRunRepository";
import {
  createSeoDraftTasks,
  findSeoDraftTaskById,
  listSeoDraftTasksByRun,
  markSeoDraftTaskConverted,
  updateSeoDraftTaskStatus as persistSeoDraftTaskStatus,
} from "./seoDraftTaskRepository";
import { BasicCrawlerSeoSource } from "./providers/basicCrawlerSeoSource";
import { GoogleSerpRankSource } from "./providers/googleSerpRankSource";
import { GoogleSearchConsoleSeoSource } from "./providers/googleSearchConsoleSeoSource";
import { PageSpeedSeoSource } from "./providers/pageSpeedSeoSource";
import { YandexWebmasterSeoSource } from "./providers/yandexWebmasterSeoSource";
import { YandexSerpRankSource } from "./providers/yandexSerpRankSource";
import {
  normalizeProviderDomain,
  resolveProviderAuditedOrigin,
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
import { generateGscOpportunities } from "./gscOpportunityEngine";
import type {
  SeoAnalysisInput,
  SeoAnalysisRun,
  SeoCompetitorInsight,
  SeoConfidence,
  SeoCrawlerSnapshot,
  SeoDeviceType,
  SeoConvertDraftTaskPriority,
  SeoDraftTaskConversionOptions,
  SeoDraftTask,
  SeoDraftTaskPriority,
  SeoDraftTaskStatus,
  SeoDraftTaskVisibility,
  SeoEvidence,
  SeoFinding,
  SeoHarnessDraftTask,
  GoogleRankCheck,
  SeoKeywordInsight,
  SeoOpportunity,
  SeoPageSpeedSnapshot,
  SeoPriority,
  SeoRankProviderStatus,
  SeoRankTrackingSnapshot,
  SeoRecommendation,
  SeoSearchConsoleSnapshot,
  SeoSourceName,
  SeoSourceLabel,
  SeoSourceStatus,
  SeoTechnicalSnapshot,
  YandexRankCheck,
} from "./types";
import { runSeoHarness } from "./harness/seoHarness";
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
      message: string;
      collectedAt: number;
      metricsSummary?: Record<string, string | number | boolean | null>;
      data?:
        | RankingSourcePayload
        | SeoSearchConsoleSnapshot
        | SeoPageSpeedSnapshot
        | SeoCrawlerSnapshot
        | {
            provider: "dataforseo" | "yandex_search_api";
            checks: GoogleRankCheck[] | YandexRankCheck[];
            status: SeoRankProviderStatus;
          };
    }
  | {
      source: SeoSourceName;
      status: "partial" | "failed" | "skipped";
      message: string;
      errorCode?: string;
      collectedAt: number;
      metricsSummary?: Record<string, string | number | boolean | null>;
      data?: {
        provider: "dataforseo" | "yandex_search_api";
        checks: GoogleRankCheck[] | YandexRankCheck[];
        status: SeoRankProviderStatus;
      };
    };

const KNOWN_SOURCE_NAMES: SeoSourceName[] = [
  "mock",
  "sistrix",
  "pagespeed",
  "crawler",
  "gsc",
  "yandex_webmaster",
  "google_serp_rank",
  "yandex_serp_rank",
];

function emptySearchConsoleSnapshot(): SeoSearchConsoleSnapshot {
  return {
    property: null,
    siteUrl: null,
    dateRange: {
      startDate: null,
      endDate: null,
      days: null,
    },
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

function emptyRankTrackingSnapshot(): SeoRankTrackingSnapshot {
  return {};
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

function labelsFromEvidence(evidence: SeoEvidence[], includeHeuristic = false): SeoSourceLabel[] {
  const labels = new Set<SeoSourceLabel>();
  for (const item of evidence) {
    if (item.source === "gsc") labels.add("Google Search Console data");
    if (item.source === "yandex_webmaster") labels.add("Yandex Webmaster data");
    if (item.source === "crawler") labels.add("Technical crawler data");
    if (item.source === "pagespeed") labels.add("PageSpeed data");
    if (item.source === "harness") labels.add("AI heuristic, not Google ranking data");
  }
  if (includeHeuristic) labels.add("AI heuristic, not Google ranking data");
  return Array.from(labels);
}

function sourceCollectedAt(): number {
  return Date.now();
}

function readTargetDevice(value: SeoDeviceType | null | undefined): SeoDeviceType {
  return value === "mobile" ? "mobile" : "desktop";
}

function providerErrorCode(err: SeoProviderError): string {
  if (err.category === "pagespeed_rate_limit") return "PAGESPEED_RATE_LIMIT";
  return err.category
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function crawlerMetricsSummary(snapshot: SeoCrawlerSnapshot): Record<string, string | number | boolean | null> {
  return {
    homepageStatusCode: snapshot.httpStatus,
    titleExists: snapshot.hasTitle,
    metaDescriptionExists: snapshot.hasMetaDescription,
    h1Exists: snapshot.hasH1,
    canonicalExists: snapshot.hasCanonical,
    robotsTxtAvailable: snapshot.robotsTxtReachable,
    sitemapXmlAvailable: snapshot.sitemapXmlReachable,
    isIndexable: snapshot.isIndexable,
  };
}

function pageSpeedMetricsSummary(snapshot: SeoPageSpeedSnapshot): Record<string, string | number | boolean | null> {
  return {
    pageUrl: snapshot.pageUrl,
    performanceScore: snapshot.performanceScore,
    accessibilityScore: snapshot.accessibilityScore,
    bestPracticesScore: snapshot.bestPracticesScore,
    seoScore: snapshot.seoScore,
    largestContentfulPaintMs: snapshot.largestContentfulPaintMs,
    cumulativeLayoutShift: snapshot.cumulativeLayoutShift,
    interactionToNextPaintMs: snapshot.interactionToNextPaintMs,
    totalBlockingTimeMs: snapshot.totalBlockingTimeMs,
  };
}

function gscMetricsSummary(snapshot: SeoSearchConsoleSnapshot): Record<string, string | number | boolean | null> {
  return {
    property: snapshot.property ?? snapshot.siteUrl,
    startDate: snapshot.dateRange.startDate,
    endDate: snapshot.dateRange.endDate,
    impressions: snapshot.impressions,
    clicks: snapshot.clicks,
    ctr: snapshot.ctr,
    averagePosition: snapshot.averagePosition,
    topQueryCount: snapshot.topQueries.length,
    topPageCount: snapshot.topPages.length,
  };
}

function yandexWebmasterMetricsSummary(snapshot: SeoSearchConsoleSnapshot): Record<string, string | number | boolean | null> {
  return {
    host: snapshot.property ?? snapshot.siteUrl,
    startDate: snapshot.dateRange.startDate,
    endDate: snapshot.dateRange.endDate,
    impressions: snapshot.impressions,
    clicks: snapshot.clicks,
    ctr: snapshot.ctr,
    averagePosition: snapshot.averagePosition,
    topQueryCount: snapshot.topQueries.length,
  };
}

function rankTrackingMetricsSummary(status: SeoRankProviderStatus): Record<string, string | number | boolean | null> {
  return {
    providerState: status.state,
    ...(status.metricsSummary || {}),
  };
}

function readRankTrackingMaxKeywords(): number {
  const parsed = Number(process.env.SEO_RANK_TRACKING_MAX_KEYWORDS || "");
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return Math.min(20, Math.floor(parsed));
}

function readRankTrackingMaxQueryLength(): number {
  const parsed = Number(process.env.SEO_RANK_TRACKING_MAX_QUERY_LENGTH || "");
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.min(200, Math.floor(parsed));
}

function normalizeRankTrackingKeywords(input: string[]): string[] {
  const maxLength = readRankTrackingMaxQueryLength();
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawValue of input) {
    const keyword = String(rawValue || "").trim();
    if (!keyword) continue;
    if (keyword.length > maxLength) continue;
    const dedupeKey = keyword.toLocaleLowerCase("en-US");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalized.push(keyword);
  }

  return normalized;
}

function selectRankTrackingKeywords(input: {
  requestKeywords?: string[];
  configTrackingKeywords: string[];
  configBrandKeywords: string[];
  gscTopQueries?: string[];
}): string[] {
  const maxKeywords = readRankTrackingMaxKeywords();
  const selected = normalizeRankTrackingKeywords([
    ...nonEmptyArray(input.requestKeywords),
    ...nonEmptyArray(input.configTrackingKeywords),
    ...nonEmptyArray(input.gscTopQueries),
    ...nonEmptyArray(input.configBrandKeywords),
  ]);
  return selected.slice(0, maxKeywords);
}

function isoNow(): string {
  return new Date().toISOString();
}

function rankTrackingProviderStatusFromError(input: {
  source: "google_serp_rank" | "yandex_serp_rank";
  error: SeoProviderError;
}): SeoRankProviderStatus {
  const isLimitExceeded =
    input.error.category.includes("limit_exceeded") ||
    input.error.category.includes("rate_limit") ||
    input.error.category.includes("quota");

  return {
    state: isLimitExceeded ? "limit_exceeded" : "provider_error",
    message: input.error.safeMessage,
    errorCode: providerErrorCode(input.error),
    checkedAt: isoNow(),
  };
}

function rankingMetricsSummary(payload: RankingSourcePayload): Record<string, string | number | boolean | null> {
  return {
    source: payload.source,
    visibilityIndex: payload.overview.visibilityIndex ?? null,
    keywordCount: payload.keywordItems.length,
    competitorCount: payload.competitorItems.length,
    urlOpportunityCount: payload.urlItems.length,
  };
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
  yandexWebmaster: SeoSearchConsoleSnapshot;
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

  const hasRankingSource = input.sourceStatuses.some(
    (item) =>
      (item.source === "google_serp_rank" || item.source === "mock" || item.source === "sistrix") &&
      item.status === "success"
  );

  if (hasRankingSource && input.keywords.length > 0) {
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

  if (hasRankingSource && input.competitors.length > 0) {
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
    input.searchConsole.impressions === null &&
    input.yandexWebmaster.impressions === null &&
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

  if (
    input.searchConsole.averagePosition !== null &&
    input.searchConsole.averagePosition >= 8 &&
    input.searchConsole.averagePosition <= 20
  ) {
    push({
      type: "content",
      title: "Push queries ranking in positions 8-20",
      description:
        "Search Console data shows existing query demand near page-one range. Prioritize query-to-page alignment, internal links, and tighter on-page targeting for terms already close to stronger rankings.",
      priority: "medium",
    });
  }

  const yandexWebmasterAvailable = input.sourceStatuses.some(
    (item) => item.source === "yandex_webmaster" && (item.status === "success" || item.status === "partial")
  );

  if (
    yandexWebmasterAvailable &&
    input.yandexWebmaster.impressions !== null &&
    input.yandexWebmaster.impressions > 0 &&
    input.yandexWebmaster.ctr !== null &&
    input.yandexWebmaster.ctr < 2
  ) {
    push({
      type: "content",
      title: "Improve low-CTR Yandex snippets",
      description:
        "Yandex Webmaster data shows impressions with weak click-through rate. Review titles, meta descriptions, and snippet intent alignment for Yandex search demand.",
      priority: "medium",
    });
  }

  if (
    yandexWebmasterAvailable &&
    input.yandexWebmaster.impressions !== null &&
    input.yandexWebmaster.impressions >= 100 &&
    input.yandexWebmaster.averagePosition !== null &&
    input.yandexWebmaster.averagePosition > 8
  ) {
    push({
      type: "content",
      title: "Improve Yandex rankings for existing demand",
      description:
        "Yandex Webmaster data shows impressions but average positions remain weak. Prioritize query-to-page mapping and Yandex-specific on-page improvements.",
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
  if (!gscStatus || gscStatus.status === "skipped" || gscStatus.status === "failed") {
    push({
      type: "tracking",
      title: "Connect Google Search Console for real query data",
      description:
        "Search Console is not connected for this run. Connect it to access clicks, impressions, CTR, and average position data.",
      priority: "medium",
    });
  }

  const pagespeedStatus = input.sourceStatuses.find((item) => item.source === "pagespeed");
  if (!pagespeedStatus || pagespeedStatus.status === "skipped") {
    push({
      type: "tracking",
      title: "Run PageSpeed audit for technical performance data",
      description:
        "PageSpeed data is missing for this run. Add the PageSpeed source to capture homepage performance and technical SEO signals.",
      priority: "low",
    });
  }

  if (pagespeedStatus?.status === "partial" && pagespeedStatus.errorCode === "PAGESPEED_RATE_LIMIT") {
    push({
      type: "tracking",
      title: "Retry PageSpeed after API rate limit",
      description:
        "PageSpeed Insights was rate-limited in this run. Retry later or add a dedicated API key/quota so technical performance data is consistently available.",
      priority: "low",
    });
  }

  if (!hasRankingSource) {
    push({
      type: "tracking",
      title: "Add a ranking source for visibility scoring",
      description: "Visibility and competitor scoring require a successful DataForSEO Google ranking source.",
      priority: "medium",
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

function sourceStatusEvidence(status: SeoSourceStatus): SeoEvidence {
  return {
    source: status.source,
    metric: "source_status",
    value: status.status,
    message: `${status.source} source status: ${status.status}. ${status.message}`,
    collectedAt: status.collectedAt,
  };
}

function crawlerEvidence(crawler: SeoCrawlerSnapshot): SeoEvidence[] {
  const evidence: SeoEvidence[] = [];
  if (crawler.httpStatus !== null) {
    evidence.push({
      source: "crawler",
      metric: "http_status",
      value: crawler.httpStatus,
      url: crawler.finalUrl || crawler.pageUrl,
      message: `Crawler returned HTTP ${crawler.httpStatus}.`,
    });
  }
  if (crawler.hasTitle !== null) {
    evidence.push({ source: "crawler", metric: "has_title", value: crawler.hasTitle, url: crawler.finalUrl || crawler.pageUrl, message: `Crawler title presence: ${crawler.hasTitle}.` });
  }
  if (crawler.hasMetaDescription !== null) {
    evidence.push({ source: "crawler", metric: "has_meta_description", value: crawler.hasMetaDescription, url: crawler.finalUrl || crawler.pageUrl, message: `Crawler meta description presence: ${crawler.hasMetaDescription}.` });
  }
  if (crawler.hasH1 !== null) {
    evidence.push({ source: "crawler", metric: "has_h1", value: crawler.hasH1, url: crawler.finalUrl || crawler.pageUrl, message: `Crawler H1 presence: ${crawler.hasH1}.` });
  }
  if (crawler.hasCanonical !== null) {
    evidence.push({ source: "crawler", metric: "has_canonical", value: crawler.hasCanonical, url: crawler.finalUrl || crawler.pageUrl, message: `Crawler canonical presence: ${crawler.hasCanonical}.` });
  }
  if (crawler.robotsTxtReachable !== null) {
    evidence.push({ source: "crawler", metric: "robots_txt_reachable", value: crawler.robotsTxtReachable, message: `robots.txt reachable: ${crawler.robotsTxtReachable}.` });
  }
  if (crawler.sitemapXmlReachable !== null) {
    evidence.push({ source: "crawler", metric: "sitemap_xml_reachable", value: crawler.sitemapXmlReachable, message: `sitemap.xml reachable: ${crawler.sitemapXmlReachable}.` });
  }
  if (crawler.isIndexable !== null) {
    evidence.push({ source: "crawler", metric: "is_indexable", value: crawler.isIndexable, url: crawler.finalUrl || crawler.pageUrl, message: `Crawler indexability: ${crawler.isIndexable}.` });
  }
  return evidence;
}

function pageSpeedEvidence(pagespeed: SeoPageSpeedSnapshot): SeoEvidence[] {
  const metrics: Array<[string, number | null]> = [
    ["performance_score", pagespeed.performanceScore],
    ["seo_score", pagespeed.seoScore],
    ["largest_contentful_paint_ms", pagespeed.largestContentfulPaintMs],
    ["cumulative_layout_shift", pagespeed.cumulativeLayoutShift],
    ["interaction_to_next_paint_ms", pagespeed.interactionToNextPaintMs],
    ["total_blocking_time_ms", pagespeed.totalBlockingTimeMs],
  ];
  return metrics
    .filter(([, value]) => value !== null)
    .map(([metric, value]) => ({
      source: "pagespeed" as const,
      metric,
      value,
      url: pagespeed.pageUrl,
      message: `PageSpeed ${metric}: ${value}.`,
    }));
}

function searchConsoleEvidence(searchConsole: SeoSearchConsoleSnapshot): SeoEvidence[] {
  const evidence: SeoEvidence[] = [];
  if (searchConsole.impressions !== null) {
    evidence.push({ source: "gsc", metric: "impressions", value: searchConsole.impressions, message: `GSC impressions: ${searchConsole.impressions}.` });
  }
  if (searchConsole.clicks !== null) {
    evidence.push({ source: "gsc", metric: "clicks", value: searchConsole.clicks, message: `GSC clicks: ${searchConsole.clicks}.` });
  }
  if (searchConsole.ctr !== null) {
    evidence.push({ source: "gsc", metric: "ctr", value: searchConsole.ctr, message: `GSC CTR: ${searchConsole.ctr}.` });
  }
  if (searchConsole.averagePosition !== null) {
    evidence.push({ source: "gsc", metric: "average_position", value: searchConsole.averagePosition, message: `GSC average position: ${searchConsole.averagePosition}.` });
  }
  for (const query of searchConsole.topQueries.slice(0, 3)) {
    evidence.push({ source: "gsc", metric: "top_query", query, message: `GSC top query: ${query}.` });
  }
  for (const url of searchConsole.topPages.slice(0, 3)) {
    evidence.push({ source: "gsc", metric: "top_page", url, message: `GSC top page: ${url}.` });
  }
  return evidence;
}

function yandexWebmasterEvidence(snapshot: SeoSearchConsoleSnapshot): SeoEvidence[] {
  const evidence: SeoEvidence[] = [];
  if (snapshot.impressions !== null) {
    evidence.push({ source: "yandex_webmaster", metric: "impressions", value: snapshot.impressions, message: `Yandex Webmaster impressions: ${snapshot.impressions}.` });
  }
  if (snapshot.clicks !== null) {
    evidence.push({ source: "yandex_webmaster", metric: "clicks", value: snapshot.clicks, message: `Yandex Webmaster clicks: ${snapshot.clicks}.` });
  }
  if (snapshot.ctr !== null) {
    evidence.push({ source: "yandex_webmaster", metric: "ctr", value: snapshot.ctr, message: `Yandex Webmaster CTR: ${snapshot.ctr}.` });
  }
  if (snapshot.averagePosition !== null) {
    evidence.push({ source: "yandex_webmaster", metric: "average_position", value: snapshot.averagePosition, message: `Yandex Webmaster average position: ${snapshot.averagePosition}.` });
  }
  for (const query of snapshot.topQueries.slice(0, 3)) {
    evidence.push({ source: "yandex_webmaster", metric: "top_query", query, message: `Yandex Webmaster top query: ${query}.` });
  }
  return evidence;
}

function recommendationEvidence(input: {
  recommendation: SeoRecommendation;
  sourceStatuses: SeoSourceStatus[];
  searchConsole: SeoSearchConsoleSnapshot;
  yandexWebmaster: SeoSearchConsoleSnapshot;
  pagespeed: SeoPageSpeedSnapshot;
  crawler: SeoCrawlerSnapshot;
}): SeoEvidence[] {
  const text = `${input.recommendation.type} ${input.recommendation.title} ${input.recommendation.description}`.toLowerCase();
  const evidence: SeoEvidence[] = [];
  const mentionsYandex = text.includes("yandex") || text.includes("webmaster");
  if (text.includes("search console") || (!mentionsYandex && (text.includes("ctr") || text.includes("impression") || text.includes("query")))) {
    evidence.push(...searchConsoleEvidence(input.searchConsole));
    const gsc = input.sourceStatuses.find((item) => item.source === "gsc");
    if (gsc) evidence.push(sourceStatusEvidence(gsc));
  }
  if (mentionsYandex) {
    evidence.push(...yandexWebmasterEvidence(input.yandexWebmaster));
    const yandexWebmaster = input.sourceStatuses.find((item) => item.source === "yandex_webmaster");
    if (yandexWebmaster) evidence.push(sourceStatusEvidence(yandexWebmaster));
  }
  if (text.includes("pagespeed") || text.includes("performance") || text.includes("web vitals")) {
    evidence.push(...pageSpeedEvidence(input.pagespeed));
    const pagespeed = input.sourceStatuses.find((item) => item.source === "pagespeed");
    if (pagespeed) evidence.push(sourceStatusEvidence(pagespeed));
  }
  if (
    text.includes("crawler") ||
    text.includes("title") ||
    text.includes("description") ||
    text.includes("h1") ||
    text.includes("canonical") ||
    text.includes("index") ||
    text.includes("robots") ||
    text.includes("sitemap")
  ) {
    evidence.push(...crawlerEvidence(input.crawler));
    const crawler = input.sourceStatuses.find((item) => item.source === "crawler");
    if (crawler) evidence.push(sourceStatusEvidence(crawler));
  }
  if (evidence.length === 0) {
    const relevantStatus =
      input.sourceStatuses.find((item) => item.source === "sistrix" && item.status === "success") ||
      input.sourceStatuses.find((item) => item.source === "mock" && item.status === "success") ||
      input.sourceStatuses.find((item) => item.source === "crawler" && item.status === "success") ||
      input.sourceStatuses.find((item) => item.status === "failed" || item.status === "partial");
    if (relevantStatus) evidence.push(sourceStatusEvidence(relevantStatus));
  }
  return evidence;
}

function buildHarnessFindings(input: {
  teamId: string;
  companyId: string;
  domain: string;
  opportunities: SeoOpportunity[];
  recommendations: SeoRecommendation[];
  sourceStatuses: SeoSourceStatus[];
  searchConsole: SeoSearchConsoleSnapshot;
  yandexWebmaster: SeoSearchConsoleSnapshot;
  pagespeed: SeoPageSpeedSnapshot;
  crawler: SeoCrawlerSnapshot;
}): SeoFinding[] {
  const opportunityFindings = input.opportunities.map((opportunity, index): SeoFinding => {
    const providerSource =
      input.sourceStatuses.find(
        (status) => (status.source === "sistrix" || status.source === "mock") && status.status === "success"
      )?.source || "harness";
    const evidence: SeoEvidence[] = opportunity.evidence?.length ? opportunity.evidence : [
      {
        source: opportunity.source === "provider" ? providerSource : "harness",
        metric: "opportunity",
        value: opportunity.priority,
        url: opportunity.targetUrl || null,
        message: opportunity.reasoning || opportunity.description,
      },
    ];
    return {
      id: `opportunity-${index + 1}-${slugify(opportunity.title)}`,
      teamId: input.teamId,
      companyId: input.companyId,
      domain: input.domain,
      url: opportunity.targetUrl || null,
      type: opportunity.opportunityType || opportunity.type,
      category: opportunity.type,
      title: opportunity.title,
      description: opportunity.description,
      source: evidence[0].source,
      severity: opportunity.priority,
      confidence: opportunity.confidence,
      evidence,
      recommendation: opportunity.recommendedAction || opportunity.description,
      labels: labelsFromEvidence(evidence, opportunity.source === "heuristic"),
      recommendedAction: opportunity.recommendedAction,
      targetKeywords: opportunity.targetKeywords,
      sourceType: "opportunity",
      sourceId: draftTaskSourceId("opportunity", opportunity.title, opportunity.targetKeywords),
    };
  });

  const recommendationFindings = input.recommendations.map((recommendation, index): SeoFinding => {
    const evidence = recommendation.evidence?.length
      ? recommendation.evidence
      : recommendationEvidence({
          recommendation,
          sourceStatuses: input.sourceStatuses,
          searchConsole: input.searchConsole,
          yandexWebmaster: input.yandexWebmaster,
          pagespeed: input.pagespeed,
          crawler: input.crawler,
        });
    return {
      id: `recommendation-${index + 1}-${slugify(recommendation.title)}`,
      teamId: input.teamId,
      companyId: input.companyId,
      domain: input.domain,
      url: evidence.find((item) => item.url)?.url || null,
      type: recommendation.type,
      category: recommendation.type,
      title: recommendation.title,
      description: recommendation.description,
      source: evidence[0]?.source || "harness",
      severity: recommendation.priority,
      confidence: recommendation.confidence || "medium",
      evidence,
      recommendation: recommendation.description,
      labels: labelsFromEvidence(evidence, true),
      targetKeywords: [],
      sourceType: "recommendation",
      sourceId: draftTaskSourceId("recommendation", recommendation.title, []),
    };
  });

  return [...opportunityFindings, ...recommendationFindings];
}

function createSummary(input: {
  overview: SeoDomainOverview | null;
  keywords: SeoKeywordInsight[];
  competitors: SeoCompetitorInsight[];
  googleChecks?: GoogleRankCheck[];
}) {
  const googleChecks = input.googleChecks || [];
  const googleVisibilityIndex = googleChecks.length > 0
    ? googleChecks.reduce((sum, check) => {
        if (!check.found) return sum;
        const position = Math.max(1, Math.min(100, check.position || 100));
        return sum + Math.max(0, 21 - position) / 20;
      }, 0)
    : null;
  return {
    visibilityIndex: cleanNumber(input.overview?.visibilityIndex) ?? googleVisibilityIndex,
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
  hasRankingSource: boolean;
}): number | null {
  if (!input.hasRankingSource) return null;
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
  let description =
    input.opportunity.recommendedAction ||
    input.opportunity.description ||
    "Review this SEO opportunity and decide on the next action.";

  if (input.opportunity.type === "keyword") {
    const keyword = keywords[0];
    mappedTitle = input.opportunity.title || `Evaluate SEO keyword opportunity: ${keyword}`;
    description =
      input.opportunity.recommendedAction ||
      "Review current ranking, search intent, and content coverage for this keyword.";
  } else if (input.opportunity.type === "competitor") {
    const competitor = title.replace(/^Review competitor gap:\s*/i, "").replace(/^Review organic competitor:\s*/i, "").trim();
    mappedTitle = competitor
      ? `Review organic SEO competitor: ${competitor}`
      : "Review organic SEO competitor";
    description =
      input.opportunity.recommendedAction ||
      "Analyze why this domain appears as an organic competitor and identify content or keyword gaps.";
  } else if (input.opportunity.type === "technical") {
    mappedTitle = title;
    description =
      input.opportunity.recommendedAction ||
      input.opportunity.description ||
      "Review the technical SEO issue and document the required fixes.";
  } else if (input.opportunity.type === "content") {
    mappedTitle = title;
    description =
      input.opportunity.recommendedAction ||
      input.opportunity.description ||
      "Review content coverage and define the next SEO action.";
  }

  if (!mappedTitle.trim()) return null;

  const now = new Date().toISOString();
  return {
    teamId: input.teamId,
    companyId: input.run.companyId,
    runId: input.run.id,
    domain: input.run.domain,
    sourceType: "opportunity",
    sourceId: draftTaskSourceId("opportunity", mappedTitle, keywords),
    sourceFindingId: input.opportunity.sourceFindingId || draftTaskSourceId("opportunity", mappedTitle, keywords),
    evidence: input.opportunity.evidence || [
      {
        source: input.opportunity.source === "provider" ? "sistrix" : "harness",
        metric: "opportunity",
        value: input.opportunity.priority,
        url: input.opportunity.targetUrl || null,
        message: input.opportunity.reasoning || input.opportunity.description,
      },
    ],
    labels: labelsFromEvidence(
      input.opportunity.evidence || [
        {
          source: input.opportunity.source === "provider" ? "sistrix" : "harness",
          message: input.opportunity.reasoning || input.opportunity.description,
        },
      ],
      input.opportunity.source === "heuristic"
    ),
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
    companyId: input.run.companyId,
    runId: input.run.id,
    domain: input.run.domain,
    sourceType: "recommendation",
    sourceId: draftTaskSourceId("recommendation", title, []),
    sourceFindingId: input.recommendation.sourceFindingId || draftTaskSourceId("recommendation", title, []),
    evidence: input.recommendation.evidence || [
      {
        source: "harness",
        metric: "recommendation",
        value: input.recommendation.priority,
        message: input.recommendation.description || title,
      },
    ],
    labels: labelsFromEvidence(input.recommendation.evidence || [], true),
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

function buildDraftTaskFromHarness(input: {
  teamId: string;
  run: SeoAnalysisRun;
  task: SeoHarnessDraftTask;
}): Omit<SeoDraftTask, "id"> | null {
  if (input.task.teamId !== input.teamId || input.task.companyId !== input.run.companyId) return null;
  if (!input.task.sourceFindingId || input.task.evidence.length === 0) return null;
  const title = input.task.title.trim();
  if (!title) return null;
  const now = new Date().toISOString();
  return {
    teamId: input.teamId,
    companyId: input.run.companyId,
    runId: input.run.id,
    domain: input.run.domain,
    sourceType: input.task.sourceType,
    sourceId: input.task.sourceId,
    sourceFindingId: input.task.sourceFindingId,
    evidence: input.task.evidence,
    labels: labelsFromEvidence(input.task.evidence, true),
    title,
    description: input.task.description || "Review this SEO draft task and approve before execution.",
    priority: input.task.priority === "fire" ? "priority" : input.task.priority,
    status: "draft",
    targetKeywords: normalizeKeywords(input.task.targetKeywords),
    suggestedCompanyId: input.run.companyId || null,
    realTaskId: null,
    convertedAt: null,
    convertedByUserId: null,
    createdAt: now,
    updatedAt: now,
  };
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
      message: "Source not selected for this run",
      collectedAt: sourceCollectedAt(),
    };
  }

  if (result.status === "success") {
    return {
      source: result.source,
      status: "success",
      message: result.message,
      collectedAt: result.collectedAt,
      ...(result.metricsSummary ? { metricsSummary: result.metricsSummary } : {}),
    };
  }

  return {
    source: result.source,
    status: result.status,
    message: result.message,
    collectedAt: result.collectedAt,
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    ...(result.metricsSummary ? { metricsSummary: result.metricsSummary } : {}),
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
      message: `${source} source completed successfully`,
      collectedAt: sourceCollectedAt(),
      metricsSummary: rankingMetricsSummary({
        source,
        overview,
        keywordItems: nonEmptyArray(keywordItems),
        competitorItems: nonEmptyArray(competitorItems),
        urlItems: nonEmptyArray(urlItems),
      }),
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
        status: "failed",
        message: err.message,
        errorCode: `${source.toUpperCase()}_NOT_CONFIGURED`,
        collectedAt: sourceCollectedAt(),
      };
    }
    if (err instanceof SeoProviderError) {
      return {
        source,
        status: "failed",
        message: err.safeMessage,
        errorCode: providerErrorCode(err),
        collectedAt: sourceCollectedAt(),
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
      message: "pagespeed source completed successfully",
      collectedAt: sourceCollectedAt(),
      metricsSummary: pageSpeedMetricsSummary(snapshot),
      data: snapshot,
    };
  } catch (err) {
    if (err instanceof SeoProviderNotConfiguredError) {
      return {
        source: "pagespeed",
        status: "failed",
        message: err.message,
        errorCode: "PAGESPEED_NOT_CONFIGURED",
        collectedAt: sourceCollectedAt(),
      };
    }
    if (err instanceof SeoProviderError) {
      return {
        source: "pagespeed",
        status: err.category === "pagespeed_rate_limit" ? "partial" : "failed",
        message: err.safeMessage,
        errorCode: providerErrorCode(err),
        collectedAt: sourceCollectedAt(),
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
      message: "crawler source completed successfully",
      collectedAt: sourceCollectedAt(),
      metricsSummary: crawlerMetricsSummary(snapshot),
      data: snapshot,
    };
  } catch (err) {
    if (err instanceof SeoProviderNotConfiguredError) {
      return {
        source: "crawler",
        status: "failed",
        message: err.message,
        errorCode: "CRAWLER_NOT_CONFIGURED",
        collectedAt: sourceCollectedAt(),
      };
    }
    if (err instanceof SeoProviderError) {
      return {
        source: "crawler",
        status: "failed",
        message: err.safeMessage,
        errorCode: providerErrorCode(err),
        collectedAt: sourceCollectedAt(),
      };
    }
    throw err;
  }
}

async function runGscSource(providerInput: Pick<SeoProviderInput, "domain" | "teamId" | "gscSiteUrl">): Promise<ExecutedSourceResult> {
  try {
    const snapshot = await new GoogleSearchConsoleSeoSource().getSnapshot(providerInput.domain, {
      teamId: providerInput.teamId,
      siteUrl: providerInput.gscSiteUrl,
    });
    return {
      source: "gsc",
      status: "success",
      message: "gsc source completed successfully",
      collectedAt: sourceCollectedAt(),
      metricsSummary: gscMetricsSummary(snapshot),
      data: snapshot,
    };
  } catch (err) {
    if (err instanceof SeoProviderNotConfiguredError) {
      return {
        source: "gsc",
        status: "skipped",
        message: err.message,
        errorCode: "GSC_NOT_CONFIGURED",
        collectedAt: sourceCollectedAt(),
      };
    }
    if (err instanceof SeoProviderError) {
      return {
        source: "gsc",
        status: "failed",
        message: err.safeMessage,
        errorCode: providerErrorCode(err),
        collectedAt: sourceCollectedAt(),
      };
    }
    throw err;
  }
}

async function runYandexWebmasterSource(
  providerInput: Pick<SeoProviderInput, "domain" | "auditedOrigin" | "device">
): Promise<ExecutedSourceResult> {
  try {
    if (!providerInput.auditedOrigin) {
      throw new SeoProviderNotConfiguredError("Yandex Webmaster requires an explicit audited HTTP(S) origin");
    }
    const snapshot = await new YandexWebmasterSeoSource().getSnapshot(providerInput.auditedOrigin, {
      device: providerInput.device,
    });
    return {
      source: "yandex_webmaster",
      status: "success",
      message: "Yandex Webmaster source completed successfully",
      collectedAt: sourceCollectedAt(),
      metricsSummary: yandexWebmasterMetricsSummary(snapshot),
      data: snapshot,
    };
  } catch (err) {
    if (err instanceof SeoProviderNotConfiguredError) {
      return {
        source: "yandex_webmaster",
        status: "skipped",
        message: err.message,
        errorCode: "YANDEX_WEBMASTER_NOT_CONFIGURED",
        collectedAt: sourceCollectedAt(),
      };
    }
    if (err instanceof SeoProviderError) {
      return {
        source: "yandex_webmaster",
        status: "failed",
        message: err.safeMessage,
        errorCode: providerErrorCode(err),
        collectedAt: sourceCollectedAt(),
      };
    }
    throw err;
  }
}

async function runGoogleSerpRankSource(providerInput: SeoProviderInput): Promise<ExecutedSourceResult> {
  try {
    const result = await new GoogleSerpRankSource().run({
      targetDomain: providerInput.domain,
      targetDomainAliases: providerInput.targetDomainAliases,
      keywords: providerInput.trackingKeywords,
      location: providerInput.location,
      language: providerInput.language,
      device: providerInput.device,
    });

    const collectedAt = sourceCollectedAt();
    if (result.status.state === "connected") {
      return {
        source: "google_serp_rank",
        status: "success",
        message: result.status.message,
        collectedAt,
        metricsSummary: rankTrackingMetricsSummary(result.status),
        data: {
          provider: "dataforseo",
          checks: result.checks,
          status: result.status,
        },
      };
    }

    return {
      source: "google_serp_rank",
      status:
        result.status.state === "partial_success"
          ? "partial"
          : result.status.state === "missing_credentials" || result.status.state === "no_keywords"
            ? "skipped"
            : "failed",
      message: result.status.message,
      collectedAt,
      ...(result.status.errorCode ? { errorCode: result.status.errorCode } : {}),
      metricsSummary: rankTrackingMetricsSummary(result.status),
      data: {
        provider: "dataforseo",
        checks: result.checks,
        status: result.status,
      },
    };
  } catch (err) {
    if (err instanceof SeoProviderError) {
      const status = rankTrackingProviderStatusFromError({
        source: "google_serp_rank",
        error: err,
      });
      return {
        source: "google_serp_rank",
        status: status.state === "limit_exceeded" ? "partial" : "failed",
        message: status.message,
        collectedAt: sourceCollectedAt(),
        ...(status.errorCode ? { errorCode: status.errorCode } : {}),
        metricsSummary: rankTrackingMetricsSummary(status),
        data: {
          provider: "dataforseo",
          checks: [],
          status,
        },
      };
    }
    throw err;
  }
}

async function runYandexSerpRankSource(providerInput: SeoProviderInput): Promise<ExecutedSourceResult> {
  try {
    const result = await new YandexSerpRankSource().run({
      targetDomain: providerInput.domain,
      targetDomainAliases: providerInput.targetDomainAliases,
      keywords: providerInput.trackingKeywords,
      region: providerInput.region,
      language: providerInput.language,
      device: providerInput.device,
    });

    const collectedAt = sourceCollectedAt();
    if (result.status.state === "connected") {
      return {
        source: "yandex_serp_rank",
        status: "success",
        message: result.status.message,
        collectedAt,
        metricsSummary: rankTrackingMetricsSummary(result.status),
        data: {
          provider: "yandex_search_api",
          checks: result.checks,
          status: result.status,
        },
      };
    }

    return {
      source: "yandex_serp_rank",
      status:
        result.status.state === "partial_success"
          ? "partial"
          : result.status.state === "missing_credentials" || result.status.state === "no_keywords"
            ? "skipped"
            : "failed",
      message: result.status.message,
      collectedAt,
      ...(result.status.errorCode ? { errorCode: result.status.errorCode } : {}),
      metricsSummary: rankTrackingMetricsSummary(result.status),
      data: {
        provider: "yandex_search_api",
        checks: result.checks,
        status: result.status,
      },
    };
  } catch (err) {
    if (err instanceof SeoProviderError) {
      const status = rankTrackingProviderStatusFromError({
        source: "yandex_serp_rank",
        error: err,
      });
      return {
        source: "yandex_serp_rank",
        status: status.state === "limit_exceeded" ? "partial" : "failed",
        message: status.message,
        collectedAt: sourceCollectedAt(),
        ...(status.errorCode ? { errorCode: status.errorCode } : {}),
        metricsSummary: rankTrackingMetricsSummary(status),
        data: {
          provider: "yandex_search_api",
          checks: [],
          status,
        },
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
  if (source === "yandex_webmaster") return runYandexWebmasterSource(providerInput);
  if (source === "google_serp_rank") return runGoogleSerpRankSource(providerInput);
  if (source === "yandex_serp_rank") return runYandexSerpRankSource(providerInput);
  return runGscSource(providerInput);
}

export async function runSeoAnalysis(input: SeoAnalysisInput): Promise<SeoAnalysisRun> {
  const selection = resolveSeoSourceSelection(input.sources);
  const shouldPreloadGscKeywords =
    selection.selectedSources.includes("gsc") &&
    selection.selectedSources.some((source) => source === "google_serp_rank" || source === "yandex_serp_rank") &&
    normalizeRankTrackingKeywords([
      ...nonEmptyArray(input.keywords),
      ...input.config.trackingKeywords,
      ...input.config.brandKeywords,
    ]).length === 0;

  const preExecuted: ExecutedSourceResult[] = [];
  let gscSeedQueries: string[] = [];
  if (shouldPreloadGscKeywords) {
    const gscSeed = await runGscSource({
      domain: normalizeProviderDomain(input.config.domain),
      teamId: input.teamId,
      gscSiteUrl: input.config.gscSiteUrl,
    });
    preExecuted.push(gscSeed);
    if (gscSeed.status === "success" && gscSeed.data) {
      gscSeedQueries = (gscSeed.data as SeoSearchConsoleSnapshot).topQueries;
    }
  }

  const providerInput: SeoProviderInput = {
    teamId: input.teamId,
    companyId: input.companyId,
    domain: normalizeProviderDomain(input.config.domain),
    auditedOrigin: resolveProviderAuditedOrigin(input.config.domain, input.config.gscSiteUrl),
    gscSiteUrl: input.config.gscSiteUrl,
    targetDomainAliases:
      input.config.targetDomainAliases.length > 0
        ? input.config.targetDomainAliases
        : [input.config.domain, `www.${normalizeProviderDomain(input.config.domain)}`],
    market: input.config.markets[0] || "AT",
    language: String(input.language || "").trim() || input.config.languages[0] || "de",
    competitors: input.config.competitors,
    importantSections: input.config.importantSections,
    trackingKeywords: selectRankTrackingKeywords({
      requestKeywords: input.keywords,
      configTrackingKeywords: input.config.trackingKeywords,
      configBrandKeywords: input.config.brandKeywords,
      gscTopQueries: gscSeedQueries,
    }),
    location: String(input.location || "").trim() || input.config.targetLocation || input.config.markets[0] || null,
    region: String(input.region || "").trim() || input.config.targetRegion || input.config.markets[0] || null,
    device: readTargetDevice(input.device ?? input.config.targetDevice),
    mode: input.mode,
  };

  const remainingSources = selection.selectedSources.filter(
    (source) => !(shouldPreloadGscKeywords && source === "gsc")
  );
  const executed = [
    ...preExecuted,
    ...(await Promise.all(remainingSources.map((source) => executeSelectedSource(source, providerInput)))),
  ];

  const sourceStatuses = KNOWN_SOURCE_NAMES.map((source) => {
    const result = executed.find((item) => item.source === source);
    if (!result) {
      return toSourceStatus(
        {
          source,
          status: "failed",
          message: "Source execution missing",
          collectedAt: sourceCollectedAt(),
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
  const yandexWebmaster =
    (successfulResults.find((item) => item.source === "yandex_webmaster")?.data as SeoSearchConsoleSnapshot | undefined) ??
    emptySearchConsoleSnapshot();
  const pagespeed =
    (successfulResults.find((item) => item.source === "pagespeed")?.data as SeoPageSpeedSnapshot | undefined) ??
    emptyPageSpeedSnapshot();
  const crawler =
    (successfulResults.find((item) => item.source === "crawler")?.data as SeoCrawlerSnapshot | undefined) ??
    emptyCrawlerSnapshot();
  const googleRankResult = executed.find((item) => item.source === "google_serp_rank");
  const yandexRankResult = executed.find((item) => item.source === "yandex_serp_rank");
  const rankTracking: SeoRankTrackingSnapshot = {
    ...(googleRankResult?.data &&
    "provider" in googleRankResult.data &&
    googleRankResult.data.provider === "dataforseo"
      ? {
          google: {
            provider: "dataforseo",
            checks: googleRankResult.data.checks as GoogleRankCheck[],
            status: googleRankResult.data.status,
          },
        }
      : {}),
    ...(yandexRankResult?.data &&
    "provider" in yandexRankResult.data &&
    yandexRankResult.data.provider === "yandex_search_api"
      ? {
          yandex: {
            provider: "yandex_search_api",
            checks: yandexRankResult.data.checks as YandexRankCheck[],
            status: yandexRankResult.data.status,
          },
        }
      : {}),
  };

  const overview = rankingPayloads[0]?.overview ?? null;
  const googleChecks = rankTracking.google?.checks || [];
  const keywordItems = rankingPayloads.flatMap((item) => item.keywordItems);
  const competitorItems = rankingPayloads.flatMap((item) => item.competitorItems);
  const urlItems = rankingPayloads.flatMap((item) => item.urlItems);

  const usableSources = sourceStatuses.filter((item) => item.status === "success" || item.status === "partial");
  const successfulSources = sourceStatuses.filter((item) => item.status === "success");
  const hasRankingSource = successfulSources.some(
    (item) => item.source === "google_serp_rank" || item.source === "mock" || item.source === "sistrix"
  );
  if (usableSources.length === 0) {
    const primaryFailure = executed[0];
    if (selection.mode === "single" && (primaryFailure?.status === "failed" || primaryFailure?.status === "partial")) {
      throw new SeoProviderError({
        category: "seo_source_failed",
        safeMessage: primaryFailure.message,
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
  const gscOpportunities = generateGscOpportunities({
    domain: providerInput.domain,
    market: providerInput.market,
    language: providerInput.language,
    snapshot: searchConsole,
  });
  const opportunities = dedupeOpportunities([
    ...createKeywordOpportunities(keywordItems),
    ...createCompetitorOpportunities(competitorItems),
    ...createUrlOpportunities(urlItems),
    ...gscOpportunities,
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
      yandexWebmaster,
      pagespeed,
      crawler,
    })
  );
  const summary = createSummary({ overview, keywords, competitors, googleChecks });
  const visibility = {
    visibilityIndex: summary.visibilityIndex,
    trend: overview?.trend ?? "unknown",
    notes: uniqueStrings([
      ...rankingPayloads.flatMap((item) => nonEmptyArray(item.overview.notes)),
      ...(hasRankingSource ? [] : ["Visibility and competitor scoring require a successful DataForSEO Google ranking source."]),
    ]),
  } as const;
  const technical = createTechnicalSnapshot({ crawler, pagespeed });
  const visibilityScore = scoreVisibility(summary.visibilityIndex);
  const opportunityScore = scoreOpportunity(opportunities);
  const competitorPressureScore = scoreCompetitorPressure({
    competitors,
    domainVisibilityIndex: summary.visibilityIndex,
    hasRankingSource,
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
  const harnessResult = runSeoHarness({
    domain: providerInput.domain,
    teamId: input.teamId,
    companyId: input.companyId,
    sourceStatuses,
    normalizedSourceOutputs: {
      searchConsole,
      yandexWebmaster,
      pagespeed,
      crawler,
      rankTracking,
      keywords,
      opportunities,
      recommendations,
      technical,
      sourceStatuses,
    },
    llmFindings: buildHarnessFindings({
      teamId: input.teamId,
      companyId: input.companyId,
      domain: providerInput.domain,
      opportunities,
      recommendations,
      sourceStatuses,
      searchConsole,
      yandexWebmaster,
      pagespeed,
      crawler,
    }),
  });

  const run = await createSeoAnalysisRun({
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
    yandexWebmaster,
    rankTracking,
    pagespeed,
    crawler,
    findings: harnessResult.findings,
    opportunities,
    recommendations,
    harness: {
      selectedSkills: harnessResult.selectedSkills,
      warnings: harnessResult.warnings,
      blockedActions: harnessResult.blockedActions,
      confidenceSummary: harnessResult.confidenceSummary,
      draftTasks: harnessResult.draftTasks,
    },
    scores,
    createdByUserId: input.createdByUserId,
  });
  await generateSeoDraftTasksForRun(input.teamId, run.id);
  return run;
}

export async function approveSeoRun(teamId: string, runId: string): Promise<void> {
  const updated = await updateSeoAnalysisRunStatusForTeam(teamId, runId, "approved");
  if (!updated) throw new SeoDraftTaskError("SEO analysis run not found", 404);
}

export async function generateSeoDraftTasksForRun(teamId: string, runId: string): Promise<SeoDraftTask[]> {
  const run = await findSeoAnalysisRunByTeamAndId(teamId, runId);
  if (!run) {
    throw new SeoDraftTaskError("SEO analysis run not found", 404);
  }
  if (run.status === "failed") {
    throw new SeoDraftTaskError("Cannot generate draft tasks for a failed SEO analysis run", 400);
  }

  const existing = await listSeoDraftTasksByRun(teamId, runId);
  if (existing.length > 0) return existing;

  if (run.harness.draftTasks.length > 0) {
    const harnessGenerated = dedupeDraftTasks(
      run.harness.draftTasks
        .map((task) => buildDraftTaskFromHarness({ teamId, run, task }))
        .filter(Boolean) as Array<Omit<SeoDraftTask, "id">>
    );
    if (harnessGenerated.length > 0) return createSeoDraftTasks({ teamId, tasks: harnessGenerated });
  }

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
  const run = await findSeoAnalysisRunByTeamAndId(teamId, runId);
  if (!run) {
    throw new SeoDraftTaskError("SEO analysis run not found", 404);
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
    if (existingTask && existingTask.teamId === input.teamId && existingTask.companyId === draftTask.companyId) {
      return { draftTask, task: existingTask };
    }
    throw new SeoDraftTaskError("SEO draft task is already linked to a real task", 409);
  }

  const requestedCompanyId =
    typeof input.options.companyId === "string" ? input.options.companyId.trim() : draftTask.companyId;
  if (!requestedCompanyId || requestedCompanyId !== draftTask.companyId) {
    throw new SeoDraftTaskError("SEO draft tasks must be created for their analysis Company", 400);
  }
  const company = await getCompanyById(requestedCompanyId);
  if (!company) {
    throw new SeoDraftTaskError("Company not found", 404);
  }
  if (company.teamId !== input.teamId) {
    throw new SeoDraftTaskError("Access denied", 403);
  }

  const resolvedCompanyId = company.id;
  const visibility = input.options.visibility ?? defaultVisibility(resolvedCompanyId);
  if (visibility !== "private" && visibility !== "team") {
    throw new SeoDraftTaskError("Invalid visibility", 400);
  }
  if (resolvedCompanyId && visibility !== "team") {
    throw new SeoDraftTaskError("Company SEO tasks must use team visibility", 400);
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
    draftTask.labels.length ? `Labels: ${draftTask.labels.join("; ")}` : "",
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
