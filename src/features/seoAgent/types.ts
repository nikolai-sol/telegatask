export type SeoAnalysisMode =
  | "quick_audit"
  | "content_gap"
  | "keyword_strategy"
  | "daily_brief";

export type SeoAnalysisStatus = "draft" | "approved" | "rejected" | "failed";

export type SeoImpact = "low" | "medium" | "high";
export type SeoEffort = "low" | "medium" | "high";
export type SeoUrgency = "low" | "medium" | "high";
export type SeoOpportunityType =
  | "content_gap"
  | "content_optimization"
  | "technical_issue"
  | "internal_linking"
  | "keyword_quick_win"
  | "competitor_gap";
export type SeoOpportunityCategory = "keyword" | "competitor" | "content" | "technical";
export type SeoQueryIntent = "brand" | "product" | "category" | "b2b" | "informational" | "unknown";
export type SeoRecommendationType = "content" | "technical" | "competitive" | "tracking";
export type SeoPriority = "low" | "medium" | "high";
export type SeoConfidence = "low" | "medium" | "high";
export type SeoDataSource = "provider" | "heuristic";
export type SeoSourceName =
  | "mock"
  | "sistrix"
  | "pagespeed"
  | "crawler"
  | "gsc"
  | "google_serp_rank"
  | "yandex_serp_rank";
export type SeoSourceStatusType = "success" | "partial" | "failed" | "skipped";
export type SeoSourceLabel =
  | "Google Search Console data"
  | "Technical crawler data"
  | "PageSpeed data"
  | "AI heuristic, not Google ranking data";
export type SeoDraftTaskSourceType = "opportunity" | "recommendation";
export type SeoDraftTaskPriority = "normal" | "priority" | "fire";
export type SeoDraftTaskStatus = "draft" | "approved" | "rejected";
export type SeoDeviceType = "desktop" | "mobile";

export type SeoCompanyConfig = {
  id: string;
  teamId: string;
  companyId: string;
  domain: string;
  gscSiteUrl: string | null;
  targetDomainAliases: string[];
  markets: string[];
  languages: string[];
  competitors: string[];
  importantSections: string[];
  brandKeywords: string[];
  excludeKeywords: string[];
  trackingKeywords: string[];
  targetLocation: string | null;
  targetRegion: string | null;
  targetDevice: SeoDeviceType | null;
  createdAt: number;
  updatedAt: number;
  createdByUserId: string;
};

export type SeoAnalysisSummary = {
  visibilityIndex: number | null;
  keywordCount: number | null;
  competitorCount: number | null;
};

export type SeoAnalysisScores = {
  visibilityScore: number | null;
  opportunityScore: number | null;
  competitorPressureScore: number | null;
  overallSeoScore: number | null;
};

export type SeoSourceStatus = {
  source: SeoSourceName;
  status: SeoSourceStatusType;
  message: string;
  errorCode?: string;
  collectedAt: number;
  metricsSummary?: Record<string, string | number | boolean | null>;
};

export type SeoRankProviderStatusState =
  | "connected"
  | "missing_credentials"
  | "no_keywords"
  | "provider_error"
  | "limit_exceeded"
  | "partial_success";

export type SeoRankProviderStatus = {
  state: SeoRankProviderStatusState;
  message: string;
  errorCode?: string;
  checkedAt: string;
  metricsSummary?: Record<string, string | number | boolean | null>;
};

export type SerpRankCompetitor = {
  position: number;
  domain: string;
  url: string;
  title?: string;
};

export type SerpRankCheck = {
  query: string;
  searchEngine: "google" | "yandex";
  provider: "dataforseo" | "yandex_search_api";
  targetDomain: string;
  found: boolean;
  position?: number;
  matchedUrl?: string;
  title?: string;
  snippet?: string;
  competitorsAbove?: SerpRankCompetitor[];
  serpFeatures?: string[];
  topResultDomains?: string[];
  location?: string;
  region?: string;
  language?: string;
  device: SeoDeviceType;
  checkedAt: string;
};

export type GoogleRankCheck = SerpRankCheck & { searchEngine: "google" };
export type YandexRankCheck = SerpRankCheck & { searchEngine: "yandex" };

export type SeoRankTrackingSnapshot = {
  google?: {
    provider: "dataforseo";
    checks: GoogleRankCheck[];
    status: SeoRankProviderStatus;
  };
  yandex?: {
    provider: "yandex_search_api";
    checks: YandexRankCheck[];
    status: SeoRankProviderStatus;
  };
};

export type SeoVisibilitySnapshot = {
  visibilityIndex: number | null;
  trend: "up" | "flat" | "down" | "unknown";
  notes: string[];
};

export type SeoSearchConsoleSnapshot = {
  property: string | null;
  siteUrl: string | null;
  dateRange: {
    startDate: string | null;
    endDate: string | null;
    days: number | null;
  };
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  averagePosition: number | null;
  topQueries: string[];
  topPages: string[];
  countries: string[];
  devices: string[];
};

export type SeoPageSpeedSnapshot = {
  pageUrl: string | null;
  performanceScore: number | null;
  accessibilityScore: number | null;
  bestPracticesScore: number | null;
  seoScore: number | null;
  largestContentfulPaintMs: number | null;
  cumulativeLayoutShift: number | null;
  interactionToNextPaintMs: number | null;
  totalBlockingTimeMs: number | null;
};

