import { firestore } from "../../config/firebase";
import {
  buildWeeklyTop10ApprovalDecisionId,
  type WeeklyTop10ApprovalDecisionCallbackTranscript,
  type WeeklyTop10ApprovalDecisionRecord,
  type WeeklyTop10ApprovalDecisionSource,
  type WeeklyTop10ApprovalTaskExecutionStatus,
  type WeeklyTop10ApprovalTaskStatus,
  type WeeklyTop10ApprovalDecisionStore,
} from "./weeklyTop10ApprovalDecision";

export const WEEKLY_TOP10_APPROVAL_DECISION_WRITES_FLAG = "SEO_WEEKLY_TOP10_APPROVAL_DECISION_WRITES";
export const WEEKLY_TOP10_APPROVAL_DECISION_COLLECTION = "seoWeeklyTop10ApprovalDecisions";

const collection = firestore.collection(WEEKLY_TOP10_APPROVAL_DECISION_COLLECTION);

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDecision(value: unknown): WeeklyTop10ApprovalDecisionRecord["decision"] {
  return value === "rejected" ? "rejected" : "approved";
}

function normalizeReviewer(value: unknown): WeeklyTop10ApprovalDecisionRecord["reviewer"] {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    userId: cleanString(data.userId),
    telegramUserId: typeof data.telegramUserId === "number" ? data.telegramUserId : null,
  };
}

function normalizeSource(value: unknown): WeeklyTop10ApprovalDecisionSource {
  return value === "manual_backfill" ? "manual_backfill" : "telegram_dev_callback";
}

function normalizeTranscript(value: unknown): WeeklyTop10ApprovalDecisionCallbackTranscript | null {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!data) return null;
  return {
    updateId: typeof data.updateId === "number" ? data.updateId : null,
    callbackQueryId: cleanString(data.callbackQueryId) || null,
    messageId: typeof data.messageId === "number" ? data.messageId : null,
    chatId: cleanString(data.chatId) || null,
  };
}

function normalizeTaskStatus(value: unknown): WeeklyTop10ApprovalTaskStatus | null {
  if (value === "draft" || value === "awaiting_medical_review" || value === "needs_target_page") return value;
  return null;
}

function normalizeExecutionStatus(value: unknown): WeeklyTop10ApprovalTaskExecutionStatus | null {
  if (value === "created" || value === "already_created" || value === "execution_pending") return value;
  return null;
}

function docToDecision(id: string, data: FirebaseFirestore.DocumentData): WeeklyTop10ApprovalDecisionRecord {
  return {
    id,
    teamId: cleanString(data.teamId),
    runId: cleanString(data.runId),
    opportunityId: cleanString(data.opportunityId),
    clusterId: cleanString(data.clusterId) || null,
    draftTaskId: cleanString(data.draftTaskId) || null,
    decision: normalizeDecision(data.decision),
    rejectReason: cleanString(data.rejectReason) || null,
    reviewer: normalizeReviewer(data.reviewer),
    decidedAt: cleanString(data.decidedAt),
    source: normalizeSource(data.source),
    callbackData: cleanString(data.callbackData) || null,
    callbackTranscript: normalizeTranscript(data.callbackTranscript),
    executionStatus: normalizeExecutionStatus(data.executionStatus),
    taskId: cleanString(data.taskId) || null,
    taskStatus: normalizeTaskStatus(data.taskStatus),
    taskUrl: cleanString(data.taskUrl) || null,
    taskCreatedAt: cleanString(data.taskCreatedAt) || null,
    taskUpdatedAt: cleanString(data.taskUpdatedAt) || null,
    taskTargetUrl: cleanString(data.taskTargetUrl) || null,
    taskOpportunityType: cleanString(data.taskOpportunityType) || null,
    executionError: cleanString(data.executionError) || null,
  };
}

export function weeklyTop10ApprovalDecisionWritesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[WEEKLY_TOP10_APPROVAL_DECISION_WRITES_FLAG] === "1";
}

export async function getWeeklyTop10ApprovalDecision(input: {
  teamId: string;
  opportunityId: string;
}): Promise<WeeklyTop10ApprovalDecisionRecord | null> {
  const id = buildWeeklyTop10ApprovalDecisionId(input);
  const snapshot = await collection.doc(id).get();
  if (!snapshot.exists) return null;
  return docToDecision(snapshot.id, snapshot.data() || {});
}

export async function createWeeklyTop10ApprovalDecision(
  record: WeeklyTop10ApprovalDecisionRecord
): Promise<WeeklyTop10ApprovalDecisionRecord> {
  await collection.doc(record.id).set(record, { merge: false });
  return record;
}

export async function listWeeklyTop10ApprovalDecisionsByTeam(teamId: string): Promise<WeeklyTop10ApprovalDecisionRecord[]> {
  const snapshot = await collection.where("teamId", "==", teamId).get();
  return snapshot.docs.map((doc) => docToDecision(doc.id, doc.data()));
}

export async function updateWeeklyTop10ApprovalDecisionTaskExecution(input: {
  decisionId: string;
  executionStatus: WeeklyTop10ApprovalTaskExecutionStatus;
  taskId?: string | null;
  taskStatus?: WeeklyTop10ApprovalTaskStatus | null;
  taskUrl?: string | null;
  taskCreatedAt?: string | null;
  taskUpdatedAt?: string | null;
  taskTargetUrl?: string | null;
  taskOpportunityType?: string | null;
  executionError?: string | null;
}): Promise<void> {
  await collection.doc(input.decisionId).set(
    {
      executionStatus: input.executionStatus,
      taskId: input.taskId || null,
      taskStatus: input.taskStatus || null,
      taskUrl: input.taskUrl || null,
      taskCreatedAt: input.taskCreatedAt || null,
      taskUpdatedAt: input.taskUpdatedAt || null,
      taskTargetUrl: input.taskTargetUrl || null,
      taskOpportunityType: input.taskOpportunityType || null,
      executionError: input.executionError || null,
    },
    { merge: true }
  );
}

export const weeklyTop10ApprovalDecisionFirestoreStore: WeeklyTop10ApprovalDecisionStore = {
  getDecision: getWeeklyTop10ApprovalDecision,
  createDecision: createWeeklyTop10ApprovalDecision,
};
