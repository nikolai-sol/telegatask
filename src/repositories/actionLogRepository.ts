import { firestore } from "../config/firebase";

export type ActionType =
  | "task_created"
  | "task_status_updated"
  | "task_deleted"
  | "knowledge_added"
  | "knowledge_search"
  | "ask_executed"
  | "team_linked"
  | "role_set"
  | "permission_updated"
  | "project_attached"
  | "scan_executed"
  | "reminder_sent"
  | "followup_sent"
  | "unanswered_mention_sent"
  | "brief_sent"
  | "digest_sent"
  | "digest_run";

export interface ActionLogEntry {
  id: string;
  action: ActionType;
  userId?: string | null;
  targetId?: string | null;
  targetType?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
}

export interface LogActionInput {
  action: ActionType;
  userId?: string | null;
  targetId?: string | null;
  targetType?: string | null;
  payload?: Record<string, unknown>;
}

export async function logAction(input: LogActionInput): Promise<ActionLogEntry> {
  const now = new Date().toISOString();
  const doc = {
    action: input.action,
    userId: input.userId ?? null,
    targetId: input.targetId ?? null,
    targetType: input.targetType ?? null,
    payload: input.payload ?? null,
    createdAt: now,
  };

  const docRef = await firestore.collection("actionLogs").add(doc);
  return { id: docRef.id, ...doc };
}

export async function listActionLogs(
  limitCount: number = 100
): Promise<ActionLogEntry[]> {
  const snapshot = await firestore
    .collection("actionLogs")
    .orderBy("createdAt", "desc")
    .limit(limitCount)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      action: data.action,
      userId: data.userId ?? null,
      targetId: data.targetId ?? null,
      targetType: data.targetType ?? null,
      payload: data.payload ?? null,
      createdAt: data.createdAt,
    } as ActionLogEntry;
  });
}
