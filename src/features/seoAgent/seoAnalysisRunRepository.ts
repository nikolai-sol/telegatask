import { firestore } from "../../config/firebase";
import type {
  SeoAnalysisMode,
  SeoAnalysisRun,
  SeoAnalysisScores,
  SeoAnalysisSummary,
  SeoAnalysisStatus,
  SeoCompetitorInsight,
  SeoCrawlerSnapshot,
  SeoKeywordInsight,
  SeoOpportunity,
  SeoPageSpeedSnapshot,
  SeoRecommendation,
  SeoSearchConsoleSnapshot,
  SeoSourceName,
  SeoSourceStatus,
  SeoTechnicalSnapshot,
  SeoVisibilitySnapshot,
} from "./types";

const collection = firestore.collection("seoAnalysisRuns");

function normalizeMode(value: unknown): SeoAnalysisMode {
  const raw = String(value || "").trim();
  if (raw === "content_gap" || raw === "keyword_strategy" || raw === "daily_brief") return raw;
  return "quick_audit";
}

function normalizeStatus(value: unknown): SeoAnalysisStatus {
  const raw = String(value || "").trim();
  if (raw === "approved" || raw === "rejected" || raw === "failed") return raw;
  return "draft";
}

function cleanNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function toBooleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeSources(value: unknown): SeoSourceName[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(
      (item): item is SeoSourceName =>
        item === "mock" || item === "sistrix" || item === "pagespeed" || item === "crawler" || item === "gsc"
    );
}

function normalizeSourceStatuses(value: unknown): SeoSourceStatus[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const data = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const source = String(data.source || "").trim();
      const status = String(data.status || "").trim();
      if (
        (source !== "mock" &&
          source !== "sistrix" &&
          source !== "pagespeed" &&
          source !== "crawler" &&
          source !== "gsc") ||
        (status !== "success" &&
          status !== "skipped" &&
          status !== "failed" &&
          status !== "not_configured")
      ) {
        return null;
      }

      const safeMessage = String(data.safeMessage || "").trim();
      return {
        source,
        status,
        ...(safeMessage ? { safeMessage } : {}),
      } satisfies SeoSourceStatus;
    })
    .filter(Boolean) as SeoSourceStatus[];
}

function normalizeSummary(value: unknown): SeoAnalysisSummary {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    visibilityIndex: cleanNumber(data.visibilityIndex),
    keywordCount: cleanNumber(data.keywordCount),
    competitorCount: cleanNumber(data.competitorCount),
  };
}

function normalizeVisibility(value: unknown): SeoVisibilitySnapshot {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const trend = String(data.trend || "").trim();
  return {
    visibilityIndex: cleanNumber(data.visibilityIndex),
    trend: trend === "up" || trend === "flat" || trend === "down" ? trend : "unknown",
    notes: toStringArray(data.notes),
  };
}

function normalizeScores(value: unknown): SeoAnalysisScores {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    visibilityScore: cleanNumber(data.visibilityScore),
    opportunityScore: cleanNumber(data.opportunityScore),
    competitorPressureScore: cleanNumber(data.competitorPressureScore),
    overallSeoScore: cleanNumber(data.overallSeoScore),
  };
}

function normalizeTechnical(value: unknown): SeoTechnicalSnapshot {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    issueCount: cleanNumber(data.issueCount),
    highlights: toStringArray(data.highlights),
  };
}

function normalizeSearchConsole(value: unknown): SeoSearchConsoleSnapshot {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    siteUrl: typeof data.siteUrl === "string" && data.siteUrl.trim() ? data.siteUrl.trim() : null,
    clicks: cleanNumber(data.clicks),
    impressions: cleanNumber(data.impressions),
    ctr: cleanNumber(data.ctr),
    averagePosition: cleanNumber(data.averagePosition),
    topQueries: toStringArray(data.topQueries),
    topPages: toStringArray(data.topPages),
    countries: toStringArray(data.countries),
    devices: toStringArray(data.devices),
  };
}

function normalizePageSpeed(value: unknown): SeoPageSpeedSnapshot {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    pageUrl: typeof data.pageUrl === "string" && data.pageUrl.trim() ? data.pageUrl.trim() : null,
    performanceScore: cleanNumber(data.performanceScore),
    accessibilityScore: cleanNumber(data.accessibilityScore),
    bestPracticesScore: cleanNumber(data.bestPracticesScore),
    seoScore: cleanNumber(data.seoScore),
    largestContentfulPaintMs: cleanNumber(data.largestContentfulPaintMs),
    cumulativeLayoutShift: cleanNumber(data.cumulativeLayoutShift),
    interactionToNextPaintMs: cleanNumber(data.interactionToNextPaintMs),
    totalBlockingTimeMs: cleanNumber(data.totalBlockingTimeMs),
  };
}

