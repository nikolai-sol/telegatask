import admin from "firebase-admin";
import { firestore } from "../../config/firebase";
import type { MediaBriefSummary } from "./mediaPlanning.prompts";

export type MediaPlanStatus = "stage1" | "stage2" | "done";

export type MediaPlanHistoryItem = {
  role: "user" | "model";
  content: string;
};

export type MediaPlanDoc = {
  id: string;
  teamId: string;
  createdByUserId: string;
  status: MediaPlanStatus;
  briefRaw: string;
  briefSummary: MediaBriefSummary;
  conversationHistory: MediaPlanHistoryItem[];
  finalStrategy?: string;
  awaitingInput?: "stage1" | "stage2" | null;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};

type CreateMediaPlanInput = {
  teamId: string;
  createdByUserId: string;
  briefRaw: string;
  briefSummary: MediaBriefSummary;
  conversationHistory?: MediaPlanHistoryItem[];
};

type UpdateMediaPlanPatch = {
  teamId?: string;
  status?: MediaPlanStatus;
  briefRaw?: string;
  briefSummary?: MediaBriefSummary;
  conversationHistory?: MediaPlanHistoryItem[];
  finalStrategy?: string | null;
  awaitingInput?: "stage1" | "stage2" | null;
};

const collection = firestore.collection("mediaPlans");

function toHistory(raw: unknown): MediaPlanHistoryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => {
      const obj = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
      if (!obj) return null;
      const role = obj.role === "model" ? "model" : obj.role === "user" ? "user" : null;
      const content = typeof obj.content === "string" ? obj.content : "";
      if (!role || !content.trim()) return null;
      return { role, content } as MediaPlanHistoryItem;
    })
    .filter(Boolean) as MediaPlanHistoryItem[];
}

function defaultSummary(): MediaBriefSummary {
  return {
    target_audience: "не указано",
    budget: { total: 0, currency: "RUB" },
    geo: [],
    channels: [],
    goal: "не указано",
    timing: { start: null, end: null },
    kpi: [],
    unclear: [],
  };
}

function toSummary(raw: unknown): MediaBriefSummary {
  if (!raw || typeof raw !== "object") return defaultSummary();
  const obj = raw as Record<string, unknown>;
  const budgetObj = obj.budget && typeof obj.budget === "object" ? (obj.budget as Record<string, unknown>) : {};
  const timingObj = obj.timing && typeof obj.timing === "object" ? (obj.timing as Record<string, unknown>) : {};
  const total = Number(budgetObj.total);
  const currency = String(budgetObj.currency || "RUB").toUpperCase();

  return {
    target_audience: typeof obj.target_audience === "string" ? obj.target_audience : "не указано",
    budget: {
      total: Number.isFinite(total) && total >= 0 ? total : 0,
      currency: currency === "USD" || currency === "EUR" ? currency : "RUB",
    },
    geo: Array.isArray(obj.geo) ? obj.geo.map((x) => String(x)).filter(Boolean) : [],
    channels: Array.isArray(obj.channels) ? obj.channels.map((x) => String(x)).filter(Boolean) : [],
    goal: typeof obj.goal === "string" ? obj.goal : "не указано",
    timing: {
      start: typeof timingObj.start === "string" && timingObj.start ? timingObj.start : null,
      end: typeof timingObj.end === "string" && timingObj.end ? timingObj.end : null,
    },
    kpi: Array.isArray(obj.kpi) ? obj.kpi.map((x) => String(x)).filter(Boolean) : [],
    unclear: Array.isArray(obj.unclear) ? obj.unclear.map((x) => String(x)).filter(Boolean) : [],
  };
}

function ts(value: unknown): FirebaseFirestore.Timestamp {
  if (value instanceof admin.firestore.Timestamp) return value;
  return admin.firestore.Timestamp.now();
}

function docToMediaPlan(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot): MediaPlanDoc {
  const data = doc.data() || {};
  return {
    id: doc.id,
    teamId: String(data.teamId || ""),
    createdByUserId: String(data.createdByUserId || ""),
    status: (String(data.status || "stage1") as MediaPlanStatus),
    briefRaw: String(data.briefRaw || ""),
    briefSummary: toSummary(data.briefSummary),
    conversationHistory: toHistory(data.conversationHistory),
    finalStrategy: typeof data.finalStrategy === "string" ? data.finalStrategy : undefined,
    awaitingInput:
      data.awaitingInput === "stage1" || data.awaitingInput === "stage2" ? data.awaitingInput : null,
    createdAt: ts(data.createdAt),
    updatedAt: ts(data.updatedAt),
  };
}

export async function createMediaPlan(input: CreateMediaPlanInput): Promise<MediaPlanDoc> {
  const now = admin.firestore.Timestamp.now();
  const payload = {
    teamId: input.teamId,
    createdByUserId: input.createdByUserId,
    status: "stage1" as MediaPlanStatus,
    briefRaw: input.briefRaw,
    briefSummary: input.briefSummary,
    conversationHistory: input.conversationHistory ?? [],
    finalStrategy: null,
    awaitingInput: null,
    createdAt: now,
    updatedAt: now,
  };

  const ref = await collection.add(payload);
  const snap = await ref.get();
  return docToMediaPlan(snap);
}

export async function getMediaPlanById(id: string): Promise<MediaPlanDoc | null> {
  const snap = await collection.doc(id).get();
  if (!snap.exists) return null;
  return docToMediaPlan(snap);
}

export async function findActiveMediaPlanByUser(userId: string): Promise<MediaPlanDoc | null> {
  const snapshot = await collection
    .where("createdByUserId", "==", userId)
    .limit(50)
    .get();

  const items = snapshot.docs
    .map((doc) => docToMediaPlan(doc))
    .filter((x) => x.status !== "done")
    .sort((a, b) => b.updatedAt.toMillis() - a.updatedAt.toMillis());

  return items[0] ?? null;
}

export async function updateMediaPlan(id: string, patch: UpdateMediaPlanPatch): Promise<void> {
  const payload: Record<string, unknown> = {
    updatedAt: admin.firestore.Timestamp.now(),
  };

  if (typeof patch.teamId === "string" && patch.teamId.trim()) payload.teamId = patch.teamId.trim();
  if (patch.status) payload.status = patch.status;
  if (typeof patch.briefRaw === "string") payload.briefRaw = patch.briefRaw;
  if (patch.briefSummary) payload.briefSummary = patch.briefSummary;
  if (Array.isArray(patch.conversationHistory)) payload.conversationHistory = patch.conversationHistory;
  if (patch.finalStrategy !== undefined) payload.finalStrategy = patch.finalStrategy ?? null;
  if ("awaitingInput" in patch) payload.awaitingInput = patch.awaitingInput ?? null;

  await collection.doc(id).set(payload, { merge: true });
}
