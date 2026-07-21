import { createHash } from "crypto";
import type { SeoOpportunity } from "./types";
import type { WeeklyTop10OpportunityInput } from "./weeklyTop10Generator";

export type WeeklyTop10ApprovalDecision = "approved" | "rejected";

export type WeeklyTop10ApprovalDecisionReviewer = {
  userId: string;
  telegramUserId?: number | null;
};

export type WeeklyTop10ApprovalDecisionSource = "telegram_dev_callback" | "manual_backfill";

export type WeeklyTop10ApprovalDecisionCallbackTranscript = {
  updateId: number | null;
  callbackQueryId: string | null;
  messageId: number | null;
  chatId: string | null;
};

export type WeeklyTop10ApprovalTaskStatus =
  | "draft"
  | "awaiting_medical_review"
  | "needs_target_page";

export type WeeklyTop10ApprovalTaskExecutionStatus =
  | "created"
  | "already_created"
  | "execution_pending";

export type WeeklyTop10ApprovalDecisionRecord = {
  id: string;
  teamId: string;
  runId: string;
  opportunityId: string;
  clusterId: string | null;
  draftTaskId: string | null;
  decision: WeeklyTop10ApprovalDecision;
  rejectReason: string | null;
  reviewer: WeeklyTop10ApprovalDecisionReviewer;
  decidedAt: string;
  source: WeeklyTop10ApprovalDecisionSource;
  callbackData: string | null;
  callbackTranscript?: WeeklyTop10ApprovalDecisionCallbackTranscript | null;
  executionStatus?: WeeklyTop10ApprovalTaskExecutionStatus | null;
  taskId?: string | null;
  taskStatus?: WeeklyTop10ApprovalTaskStatus | null;
  taskUrl?: string | null;
  taskCreatedAt?: string | null;
  taskUpdatedAt?: string | null;
  taskTargetUrl?: string | null;
  taskOpportunityType?: string | null;
  executionError?: string | null;
};

export type WeeklyTop10ApprovalDecisionStore = {
  getDecision(input: {
    teamId: string;
    opportunityId: string;
  }): Promise<WeeklyTop10ApprovalDecisionRecord | null>;
  createDecision(record: WeeklyTop10ApprovalDecisionRecord): Promise<WeeklyTop10ApprovalDecisionRecord>;
};

export type WeeklyTop10ApprovalDecisionPersistInput = {
  writesEnabled: boolean;
  teamId: string;
  runId: string;
  opportunityId: string;
  clusterId?: string | null;
  draftTaskId?: string | null;
  decision: WeeklyTop10ApprovalDecision;
  rejectReason?: string | null;
  reviewer: WeeklyTop10ApprovalDecisionReviewer;
  decidedAt: string;
  callbackData?: string | null;
  source?: WeeklyTop10ApprovalDecisionSource;
  callbackTranscript?: WeeklyTop10ApprovalDecisionCallbackTranscript | null;
};

export type WeeklyTop10ApprovalDecisionPersistResult = {
  status: "created" | "already_decided" | "writes_disabled";
  decision: WeeklyTop10ApprovalDecisionRecord | null;
  answerText: string;
  sideEffects: {
    firestoreWrite: boolean;
    approvalCommandExecuted: false;
    productionPipelineRun: false;
    weeklyDigestPersisted: false;
  };
};

