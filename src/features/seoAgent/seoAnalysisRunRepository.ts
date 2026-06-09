import { firestore } from "../../config/firebase";
import type {
  SeoAnalysisMode,
  SeoAnalysisRun,
  SeoAnalysisScores,
  SeoAnalysisSummary,
  SeoAnalysisStatus,
  SeoCompetitorInsight,
  SeoCrawlerSnapshot,
  SeoHarnessMetadata,
  SeoFinding,
  SeoKeywordInsight,
  GoogleRankCheck,
  SeoRankProviderStatus,
  SeoRankTrackingSnapshot,
  SeoOpportunity,
  SeoPageSpeedSnapshot,
  SeoRecommendation,
  SeoSearchConsoleSnapshot,
  SeoSourceName,
  SeoSourceStatus,
  SeoTechnicalSnapshot,
  SeoVisibilitySnapshot,
  YandexRankCheck,
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
        item === "mock" ||
        item === "sistrix" ||
        item === "pagespeed" ||
        item === "crawler" ||
        item === "gsc" ||
        item === "google_serp_rank" ||
        item === "yandex_serp_rank"
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
          source !== "gsc" &&
          source !== "google_serp_rank" &&
          source !== "yandex_serp_rank") ||
        (status !== "success" &&
          status !== "partial" &&
          status !== "failed" &&
          status !== "skipped")
      ) {
        return null;
      }

      const message = String(data.message || "").trim();
      const errorCode = String(data.errorCode || "").trim();
      const collectedAt = cleanNumber(data.collectedAt) ?? Date.now();
      const metricsSummary =
        data.metricsSummary && typeof data.metricsSummary === "object"
          ? Object.fromEntries(
              Object.entries(data.metricsSummary as Record<string, unknown>).flatMap(([key, rawValue]) => {
                if (!key.trim()) return [];
                if (
                  rawValue === null ||
                  typeof rawValue === "string" ||
                  typeof rawValue === "number" ||
                  typeof rawValue === "boolean"
                ) {
                  return [[key, rawValue]];
                }
                return [];
              })
            )
          : undefined;
      return {
        source,
        status,
        message: message || "No source message recorded",
        collectedAt,
        ...(errorCode ? { errorCode } : {}),
        ...(metricsSummary && Object.keys(metricsSummary).length > 0 ? { metricsSummary } : {}),
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
    property: typeof data.property === "string" && data.property.trim() ? data.property.trim() : null,
    siteUrl: typeof data.siteUrl === "string" && data.siteUrl.trim() ? data.siteUrl.trim() : null,
    dateRange: {
      startDate:
        data.dateRange &&
        typeof data.dateRange === "object" &&
        typeof (data.dateRange as Record<string, unknown>).startDate === "string" &&
        String((data.dateRange as Record<string, unknown>).startDate).trim()
          ? String((data.dateRange as Record<string, unknown>).startDate).trim()
          : null,
      endDate:
        data.dateRange &&
        typeof data.dateRange === "object" &&
        typeof (data.dateRange as Record<string, unknown>).endDate === "string" &&
        String((data.dateRange as Record<string, unknown>).endDate).trim()
          ? String((data.dateRange as Record<string, unknown>).endDate).trim()
          : null,
      days:
        data.dateRange &&
        typeof data.dateRange === "object"
          ? cleanNumber((data.dateRange as Record<string, unknown>).days)
          : null,
    },
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

function normalizeRankProviderStatus(value: unknown): SeoRankProviderStatus | null {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const state = String(data.state || "").trim();
  if (
    state !== "connected" &&
    state !== "missing_credentials" &&
    state !== "no_keywords" &&
    state !== "provider_error" &&
    state !== "limit_exceeded" &&
    state !== "partial_success"
  ) {
    return null;
  }
  const message = String(data.message || "").trim() || "No rank tracking status message recorded";
  const errorCode = String(data.errorCode || "").trim();
  const checkedAt = typeof data.checkedAt === "string" && data.checkedAt.trim() ? data.checkedAt.trim() : new Date().toISOString();
  const metricsSummary =
    data.metricsSummary && typeof data.metricsSummary === "object"
      ? Object.fromEntries(
          Object.entries(data.metricsSummary as Record<string, unknown>).flatMap(([key, rawValue]) => {
            if (!key.trim()) return [];
            if (
              rawValue === null ||
              typeof rawValue === "string" ||
              typeof rawValue === "number" ||
              typeof rawValue === "boolean"
            ) {
              return [[key, rawValue]];
            }
            return [];
          })
        )
      : undefined;
  return {
    state,
    message,
    checkedAt,
    ...(errorCode ? { errorCode } : {}),
    ...(metricsSummary && Object.keys(metricsSummary).length > 0 ? { metricsSummary } : {}),
  };
}

function normalizeCompetitorsAbove(value: unknown): Array<{ position: number; domain: string; url: string; title?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const data = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const position = cleanNumber(data.position);
      const domain = typeof data.domain === "string" ? data.domain.trim() : "";
      const url = typeof data.url === "string" ? data.url.trim() : "";
      const title = typeof data.title === "string" && data.title.trim() ? data.title.trim() : undefined;
      if (position === null || !domain || !url) return null;
      return { position, domain, url, ...(title ? { title } : {}) };
    })
    .filter(Boolean) as Array<{ position: number; domain: string; url: string; title?: string }>;
}

