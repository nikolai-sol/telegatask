import type {
  SeoAnalysisMode,
  SeoEffort,
  SeoImpact,
  SeoOpportunityType,
  SeoUrgency,
} from "../types";

export type SeoProviderInput = {
  teamId: string;
  companyId: string;
  domain: string;
  market: string;
  language: string;
  competitors: string[];
  importantSections: string[];
  mode: SeoAnalysisMode;
};

export type SeoDomainOverview = {
  domain: string;
  market: string;
  visibilitySummary: string;
  trend: "up" | "flat" | "down" | "unknown";
  notes: string[];
  visibilityIndex?: number;
  keywordCount?: number;
};

export type SeoKeywordOpportunity = {
  keyword: string;
  market: string;
  language: string;
  currentUrl?: string;
  currentPosition?: number;
  searchVolume?: number;
  opportunityType: Extract<SeoOpportunityType, "content_gap" | "keyword_quick_win" | "content_optimization">;
  impact: SeoImpact;
  effort: SeoEffort;
  urgency: SeoUrgency;
  suggestedEscalation?: "fire";
  requiresOwnerApproval?: boolean;
  reasoning: string;
};

export type SeoCompetitorGap = {
  competitorDomain: string;
  keyword: string;
  competitorUrl?: string;
  competitorPosition?: number;
  ourUrl?: string;
  ourPosition?: number;
  competitorVisibilityIndex?: number;
  overlapScore?: number;
  gapType: Extract<SeoOpportunityType, "competitor_gap" | "content_gap">;
  impact: SeoImpact;
  effort: SeoEffort;
  urgency: SeoUrgency;
  reasoning: string;
};

export type SeoUrlOpportunity = {
  url: string;
  issueType: Extract<
    SeoOpportunityType,
    "content_optimization" | "technical_issue" | "internal_linking" | "content_gap"
  >;
  targetKeywords: string[];
  recommendedAction: string;
  impact: SeoImpact;
  effort: SeoEffort;
  urgency: SeoUrgency;
  suggestedEscalation?: "fire";
  requiresOwnerApproval?: boolean;
  reasoning: string;
};

export interface SeoDataProvider {
  getDomainOverview(input: SeoProviderInput): Promise<SeoDomainOverview>;
  getKeywordOpportunities(input: SeoProviderInput): Promise<SeoKeywordOpportunity[]>;
  getCompetitorGaps(input: SeoProviderInput): Promise<SeoCompetitorGap[]>;
  getUrlOpportunities(input: SeoProviderInput): Promise<SeoUrlOpportunity[]>;
}

export class SeoProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeoProviderNotConfiguredError";
  }
}

export class SeoProviderError extends Error {
  public readonly safeMessage: string;
  public readonly statusCode: number;
  public readonly category: string;
  public readonly internalCause?: unknown;

  constructor(input: {
    safeMessage: string;
    statusCode?: number;
    category: string;
    internalCause?: unknown;
  }) {
    super(input.safeMessage);
    this.name = "SeoProviderError";
    this.safeMessage = input.safeMessage;
    this.statusCode = input.statusCode ?? 503;
    this.category = input.category;
    this.internalCause = input.internalCause;
  }
}

export function normalizeProviderDomain(domain: string): string {
  return String(domain || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

export function urlForDomain(domain: string, path: string): string {
  return `https://${normalizeProviderDomain(domain) || "example.com"}${path}`;
}
