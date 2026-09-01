import type { SeoOpportunity, SeoPriority } from "./types";

export type WeeklyTop10OpportunityState = "new" | "carried_over" | "approved" | "implemented" | "rejected";

export type WeeklyTop10OpportunityInput = {
  opportunity: SeoOpportunity;
  state?: WeeklyTop10OpportunityState;
  firstSeenAt?: string | null;
  approvedAt?: string | null;
  implementedAt?: string | null;
};

export type WeeklyTop10GeneratorConfig = {
  maxItems: number;
  maxWatchlistItems: number;
  minConfidenceScore: number;
  staleApprovedDays: number;
  now: string;
};

export type WeeklyTop10DigestItem = {
  rank: number;
  state: Exclude<WeeklyTop10OpportunityState, "rejected" | "implemented">;
  title: string;
  priority: SeoPriority;
  confidenceScore: number;
  targetKeywords: string[];
  recommendedAction: string | null;
  evidenceCount: number;
  sourceKeys: string[];
};

export type WeeklyTop10Digest = {
  generatedAt: string;
  items: WeeklyTop10DigestItem[];
  watchlist: WeeklyTop10DigestItem[];
  carriedOver: WeeklyTop10DigestItem[];
  approvedStale: WeeklyTop10DigestItem[];
  summary: {
    totalCandidates: number;
    includedCount: number;
    watchlistCount: number;
    carriedOverCount: number;
    approvedStaleCount: number;
    noNewOpportunities: boolean;
  };
};

export function buildWeeklyTop10NoNewOpportunitiesLifeSign(input: {
  runWeekKey: string;
  onControlCount: number;
  watchlist: readonly Pick<WeeklyTop10DigestItem, "title" | "targetKeywords">[];
}): string {
  const weekLabel = input.runWeekKey.match(/W\d+$/)?.[0] || input.runWeekKey;
  const watchlist = input.watchlist
    .map((item) => item.targetKeywords[0] || item.title)
    .filter(Boolean)
    .join("; ");
  return `${weekLabel}: новых возможностей нет, на контроле ${input.onControlCount} — ${watchlist || "нет кандидатов"}`;
}

type ScoredCandidate = {
  input: WeeklyTop10OpportunityInput;
  state: Exclude<WeeklyTop10OpportunityState, "rejected" | "implemented">;
  score: number;
  sourceKeys: string[];
};

export const DEFAULT_WEEKLY_TOP10_GENERATOR_CONFIG: WeeklyTop10GeneratorConfig = {
  maxItems: 10,
  maxWatchlistItems: 3,
  minConfidenceScore: 50,
  staleApprovedDays: 14,
  now: new Date().toISOString(),
};

export function buildWeeklyTop10GeneratorConfig(
  overrides: Partial<WeeklyTop10GeneratorConfig> = {}
): WeeklyTop10GeneratorConfig {
  return {
    ...DEFAULT_WEEKLY_TOP10_GENERATOR_CONFIG,
    ...overrides,
  };
}

function priorityScore(priority: SeoPriority): number {
  if (priority === "high") return 40;
  if (priority === "medium") return 25;
  return 10;
}

function impactScore(value: SeoOpportunity["impact"]): number {
  if (value === "high") return 25;
  if (value === "medium") return 15;
  if (value === "low") return 5;
  return 0;
}

function confidenceScore(value: SeoOpportunity["confidence"]): number {
  if (value === "high") return 20;
  if (value === "medium") return 12;
  return 5;
}

function urgencyScore(value: SeoOpportunity["urgency"]): number {
  if (value === "high") return 10;
  if (value === "medium") return 6;
  if (value === "low") return 2;
  return 0;
}

function evidenceScore(opportunity: SeoOpportunity): number {
  const evidenceCount = opportunity.evidence?.length || 0;
  return Math.min(5, evidenceCount * 2);
}

function sourceKeys(opportunity: SeoOpportunity): string[] {
  return Array.from(
    new Set(
      (opportunity.evidence || [])
        .map((item) => [item.source, item.metric, item.query, item.url].filter(Boolean).join(":"))
        .filter(Boolean)
    )
  );
}

function scoreOpportunity(opportunity: SeoOpportunity): number {
  return (
    priorityScore(opportunity.priority) +
    impactScore(opportunity.impact) +
    confidenceScore(opportunity.confidence) +
    urgencyScore(opportunity.urgency) +
    evidenceScore(opportunity)
  );
}

