import type { SeoDraftTask, SeoEvidence, SeoOpportunity } from "./types";
import type { WeeklyTop10OpportunityInput, WeeklyTop10OpportunityState } from "./weeklyTop10Generator";

export type WeeklyTop10ApprovalStateStorageContract = {
  sourceCollection: "seoDraftTasks";
  readFields: Array<keyof SeoDraftTask>;
  writeFields: [];
  implementationStatusAvailable: false;
  notes: string[];
};

export type WeeklyTop10ApprovalStateSourceInput = {
  opportunities: SeoOpportunity[];
  draftTasks: SeoDraftTask[];
};

export const WEEKLY_TOP10_APPROVAL_STATE_STORAGE_CONTRACT: WeeklyTop10ApprovalStateStorageContract = {
  sourceCollection: "seoDraftTasks",
  readFields: [
    "id",
    "sourceId",
    "sourceFindingId",
    "title",
    "status",
    "targetKeywords",
    "evidence",
    "realTaskId",
    "convertedAt",
    "createdAt",
    "updatedAt",
  ],
  writeFields: [],
  implementationStatusAvailable: false,
  notes: [
    "This boundary is read-only and does not change Firestore schema.",
    "Draft task status is the current approval-state source.",
    "convertedAt only means a real task was created; it does not prove implementation.",
    "implemented state requires a future explicit implementation source.",
  ],
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown): string {
  return cleanString(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizeKeywords(values: string[]): string[] {
  return values.map(normalizeText).filter(Boolean).sort();
}

function evidenceKey(evidence: SeoEvidence): string {
  return [
    evidence.source,
    evidence.metric || "",
    evidence.query || "",
    evidence.url || "",
  ].map(normalizeText).join("|");
}

function evidenceKeys(values: SeoEvidence[]): string[] {
  return Array.from(new Set(values.map(evidenceKey).filter((value) => value.replace(/\|/g, "")))).sort();
}

function overlapScore(left: string[], right: string[]): number {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).length;
}

function opportunityReferenceKeys(opportunity: SeoOpportunity): string[] {
  return [
    cleanString(opportunity.sourceFindingId),
    `${normalizeText(opportunity.title)}::${normalizeKeywords(opportunity.targetKeywords).join(",")}`,
    ...evidenceKeys(opportunity.evidence || []),
  ].filter(Boolean);
}

function draftTaskReferenceKeys(task: SeoDraftTask): string[] {
  return [
    cleanString(task.sourceFindingId),
    cleanString(task.sourceId),
    `${normalizeText(task.title)}::${normalizeKeywords(task.targetKeywords).join(",")}`,
    ...evidenceKeys(task.evidence || []),
  ].filter(Boolean);
}

export function findMatchingDraftTaskForOpportunity(
  opportunity: SeoOpportunity,
  draftTasks: SeoDraftTask[]
): SeoDraftTask | null {
  const opportunityKeys = opportunityReferenceKeys(opportunity);
  let bestMatch: { task: SeoDraftTask; score: number } | null = null;

  for (const task of draftTasks) {
    const score = overlapScore(opportunityKeys, draftTaskReferenceKeys(task));
    if (score <= 0) continue;
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { task, score };
    }
  }

  return bestMatch?.task || null;
}

function stateFromDraftTask(task: SeoDraftTask | null): WeeklyTop10OpportunityState {
  if (!task) return "new";
  if (task.status === "rejected") return "rejected";
  if (task.status === "approved") return "approved";
  return "carried_over";
}

function approvedAtFromDraftTask(task: SeoDraftTask | null): string | null {
  if (!task || task.status !== "approved") return null;
  return cleanString(task.updatedAt) || cleanString(task.createdAt) || null;
}

function firstSeenAtFromDraftTask(task: SeoDraftTask | null): string | null {
  if (!task) return null;
  return cleanString(task.createdAt) || null;
}

export function buildWeeklyTop10InputsFromApprovalState(
  input: WeeklyTop10ApprovalStateSourceInput
): WeeklyTop10OpportunityInput[] {
  return input.opportunities.map((opportunity) => {
    const task = findMatchingDraftTaskForOpportunity(opportunity, input.draftTasks);
    return {
      opportunity,
      state: stateFromDraftTask(task),
      firstSeenAt: firstSeenAtFromDraftTask(task),
      approvedAt: approvedAtFromDraftTask(task),
      implementedAt: null,
    };
  });
}