export type SeoCrawlerSnapshot = {
  pageUrl: string | null;
  finalUrl: string | null;
  httpStatus: number | null;
  hasTitle: boolean | null;
  hasMetaDescription: boolean | null;
  hasH1: boolean | null;
  hasCanonical: boolean | null;
  robotsTxtReachable: boolean | null;
  sitemapXmlReachable: boolean | null;
  isIndexable: boolean | null;
};

export type SeoTechnicalSnapshot = {
  issueCount: number | null;
  highlights: string[];
};

export type SeoKeywordInsight = {
  keyword: string;
  currentUrl: string | null;
  currentPosition: number | null;
  searchVolume: number | null;
  type: Extract<SeoOpportunityType, "content_gap" | "keyword_quick_win" | "content_optimization">;
  source: SeoDataSource;
};

export type SeoCompetitorInsight = {
  domain: string;
  visibilityIndex: number | null;
  overlapScore: number | null;
};

export type SeoOpportunity = {
  type: SeoOpportunityCategory;
  opportunityType?: SeoOpportunityType;
  intent?: SeoQueryIntent;
  title: string;
  description: string;
  targetUrl?: string | null;
  targetKeywords: string[];
  market?: string | null;
  language?: string | null;
  impact?: SeoImpact;
  effort?: SeoEffort;
  urgency?: SeoUrgency;
  priority: SeoPriority;
  confidence: SeoConfidence;
  source: SeoDataSource;
  recommendedAction?: string;
  reasoning?: string;
  sourceFindingId?: string;
  evidence?: SeoEvidence[];
};

export type SeoRecommendation = {
  type: SeoRecommendationType;
  title: string;
  description: string;
  priority: SeoPriority;
  category?: SeoOpportunityCategory | SeoRecommendationType;
  confidence?: SeoConfidence;
  sourceFindingId?: string;
  evidence?: SeoEvidence[];
};

export type SeoEvidence = {
  source: SeoSourceName | "harness" | "manual";
  metric?: string;
  value?: string | number | boolean | null;
  url?: string | null;
  query?: string | null;
  message: string;
  collectedAt?: number | string | null;
};

export type SeoFinding = {
  id: string;
  teamId: string;
  companyId: string;
  domain: string;
  url: string | null;
  type: string;
  category: SeoOpportunityCategory | SeoRecommendationType;
  title: string;
  description: string;
  source: SeoEvidence["source"];
  severity: SeoPriority;
  confidence: SeoConfidence;
  evidence: SeoEvidence[];
  recommendation: string;
  labels: SeoSourceLabel[];
  recommendedAction?: string;
  targetKeywords: string[];
  sourceType: SeoDraftTaskSourceType;
  sourceId: string | null;
};

export type SeoHarnessDraftTask = {
  teamId: string;
  companyId: string;
  domain: string;
  sourceFindingId: string;
  sourceType: SeoDraftTaskSourceType;
  sourceId: string | null;
  title: string;
  description: string;
  priority: SeoDraftTaskPriority;
  targetKeywords: string[];
  evidence: SeoEvidence[];
};

export type SeoSelectedSkill = {
  id: string;
  title: string;
  score: number;
};

export type SeoBlockedAction = {
  action: string;
  reason: string;
  sourceFindingId?: string;
  title?: string;
};

export type SeoConfidenceSummary = {
  high: number;
  medium: number;
  low: number;
};

export type SeoHarnessMetadata = {
  selectedSkills: SeoSelectedSkill[];
  warnings: string[];
  blockedActions: SeoBlockedAction[];
  confidenceSummary: SeoConfidenceSummary;
  draftTasks: SeoHarnessDraftTask[];
};

export type SeoDraftTask = {
  id: string;
  teamId: string;
  companyId: string;
  runId: string;
  domain: string;
  sourceType: SeoDraftTaskSourceType;
  sourceId: string | null;
  sourceFindingId: string | null;
  evidence: SeoEvidence[];
  labels: SeoSourceLabel[];
  title: string;
  description: string;
  priority: SeoDraftTaskPriority;
  status: SeoDraftTaskStatus;
  targetKeywords: string[];
  suggestedCompanyId: string | null;
  realTaskId: string | null;
  convertedAt: string | null;
  convertedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SeoRecommendedTask = SeoDraftTask;

export type SeoDraftTaskVisibility = "private" | "team";
export type SeoConvertDraftTaskPriority = "normal" | "priority";

export type SeoDraftTaskConversionOptions = {
  companyId?: string | null;
  assignedUserId?: string | null;
  dueDate?: string | null;
  visibility?: SeoDraftTaskVisibility;
  priority?: SeoConvertDraftTaskPriority;
};

export type SeoAnalysisRun = {
  id: string;
  teamId: string;
  companyId: string;
  configId: string;
  mode: SeoAnalysisMode;
  status: SeoAnalysisStatus;
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
  createdAt: number;
  createdByUserId: string;
};

export type SeoAnalysisInput = {
  teamId: string;
  companyId: string;
  config: SeoCompanyConfig;
  mode: SeoAnalysisMode;
  createdByUserId: string;
  sources?: string[];
  keywords?: string[];
  location?: string | null;
  region?: string | null;
  language?: string | null;
  device?: SeoDeviceType | null;
};