function normalizeCrawler(value: unknown): SeoCrawlerSnapshot {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    pageUrl: typeof data.pageUrl === "string" && data.pageUrl.trim() ? data.pageUrl.trim() : null,
    finalUrl: typeof data.finalUrl === "string" && data.finalUrl.trim() ? data.finalUrl.trim() : null,
    httpStatus: cleanNumber(data.httpStatus),
    hasTitle: toBooleanOrNull(data.hasTitle),
    hasMetaDescription: toBooleanOrNull(data.hasMetaDescription),
    hasH1: toBooleanOrNull(data.hasH1),
    hasCanonical: toBooleanOrNull(data.hasCanonical),
    robotsTxtReachable: toBooleanOrNull(data.robotsTxtReachable),
    sitemapXmlReachable: toBooleanOrNull(data.sitemapXmlReachable),
    isIndexable: toBooleanOrNull(data.isIndexable),
  };
}

function docToSeoAnalysisRun(id: string, data: FirebaseFirestore.DocumentData): SeoAnalysisRun {
  return {
    id,
    teamId: String(data.teamId || ""),
    companyId: String(data.companyId || ""),
    configId: String(data.configId || ""),
    mode: normalizeMode(data.mode),
    status: normalizeStatus(data.status),
    provider: String(data.provider || ""),
    sources: normalizeSources(data.sources),
    sourceStatuses: normalizeSourceStatuses(data.sourceStatuses),
    domain: String(data.domain || ""),
    summary: normalizeSummary(data.summary),
    visibility: normalizeVisibility(data.visibility),
    keywords: Array.isArray(data.keywords) ? (data.keywords as SeoKeywordInsight[]) : [],
    competitors: Array.isArray(data.competitors) ? (data.competitors as SeoCompetitorInsight[]) : [],
    technical: normalizeTechnical(data.technical),
    searchConsole: normalizeSearchConsole(data.searchConsole),
    pagespeed: normalizePageSpeed(data.pagespeed),
    crawler: normalizeCrawler(data.crawler),
    opportunities: Array.isArray(data.opportunities) ? (data.opportunities as SeoOpportunity[]) : [],
    recommendations: Array.isArray(data.recommendations) ? (data.recommendations as SeoRecommendation[]) : [],
    scores: normalizeScores(data.scores),
    createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
    createdByUserId: String(data.createdByUserId || ""),
  };
}

export async function createSeoAnalysisRun(input: {
  teamId: string;
  companyId: string;
  configId: string;
  mode: SeoAnalysisMode;
  provider: string;
  sources: SeoSourceName[];
  sourceStatuses: SeoSourceStatus[];
  domain: string;
  summary: SeoAnalysisSummary;
  visibility: SeoVisibilitySnapshot;
  keywords: SeoKeywordInsight[];
  competitors: SeoCompetitorInsight[];
  technical: SeoTechnicalSnapshot;
  searchConsole: SeoSearchConsoleSnapshot;
  pagespeed: SeoPageSpeedSnapshot;
  crawler: SeoCrawlerSnapshot;
  opportunities: SeoOpportunity[];
  recommendations: SeoRecommendation[];
  scores: SeoAnalysisScores;
  createdByUserId: string;
}): Promise<SeoAnalysisRun> {
  const payload = {
    teamId: input.teamId,
    companyId: input.companyId,
    configId: input.configId,
    mode: input.mode,
    status: "draft" as SeoAnalysisStatus,
    provider: input.provider,
    sources: input.sources,
    sourceStatuses: input.sourceStatuses,
    domain: input.domain,
    summary: input.summary,
    visibility: input.visibility,
    keywords: input.keywords,
    competitors: input.competitors,
    technical: input.technical,
    searchConsole: input.searchConsole,
    pagespeed: input.pagespeed,
    crawler: input.crawler,
    opportunities: input.opportunities,
    recommendations: input.recommendations,
    scores: input.scores,
    createdAt: Date.now(),
    createdByUserId: input.createdByUserId,
  };
  const ref = await collection.add(payload);
  return { id: ref.id, ...payload };
}

export async function findSeoAnalysisRunById(id: string): Promise<SeoAnalysisRun | null> {
  const snap = await collection.doc(id).get();
  if (!snap.exists) return null;
  return docToSeoAnalysisRun(snap.id, snap.data() || {});
}

export async function updateSeoAnalysisRunStatus(
  id: string,
  status: SeoAnalysisStatus
): Promise<void> {
  await collection.doc(id).set({ status }, { merge: true });
}