function normalizeSerpChecks(value: unknown, searchEngine: "google"): GoogleRankCheck[];
function normalizeSerpChecks(value: unknown, searchEngine: "yandex"): YandexRankCheck[];
function normalizeSerpChecks(value: unknown, searchEngine: "google" | "yandex"): Array<GoogleRankCheck | YandexRankCheck> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const data = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const query = typeof data.query === "string" ? data.query.trim() : "";
      const targetDomain = typeof data.targetDomain === "string" ? data.targetDomain.trim() : "";
      const checkedAt = typeof data.checkedAt === "string" && data.checkedAt.trim() ? data.checkedAt.trim() : new Date().toISOString();
      const device = data.device === "mobile" ? "mobile" : "desktop";
      if (!query || !targetDomain) return null;
      return {
        query,
        searchEngine,
        provider:
          data.provider === "yandex_search_api"
            ? "yandex_search_api"
            : "dataforseo",
        targetDomain,
        found: Boolean(data.found),
        ...(cleanNumber(data.position) !== null ? { position: cleanNumber(data.position)! } : {}),
        ...(typeof data.matchedUrl === "string" && data.matchedUrl.trim() ? { matchedUrl: data.matchedUrl.trim() } : {}),
        ...(typeof data.title === "string" && data.title.trim() ? { title: data.title.trim() } : {}),
        ...(typeof data.snippet === "string" && data.snippet.trim() ? { snippet: data.snippet.trim() } : {}),
        ...(normalizeCompetitorsAbove(data.competitorsAbove).length > 0
          ? { competitorsAbove: normalizeCompetitorsAbove(data.competitorsAbove) }
          : {}),
        ...(Array.isArray(data.serpFeatures) ? { serpFeatures: toStringArray(data.serpFeatures) } : {}),
        ...(Array.isArray(data.topResultDomains) ? { topResultDomains: toStringArray(data.topResultDomains).slice(0, 5) } : {}),
        ...(typeof data.location === "string" && data.location.trim() ? { location: data.location.trim() } : {}),
        ...(typeof data.region === "string" && data.region.trim() ? { region: data.region.trim() } : {}),
        ...(typeof data.language === "string" && data.language.trim() ? { language: data.language.trim() } : {}),
        device,
        checkedAt,
      };
    })
    .filter(Boolean) as Array<GoogleRankCheck | YandexRankCheck>;
}

