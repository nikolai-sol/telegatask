/** Market profiles supported by the generic WGD report runner. */
export type WgdMarket = "RU" | "AT" | "DE" | "OTHER";

export type WgdDevice = "mobile" | "desktop";

export type CoverageState =
  | "success"
  | "partial"
  | "unavailable"
  | "not_applicable"
  | "owner_access_required";

/** Input needed to extract deterministic evidence from one HTML response. */
export type HtmlAnalysisInput = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string | string[] | undefined>;
  html: string;
};

/** The input contract shared by the CLI and report orchestration layer. */
export type WgdReportOptions = {
  url: string;
  domain: string;
  market: WgdMarket;
  language: string;
  region: string;
  crawlLimit: number;
  lighthousePageLimit: number;
  keywords: string[];
  aiQueries: string[];
  priorityUrls: string[];
  outDir: string;
  sources: { dataForSeo: CoverageState };
};

/** Availability and access status for one evidence provider. */
export type SourceCoverage = {
  id: string;
  label?: string;
  state: CoverageState;
  message?: string;
  checkedAt?: string;
  details?: Record<string, string | number | boolean | null>;
};

export type PageDiscoverySource = "start" | "priority" | "sitemap" | "internal_link";

export type KeywordAlignmentField = "title" | "description" | "h1";

export type KeywordTopicAlignment = {
  state: "measured" | "no_keywords" | "not_measured";
  method: "normalized_token_presence";
  checkedKeywords: number;
  matches: Array<{ keyword: string; fields: KeywordAlignmentField[] }>;
  unmatchedKeywords: string[];
  note: string;
};

export type SeoSignalConflict = {
  code:
    | "robots_index_disagreement"
    | "robots_follow_disagreement"
    | "canonical_differs_from_final"
    | "canonical_on_non_2xx"
    | "multiple_canonical_targets"
    | "hreflang_language_has_multiple_targets";
  category: "robots" | "canonical" | "hreflang";
};

/** Normalized evidence extracted from one crawled HTML page. */
export type PageEvidence = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType?: string;
  title?: string;
  titleLength?: number;
  description?: string;
  descriptionLength?: number;
  metaRobots?: string;
  xRobotsTag?: string;
  robots?: string;
  canonical?: string;
  hreflang?: Array<{ language: string; url: string }>;
  headings?: {
    h1: string[];
    h2: string[];
    h3?: string[];
    h4?: string[];
    h5?: string[];
    h6?: string[];
  };
  links?: string[];
  internalLinks?: string[];
  externalLinks?: string[];
  linksTruncated?: boolean;
  omittedLinkCount?: number;
  schemaTypes?: string[];
  schemaErrors?: string[];
  openGraph?: Record<string, string>;
  twitterCards?: Record<string, string>;
  images?: { total: number; missingAlt: number };
  wordCount?: number;
  indexable: boolean;
  signalConflicts: SeoSignalConflict[];
  indexabilityConflicts?: string[];
  keywordAlignment?: KeywordTopicAlignment;
  depth?: number;
  discoveryOrder?: number;
  discoverySources?: PageDiscoverySource[];
  inboundInternalLinks?: number;
  orphanCandidate?: boolean;
  error?: string;
};

