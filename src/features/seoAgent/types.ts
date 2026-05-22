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
export type SeoRecommendationType = "content" | "technical" | "competitive" | "tracking";
export type SeoPriority = "low" | "medium" | "high";
export type SeoConfidence = "low" | "medium" | "high";
export type SeoDataSource = "provider" | "heuristic";
export type SeoSourceName = "mock" | "sistrix" | "pagespeed" | "crawler" | "gsc";
export type SeoSourceStatusType = "success" | "skipped" | "failed" | "not_configured";
export type SeoDraftTaskSourceType = "opportunity" | "recommendation";
export type SeoDraftTaskPriority = "normal" | "priority" | "fire";
export type SeoDraftTaskStatus = "draft" | "approved" | "rejected";

export type SeoCompanyConfig = {
  id: string;
  teamId: string;
  companyId: string;
  domain: string;
  markets: string[];
  languages: string[];
  competitors: string[];
  importantSections: string[];
  brandKeywords: string[];
  excludeKeywords: string[];
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
  safeMessage?: string;
};

export type SeoVisibilitySnapshot = {
  visibilityIndex: number | null;
  trend: "up" | "flat" | "down" | "unknown";
  notes: string[];
};

export type SeoSearchConsoleSnapshot = {
  siteUrl: string | null;
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
  title: string;
  description: string;
  targetKeywords: string[];
  priority: SeoPriority;
  confidence: SeoConfidence;
  source: SeoDataSource;
};

export type SeoRecommendation = {
  type: SeoRecommendationType;
  title: string;
  description: string;
  priority: SeoPriority;
};

export type SeoDraftTask = {
  id: string;
  teamId: string;
  runId: string;
  domain: string;
  sourceType: SeoDraftTaskSourceType;
  sourceId: string | null;
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
  pagespeed: SeoPageSpeedSnapshot;
  crawler: SeoCrawlerSnapshot;
  opportunities: SeoOpportunity[];
  recommendations: SeoRecommendation[];
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
};