export type WeeklyTop10ApprovalDecisionStateInput = {
  opportunities: SeoOpportunity[];
  decisions: WeeklyTop10ApprovalDecisionRecord[];
  previouslyPresentedOpportunityIds?: string[];
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildWeeklyTop10OpportunityId(opportunity: SeoOpportunity): string {
  const basis = {
    sourceFindingId: cleanString(opportunity.sourceFindingId),
    type: cleanString(opportunity.opportunityType),
    title: cleanString(opportunity.title),
    targetUrl: cleanString(opportunity.targetUrl),
    targetKeywords: [...(opportunity.targetKeywords || [])].map(cleanString).filter(Boolean).sort(),
    evidence: (opportunity.evidence || []).map((item) => ({
      source: item.source,
      metric: item.metric || "",
      query: item.query || "",
      url: item.url || "",
      value: item.value ?? null,
    })),
  };
  const hash = createHash("sha1").update(stableJson(basis)).digest("hex").slice(0, 16);
  return `seo_opp_${hash}`;
}

export function buildWeeklyTop10ApprovalDecisionId(input: {
  teamId: string;
  opportunityId: string;
}): string {
  const safeTeam = cleanString(input.teamId).replace(/[^a-zA-Z0-9_-]/g, "_") || "team";
  const safeOpportunity = cleanString(input.opportunityId).replace(/[^a-zA-Z0-9_-]/g, "_") || "opportunity";
  return `${safeTeam}_${safeOpportunity}`;
}

function emptySideEffects(firestoreWrite: boolean): WeeklyTop10ApprovalDecisionPersistResult["sideEffects"] {
  return {
    firestoreWrite,
    approvalCommandExecuted: false,
    productionPipelineRun: false,
    weeklyDigestPersisted: false,
  };
}

export async function persistWeeklyTop10ApprovalDecision(
  store: WeeklyTop10ApprovalDecisionStore,
  input: WeeklyTop10ApprovalDecisionPersistInput
): Promise<WeeklyTop10ApprovalDecisionPersistResult> {
  if (!input.writesEnabled) {
    return {
      status: "writes_disabled",
      decision: null,
      answerText: "Запись решений отключена.",
      sideEffects: emptySideEffects(false),
    };
  }

  const existing = await store.getDecision({
    teamId: input.teamId,
    opportunityId: input.opportunityId,
  });
  if (existing) {
    return {
      status: "already_decided",
      decision: existing,
      answerText: `Уже решено: ${existing.decision === "approved" ? "одобрено" : "отклонено"}.`,
      sideEffects: emptySideEffects(false),
    };
  }

  const record: WeeklyTop10ApprovalDecisionRecord = {
    id: buildWeeklyTop10ApprovalDecisionId({
      teamId: input.teamId,
      opportunityId: input.opportunityId,
    }),
    teamId: input.teamId,
    runId: input.runId,
    opportunityId: input.opportunityId,
    clusterId: input.clusterId || null,
    draftTaskId: input.draftTaskId || null,
    decision: input.decision,
    rejectReason: input.decision === "rejected" ? cleanString(input.rejectReason) || null : null,
    reviewer: input.reviewer,
    decidedAt: input.decidedAt,
    source: input.source || "telegram_dev_callback",
    callbackData: input.callbackData || null,
    callbackTranscript: input.callbackTranscript || null,
  };

  return {
    status: "created",
    decision: await store.createDecision(record),
    answerText: input.decision === "approved" ? "Решение сохранено: одобрено." : "Решение сохранено: отклонено.",
    sideEffects: emptySideEffects(true),
  };
}

export function buildWeeklyTop10InputsFromApprovalDecisions(
  input: WeeklyTop10ApprovalDecisionStateInput
): WeeklyTop10OpportunityInput[] {
  const decisionsByOpportunity = new Map(input.decisions.map((decision) => [decision.opportunityId, decision]));
  const previousIds = new Set(input.previouslyPresentedOpportunityIds || []);

  return input.opportunities.map((opportunity) => {
    const opportunityId = buildWeeklyTop10OpportunityId(opportunity);
    const decision = decisionsByOpportunity.get(opportunityId);
    if (decision) {
      return {
        opportunity,
        state: decision.decision === "approved" ? "approved" : "rejected",
        firstSeenAt: null,
        approvedAt: decision.decision === "approved" ? decision.decidedAt : null,
        implementedAt: null,
      };
    }

    return {
      opportunity,
      state: previousIds.has(opportunityId) ? "carried_over" : "new",
      firstSeenAt: null,
      approvedAt: null,
      implementedAt: null,
    };
  });
}