/** Bounded, dependency-injected HTTP response shape used by the site crawler. */
export type CrawlFetchResponse = {
  status: number;
  url?: string;
  headers: { get(name: string): string | null | undefined };
  body?: {
    getReader?: () => {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel?(reason?: unknown): Promise<void>;
      releaseLock?(): void;
    };
    cancel?(reason?: unknown): Promise<void>;
    destroy?(error?: Error): void;
    [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | string>;
  } | null;
};

export type CrawlFetch = (
  url: string,
  init?: {
    signal?: AbortSignal;
    redirect?: "follow" | "error" | "manual";
    resolvedAddress?: { address: string; family: 4 | 6 };
  }
) => Promise<CrawlFetchResponse>;

export type CrawlSiteOptions = {
  startUrl: string;
  priorityUrls?: string[];
  keywords?: string[];
  limit: number;
  concurrency: number;
  timeoutMs: number;
  robotsUserAgent: "YandexBot" | "Googlebot";
};

export type RobotsAccessEvidence = {
  state: "measured" | "unavailable";
  userAgent: "YandexBot" | "Googlebot";
  checkedUrlCount: number;
  blockedUrls: string[];
};

export type RobotsEvidence = {
  url: string;
  status?: number;
  sitemapUrls: string[];
  access: RobotsAccessEvidence;
  error?: string;
};

export type SitemapCandidate = {
  url: string;
  source: "common" | "robots" | "sitemap";
  status?: number;
  urls: string[];
  isIndex?: boolean;
  error?: string;
};

export type RedirectChain = {
  requestedUrl: string;
  finalUrl: string;
  urls: string[];
};

/** Deterministic evidence emitted from a bounded same-origin crawl. */
export type CrawlEvidence = {
  attemptedUrlCount: number;
  eligibleDiscoveredCount: number;
  droppedEligibleCount: number;
  truncated: boolean;
  pages: PageEvidence[];
  robots: RobotsEvidence;
  sitemapCandidates: SitemapCandidate[];
  discoveredUrls: string[];
  excludedUrls: string[];
  brokenUrls: string[];
  redirectChains: RedirectChain[];
  duplicateTitles: Record<string, string[]>;
  duplicateDescriptions: Record<string, string[]>;
  limitations: string[];
};

export type LighthouseFieldDataEvidence = {
  source: "CrUX";
  state: "not_collected" | "unavailable";
};

/** Normalized result of a Lighthouse run for one URL and device profile. */
export type LighthouseEvidence = {
  /** Compatibility identity; always the sanitized requested URL for newly collected evidence. */
  url: string;
  requestedUrl?: string;
  finalUrl?: string;
  device: WgdDevice;
  status?: "success" | "failed";
  /** Lighthouse values are synthetic measurements from a controlled lab run. */
  measurementType: "lab";
  /** Real-user CrUX evidence is tracked separately and is never inferred from Lighthouse. */
  fieldData: LighthouseFieldDataEvidence;
  categoryScores?: Record<string, number | null>;
  metrics?: {
    firstContentfulPaintMs?: number | null;
    largestContentfulPaintMs?: number | null;
    cumulativeLayoutShift?: number | null;
    totalBlockingTimeMs?: number | null;
    speedIndexMs?: number | null;
    interactionToNextPaintMs?: number | null;
  };
  transferSizeBytes?: number | null;
  unusedJavaScriptBytes?: number | null;
  unusedCssBytes?: number | null;
  insights?: string[];
  failedAudits?: Array<{
    id: string;
    title?: string;
    score?: number | null;
    description?: string;
    categories: string[];
  }>;
  rawPath?: string;
  /** Parsed Lighthouse JSON retained for a separately written evidence file. */
  rawPayload?: Record<string, unknown>;
  error?: string;
};

export type WgdFindingSeverity = "critical" | "high" | "medium" | "low";
export type WgdFindingConfidence = "high" | "medium" | "low";
export type WgdFindingDeliveryStage = "blocking" | "visibility" | "improvement";
export type WgdManagerFindingScope = "site" | "page";
export type WgdKnownFindingCode =
  | "homepage_noindex"
  | "indexability_signal_conflict"
  | "page_evidence_collection_failed"
  | "missing_sitemap"
  | "broken_internal_links"
  | "orphan_candidate"
  | "missing_h1"
  | "missing_canonical"
  | "duplicate_titles"
  | "mobile_desktop_regression"
  | "accessibility_audits_failed"
  | "duplicate_descriptions"
  | "generic_description"
  | "keyword_topic_alignment_gap"
  | "thin_content_heuristic"
  | "missing_image_alt"
  | "alice_ai_not_used"
  | "crawl_truncated"
  | "owner_access_gap";

/** A confirmed finding group for the manager section of the HTML report. */
export type WgdManagerFindingGroup = {
  code: WgdKnownFindingCode;
  rank: number;
  severity: WgdFindingSeverity;
  deliveryStage: WgdFindingDeliveryStage;
  technicalAnchor: string;
  scope: WgdManagerFindingScope;
  affectedUrls: string[];
  findingCount: number;
};

/** A prioritized, evidence-backed recommendation in the generated report. */
export type WgdFinding = {
  code: string;
  severity: WgdFindingSeverity;
  affectedUrl?: string;
  scope?: string;
  evidence: string;
  source: string;
  confidence: WgdFindingConfidence;
  action: string;
  expectedEffect: string;
  acceptanceCriterion: string;
  verification: string;
};

export type WgdComponentId = "technical" | "yandex" | "lighthouse" | "alice";

export type WgdAssessmentState = "scored" | "preliminary" | "insufficient_data";

export type WgdScoreStatus = "critical" | "high_risk" | "needs_improvement" | "good";

export type WgdTechnicalRuleId =
  | "http_success"
  | "indexability"
  | "robots_access"
  | "sitemap"
  | "canonical"
  | "signal_conflicts"
  | "title_present"
  | "title_unique"
  | "description_present"
  | "description_unique"
  | "h1_present"
  | "broken_internal_links"
  | "redirect_chains"
  | "orphan_pages";

export type WgdComponentAssessment = {
  score: number | null;
  nominalWeight: 40 | 25 | 20 | 15;
  effectiveWeight: number;
  collectionCoverage: number;
  scoringCoverage: number;
  collected: number;
  requested: number;
};

export type WgdAtomicRuleAssessment = {
  id: WgdTechnicalRuleId;
  weight: number;
  applicableCount: number;
  measuredCount: number;
  passedCount: number;
  ruleCoverage: number | null;
  passRate: number | null;
};

export type WgdTechnicalComponentAssessment = WgdComponentAssessment & {
  nominalWeight: 40;
  crawlCompletion: number;
  atomicRuleCoverage: number;
  rules: WgdAtomicRuleAssessment[];
};

export type WgdLighthouseComponentAssessment = WgdComponentAssessment & {
  nominalWeight: 20;
  worstMobileUrl: string | null;
};

export type WgdPageGroupId = "indexability" | "content" | "internal_structure" | "lighthouse";

export type WgdPageGroupAssessment = {
  nominalWeight: 45 | 30 | 10 | 15;
  measuredWeight: number;
  earnedPoints: number;
  score: number | null;
};

export type WgdPageAssessment = {
  url: string;
  score: number | null;
  collectionCoverage: number;
  noindexCapApplied: boolean;
  groups: Record<WgdPageGroupId, WgdPageGroupAssessment>;
};

export type WgdReportAssessment = {
  state: WgdAssessmentState;
  calculatedScore: number | null;
  displayScore: number | null;
  completeness: number;
  status: WgdScoreStatus | null;
  indexabilityCapApplied: boolean;
  components: {
    technical: WgdTechnicalComponentAssessment;
    yandex: WgdComponentAssessment & { nominalWeight: 25 };
    lighthouse: WgdLighthouseComponentAssessment;
    alice: WgdComponentAssessment & { nominalWeight: 15 };
  };
  pages: WgdPageAssessment[];
};

export type WgdManagerLabel =
  | "noData"
  | "notScored"
  | "searchEngine"
  | "completeness"
  | "siteLevelProblem"
  | "siteFound"
  | "notFoundFirst20"
  | "incompleteFirst20"
  | "depthUnavailable"
  | "invalidYandexObservation"
  | "checkFailed"
  | "pageNotProvided"
  | "aliceUsed"
  | "aliceNotUsed"
  | "aliceNote"
  | "lighthouseNote"
  | "lighthouseRoundingNote"
  | "methodologyData"
  | "methodologyScoring"
  | "ownerAccessNote"
  | "specialistNote"
  | "noMainProblem"
  | "query"
  | "position"
  | "page"
  | "result"
  | "priority"
  | "affected"
  | "impact"
  | "action"
  | "componentScore"
  | "collection"
  | "coverage"
  | "mobileAverage"
  | "desktopAverage"
  | "worstMobilePage"
  | "scoreInputs"
  | "supplementaryResults"
  | "weight"
  | "pageScore"
  | "indexability"
  | "mainProblem"
  | "httpStatus"
  | "mobilePerformance"
  | "desktopPerformance"
  | "source"
  | "state"
  | "diagnostics"
  | "requestedQueries"
  | "checkedQueries"
  | "foundQueries"
  | "top10Queries"
  | "usedAnswers"
  | "cruxFieldData"
  | "confirmedProblems"
  | "excludedFromSpeedScore";

export type WgdManagerPresentation = {
  locale: "ru" | "en";
  labels: Record<WgdManagerLabel, string>;
  headings: {
    overall: string;
    components: string;
    problems: string;
    yandex: string;
    alice: string;
    speed: string;
    priorities: string;
    pages: string;
    siteTechnical: string;
    methodology: string;
    specialist: string;
  };
  header: {
    title: string;
    domain: string;
    date: string;
    market: string;
    searchEngine: string;
    completeness: string;
  };
  overall: {
    score: number | null;
    scoreText: string;
    state: string;
    status: string | null;
    completeness: number;
    completenessText: string;
    conclusion: string;
  };
  components: Array<{
    name: string;
    score: number | null;
    scoreText: string;
    collection: string;
    coverage: string;
    explanation: string;
  }>;
  problems: Array<{
    title: string;
    priority: string;
    affected: string;
    impact: string;
    action: string;
    href: string;
    linkLabel: string;
  }>;
  problemsEmpty: string | null;
  yandex: {
    summary: { requested: number; checked: number; found: number; top10: number; text: string };
    rows: Array<{ query: string; position: string; page: string; result: string }>;
    empty: string | null;
  };
  alice: {
    score: number | null;
    scoreText: string;
    usedCount: number;
    checkedCount: number;
    requestedCount: number;
    conclusion: string;
    note: string;
    rows: Array<{ query: string; result: string }>;
    empty: string | null;
  };
  lighthouse: {
    score: number | null;
    scoreText: string;
    mobileAverage: number | null;
    mobileAverageText: string;
    desktopAverage: number | null;
    desktopAverageText: string;
    scoreInputs: Array<{
      name: string;
      score: number;
      scoreText: string;
      weight: 50 | 20 | 10;
      weightText: string;
    }>;
    supplementaryResults: Array<{ name: string; score: number; scoreText: string; note: string }>;
    worstMobilePage: { url: string; score: number; scoreText: string } | null;
    diagnostics: string[];
    diagnosticsEmpty: string | null;
    note: string;
    roundingNote: string;
    empty: string | null;
  };
  priorityStages: Array<{ title: string; result: string; items: string[] }>;
  prioritiesEmpty: string | null;
  pages: Array<{
    id: string;
    url: string;
    name: string;
    score: number | null;
    scoreText: string;
    indexability: string;
    mainProblem: string;
    httpStatus: string;
    mobilePerformance: string;
    desktopPerformance: string;
    problems: Array<{ title: string; priority: string; action: string }>;
  }>;
  pagesEmpty: string | null;
  methodology: {
    summary: string[];
    sources: Array<{ source: string; state: string }>;
    accessGaps: Array<{ source: string; state: string }>;
    accessNote: string;
    limitations: string[];
  };
  specialist: {
    note: string;
    links: Array<{ label: string; href: string }>;
    empty: string | null;
  };
};

/** Top-level artifact payload. Sections are optional so partial provider runs remain representable. */
export type WgdReportPayload = {
  schemaVersion?: string;
  generatedAt: string;
  options: WgdReportOptions;
  sources?: SourceCoverage[];
  crawl?: unknown;
  pages?: PageEvidence[];
  lighthouse?: LighthouseEvidence[];
  yandex?: unknown;
  findings: WgdFinding[];
  limitations?: string[];
  manualQueryPackPath?: string;
  [key: string]: unknown;
};

/** The deterministic schema serialized to report.json and rendered as report.html. */
export type WgdPublishedReport = {
  schemaVersion: "2.0";
  generatedAt: string;
  options: WgdReportOptions;
  sources: SourceCoverage[];
  /** Retained sanitized evidence; it is not necessarily safe scoring input for legacy reports. */
  crawl?: unknown;
  pages: PageEvidence[];
  lighthouse: LighthouseEvidence[];
  yandex?: unknown;
  findings: WgdFinding[];
  limitations?: string[];
  manualQueryPackPath?: string;
  assessment: WgdReportAssessment;
  groupedFindings: WgdManagerFindingGroup[];
  [key: string]: unknown;
};