function normalizeRankTracking(value: unknown): SeoRankTrackingSnapshot {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const googleData = data.google && typeof data.google === "object" ? (data.google as Record<string, unknown>) : null;
  const yandexData = data.yandex && typeof data.yandex === "object" ? (data.yandex as Record<string, unknown>) : null;
  return {
    ...(googleData && normalizeRankProviderStatus(googleData.status)
      ? {
          google: {
            provider: "dataforseo" as const,
            checks: normalizeSerpChecks(googleData.checks, "google"),
            status: normalizeRankProviderStatus(googleData.status)!,
          },
        }
      : {}),
    ...(yandexData && normalizeRankProviderStatus(yandexData.status)
      ? {
          yandex: {
            provider: "yandex_search_api" as const,
            checks: normalizeSerpChecks(yandexData.checks, "yandex"),
            status: normalizeRankProviderStatus(yandexData.status)!,
          },
        }
      : {}),
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

function normalizeHarness(value: unknown): SeoHarnessMetadata {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const confidence = data.confidenceSummary && typeof data.confidenceSummary === "object"
    ? (data.confidenceSummary as Record<string, unknown>)
    : {};
  return {
    selectedSkills: Array.isArray(data.selectedSkills)
      ? data.selectedSkills
          .map((item) => {
            const skill = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
            return {
              id: String(skill.id || "").trim(),
              title: String(skill.title || "").trim(),
              score: cleanNumber(skill.score) || 0,
            };
          })
          .filter((item) => item.id && item.title)
      : [],
    warnings: toStringArray(data.warnings),
    blockedActions: Array.isArray(data.blockedActions)
      ? data.blockedActions.map((item) => {
          const action = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          return {
            action: String(action.action || ""),
            reason: String(action.reason || ""),
            ...(typeof action.sourceFindingId === "string" && action.sourceFindingId.trim()
              ? { sourceFindingId: action.sourceFindingId.trim() }
              : {}),
            ...(typeof action.title === "string" && action.title.trim() ? { title: action.title.trim() } : {}),
          };
        })
      : [],
    confidenceSummary: {
      high: cleanNumber(confidence.high) || 0,
      medium: cleanNumber(confidence.medium) || 0,
      low: cleanNumber(confidence.low) || 0,
    },
    draftTasks: Array.isArray(data.draftTasks) ? (data.draftTasks as SeoHarnessMetadata["draftTasks"]) : [],
  };
}

function normalizeFindings(value: unknown): SeoFinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const data = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const evidence = Array.isArray(data.evidence) ? (data.evidence as SeoFinding["evidence"]) : [];
      const title = String(data.title || "").trim();
      if (!title) return null;
      return {
        ...(data as SeoFinding),
        id: String(data.id || ""),
        teamId: String(data.teamId || ""),
        companyId: String(data.companyId || ""),
        domain: String(data.domain || ""),
        url: typeof data.url === "string" && data.url.trim() ? data.url.trim() : null,
        type: String(data.type || data.category || "technical"),
        title,
        description: String(data.description || ""),
        source: (data.source as SeoFinding["source"]) || evidence[0]?.source || "harness",
        evidence,
        recommendation: String(data.recommendation || data.recommendedAction || data.description || title),
        labels: Array.isArray(data.labels) ? (data.labels as SeoFinding["labels"]) : [],
        targetKeywords: toStringArray(data.targetKeywords),
        sourceId: typeof data.sourceId === "string" ? data.sourceId : null,
      };
    })
    .filter(Boolean) as SeoFinding[];
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
    rankTracking: normalizeRankTracking(data.rankTracking),
    pagespeed: normalizePageSpeed(data.pagespeed),
    crawler: normalizeCrawler(data.crawler),
    findings: normalizeFindings(data.findings),
    opportunities: Array.isArray(data.opportunities) ? (data.opportunities as SeoOpportunity[]) : [],
    recommendations: Array.isArray(data.recommendations) ? (data.recommendations as SeoRecommendation[]) : [],
    harness: normalizeHarness(data.harness),
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
  rankTracking: SeoRankTrackingSnapshot;
  pagespeed: SeoPageSpeedSnapshot;
  crawler: SeoCrawlerSnapshot;
  findings: SeoFinding[];
  opportunities: SeoOpportunity[];
  recommendations: SeoRecommendation[];
  harness: SeoHarnessMetadata;
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
    rankTracking: input.rankTracking,
    pagespeed: input.pagespeed,
    crawler: input.crawler,
    findings: input.findings,
    opportunities: input.opportunities,
    recommendations: input.recommendations,
    harness: input.harness,
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

export async function findSeoAnalysisRunByTeamAndId(teamId: string, id: string): Promise<SeoAnalysisRun | null> {
  const run = await findSeoAnalysisRunById(id);
  if (!run || run.teamId !== teamId) return null;
  return run;
}

export async function listSeoAnalysisRunsByTeamId(teamId: string, limitCount = 100): Promise<SeoAnalysisRun[]> {
  const snap = await collection
    .where("teamId", "==", teamId)
    .orderBy("createdAt", "desc")
    .limit(limitCount)
    .get();

  return snap.docs.map((doc) => docToSeoAnalysisRun(doc.id, doc.data()));
}

export async function updateSeoAnalysisRunStatus(
  id: string,
  status: SeoAnalysisStatus
): Promise<void> {
  await collection.doc(id).set({ status }, { merge: true });
}

export async function updateSeoAnalysisRunStatusForTeam(
  teamId: string,
  id: string,
  status: SeoAnalysisStatus
): Promise<boolean> {
  const run = await findSeoAnalysisRunByTeamAndId(teamId, id);
  if (!run) return false;
  await updateSeoAnalysisRunStatus(id, status);
  return true;
}