function effectiveState(input: WeeklyTop10OpportunityInput): WeeklyTop10OpportunityState {
  return input.state || "new";
}

function isActiveState(state: WeeklyTop10OpportunityState): state is Exclude<WeeklyTop10OpportunityState, "rejected" | "implemented"> {
  return state !== "rejected" && state !== "implemented";
}

function daysBetween(start: string | null | undefined, end: string): number | null {
  if (!start) return null;
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
  return Math.floor((endTime - startTime) / 86_400_000);
}

function isStaleApproved(input: WeeklyTop10OpportunityInput, config: WeeklyTop10GeneratorConfig): boolean {
  if (effectiveState(input) !== "approved") return false;
  if (input.implementedAt) return false;
  const age = daysBetween(input.approvedAt, config.now);
  return age !== null && age > config.staleApprovedDays;
}

function candidateKey(candidate: ScoredCandidate): string {
  const opportunity = candidate.input.opportunity;
  return [
    opportunity.opportunityType || "",
    opportunity.title,
    opportunity.targetKeywords.join("|"),
    candidate.sourceKeys.join("|"),
  ].join("::");
}

function dedupeCandidates(candidates: ScoredCandidate[]): ScoredCandidate[] {
  const byKey = new Map<string, ScoredCandidate>();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    const existing = byKey.get(key);
    if (!existing || candidate.score > existing.score) {
      byKey.set(key, candidate);
    }
  }
  return Array.from(byKey.values());
}

function sortCandidates(candidates: ScoredCandidate[]): ScoredCandidate[] {
  return [...candidates].sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff) return scoreDiff;
    const priorityDiff = priorityScore(b.input.opportunity.priority) - priorityScore(a.input.opportunity.priority);
    if (priorityDiff) return priorityDiff;
    return a.input.opportunity.title.localeCompare(b.input.opportunity.title);
  });
}

function toDigestItem(candidate: ScoredCandidate, rank: number): WeeklyTop10DigestItem {
  const opportunity = candidate.input.opportunity;
  return {
    rank,
    state: candidate.state,
    title: opportunity.title,
    priority: opportunity.priority,
    confidenceScore: candidate.score,
    targetKeywords: [...opportunity.targetKeywords],
    recommendedAction: opportunity.recommendedAction || null,
    evidenceCount: opportunity.evidence?.length || 0,
    sourceKeys: candidate.sourceKeys,
  };
}

export function generateWeeklyTop10Digest(
  inputs: WeeklyTop10OpportunityInput[],
  configInput: Partial<WeeklyTop10GeneratorConfig> = {}
): WeeklyTop10Digest {
  const config = buildWeeklyTop10GeneratorConfig(configInput);
  const candidates = dedupeCandidates(
    inputs
      .map((input) => {
        const state = effectiveState(input);
        if (!isActiveState(state)) return null;
        return {
          input,
          state,
          score: scoreOpportunity(input.opportunity),
          sourceKeys: sourceKeys(input.opportunity),
        };
      })
      .filter(Boolean) as ScoredCandidate[]
  );
  const sorted = sortCandidates(candidates);
  const includedCandidates = sorted
    .filter((candidate) => candidate.score >= config.minConfidenceScore && candidate.state !== "approved")
    .slice(0, config.maxItems);
  const includedKeys = new Set(includedCandidates.map(candidateKey));
  const watchlistCandidates = sorted
    .filter((candidate) => !includedKeys.has(candidateKey(candidate)) && candidate.state !== "approved")
    .slice(0, config.maxWatchlistItems);
  const carriedOverCandidates = includedCandidates.filter((candidate) => candidate.state === "carried_over");
  const approvedStaleCandidates = sorted.filter((candidate) => isStaleApproved(candidate.input, config));

  return {
    generatedAt: config.now,
    items: includedCandidates.map(toDigestItem),
    watchlist: watchlistCandidates.map(toDigestItem),
    carriedOver: carriedOverCandidates.map(toDigestItem),
    approvedStale: approvedStaleCandidates.map(toDigestItem),
    summary: {
      totalCandidates: candidates.length,
      includedCount: includedCandidates.length,
      watchlistCount: watchlistCandidates.length,
      carriedOverCount: carriedOverCandidates.length,
      approvedStaleCount: approvedStaleCandidates.length,
      noNewOpportunities: includedCandidates.filter((candidate) => candidate.state === "new").length === 0,
    },
  };
}
