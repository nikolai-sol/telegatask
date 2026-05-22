import admin from "firebase-admin";
import { firestore } from "../../config/firebase";

export type MediaPlanStatus =
  | "parsing"
  | "researching"
  | "clarifying"
  | "summary_check"
  | "summary_editing"
  | "theories"
  | "team_tasks"
  | "pre_strategy"
  | "strategy"
  | "done";

export type MediaPlanClarification = {
  question: string;
  answer: string;
};

export type MediaPlanDiscussionItem = {
  role: "user" | "assistant";
  content: string;
};

export type MediaPlanTeamTasks = {
  targetologist: string[];
  analyst: string[];
  account: string[];
  client: string[];
};

export type MediaPlanDoc = {
  id: string;
  teamId: string;
  createdByUserId: string;
  createdByTelegramId: number;
  isActiveForUser: boolean;
  status: MediaPlanStatus;
  briefRaw: string;
  briefSummary: Record<string, unknown>;
  researchData: Record<string, unknown>;
  pendingQuestions: string[];
  clarifications: MediaPlanClarification[];
  summaryText: string;
  theoriesText: string;
  selectedTheory: string;
  teamTasks: MediaPlanTeamTasks;
  teamData: string;
  discussionHistory: MediaPlanDiscussionItem[];
  title: string;
  finalStrategy: string;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};

type CreateMediaPlanInput = {
  teamId: string;
  createdByUserId: string;
  createdByTelegramId: number;
  isActiveForUser?: boolean;
  status?: MediaPlanStatus;
  briefRaw: string;
  briefSummary?: Record<string, unknown>;
  researchData?: Record<string, unknown>;
  pendingQuestions?: string[];
  clarifications?: MediaPlanClarification[];
  summaryText?: string;
  theoriesText?: string;
  selectedTheory?: string;
  teamTasks?: Partial<MediaPlanTeamTasks>;
  teamData?: string;
  discussionHistory?: MediaPlanDiscussionItem[];
  title?: string;
  finalStrategy?: string;
};

type UpdateMediaPlanPatch = {
  teamId?: string;
  isActiveForUser?: boolean;
  status?: MediaPlanStatus;
  briefRaw?: string;
  briefSummary?: Record<string, unknown>;
  researchData?: Record<string, unknown>;
  pendingQuestions?: string[];
  clarifications?: MediaPlanClarification[];
  summaryText?: string;
  theoriesText?: string;
  selectedTheory?: string;
  teamTasks?: Partial<MediaPlanTeamTasks>;
  teamData?: string;
  discussionHistory?: MediaPlanDiscussionItem[];
  title?: string;
  finalStrategy?: string;
};

const collection = firestore.collection("mediaPlans");

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
}

function toClarifications(value: unknown): MediaPlanClarification[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const obj = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
      if (!obj) return null;
      const question = typeof obj.question === "string" ? obj.question.trim() : "";
      const answer = typeof obj.answer === "string" ? obj.answer.trim() : "";
      if (!question || !answer) return null;
      return { question, answer };
    })
    .filter(Boolean) as MediaPlanClarification[];
}

function ts(value: unknown): FirebaseFirestore.Timestamp {
  if (value instanceof admin.firestore.Timestamp) return value;
  return admin.firestore.Timestamp.now();
}

function toDiscussionHistory(value: unknown): MediaPlanDiscussionItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const obj = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
      if (!obj) return null;
      const roleRaw = String(obj.role || "").trim();
      const role = roleRaw === "assistant" ? "assistant" : roleRaw === "user" ? "user" : null;
      const content = typeof obj.content === "string" ? obj.content.trim() : "";
      if (!role || !content) return null;
      return { role, content };
    })
    .filter(Boolean) as MediaPlanDiscussionItem[];
}

function toTeamTasks(value: unknown): MediaPlanTeamTasks {
  const obj = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    targetologist: toStringArray(obj.targetologist),
    analyst: toStringArray(obj.analyst),
    account: toStringArray(obj.account),
    client: toStringArray(obj.client),
  };
}

function normalizeTeamTasks(value: Partial<MediaPlanTeamTasks> | undefined): MediaPlanTeamTasks {
  return {
    targetologist: toStringArray(value?.targetologist),
    analyst: toStringArray(value?.analyst),
    account: toStringArray(value?.account),
    client: toStringArray(value?.client),
  };
}

function normalizeStatus(value: unknown): MediaPlanStatus {
  const raw = String(value || "").trim();
  if (
    raw === "parsing" ||
    raw === "researching" ||
    raw === "clarifying" ||
    raw === "summary_check" ||
    raw === "summary_editing" ||
    raw === "theories" ||
    raw === "team_tasks" ||
    raw === "pre_strategy" ||
    raw === "strategy" ||
    raw === "done"
  ) {
    return raw;
  }

  if (raw === "stage1") return "clarifying";
  if (raw === "stage2") return "strategy";
  return "parsing";
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

function docToMediaPlan(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot): MediaPlanDoc {
  const data = doc.data() || {};

  return {
    id: doc.id,
    teamId: String(data.teamId || ""),
    createdByUserId: String(data.createdByUserId || ""),
    createdByTelegramId: Number(data.createdByTelegramId || 0),
    isActiveForUser: toBoolean(data.isActiveForUser),
    status: normalizeStatus(data.status),
    briefRaw: String(data.briefRaw || ""),
    briefSummary: toObject(data.briefSummary),
    researchData: toObject(data.researchData),
    pendingQuestions: toStringArray(data.pendingQuestions),
    clarifications: toClarifications(data.clarifications),
    summaryText: typeof data.summaryText === "string" ? data.summaryText : "",
    theoriesText: typeof data.theoriesText === "string" ? data.theoriesText : "",
    selectedTheory: typeof data.selectedTheory === "string" ? data.selectedTheory : "",
    teamTasks: toTeamTasks(data.teamTasks),
    teamData: typeof data.teamData === "string" ? data.teamData : "",
    discussionHistory: toDiscussionHistory(data.discussionHistory),
    title: typeof data.title === "string" ? data.title : "",
    finalStrategy: typeof data.finalStrategy === "string" ? data.finalStrategy : "",
    createdAt: ts(data.createdAt),
    updatedAt: ts(data.updatedAt),
  };
}

export async function create(input: CreateMediaPlanInput): Promise<MediaPlanDoc> {
  const now = admin.firestore.Timestamp.now();
  const payload = {
    teamId: input.teamId,
    createdByUserId: input.createdByUserId,
    createdByTelegramId: Number(input.createdByTelegramId || 0),
    isActiveForUser: input.isActiveForUser === true,
    status: input.status || ("parsing" as MediaPlanStatus),
    briefRaw: input.briefRaw,
    briefSummary: input.briefSummary ?? {},
    researchData: input.researchData ?? {},
    pendingQuestions: input.pendingQuestions ?? [],
    clarifications: input.clarifications ?? [],
    summaryText: input.summaryText ?? "",
    theoriesText: input.theoriesText ?? "",
    selectedTheory: input.selectedTheory ?? "",
    teamTasks: normalizeTeamTasks(input.teamTasks),
    teamData: input.teamData ?? "",
    discussionHistory: input.discussionHistory ?? [],
    title: input.title ?? "",
    finalStrategy: input.finalStrategy ?? "",
    createdAt: now,
    updatedAt: now,
  };

  const ref = await collection.add(payload);
  const snap = await ref.get();
  return docToMediaPlan(snap);
}

export async function findById(id: string): Promise<MediaPlanDoc | null> {
  const snap = await collection.doc(id).get();
  if (!snap.exists) return null;
  return docToMediaPlan(snap);
}

export async function findActiveByUser(telegramUserId: number): Promise<MediaPlanDoc | null> {
  const snapshot = await collection
    .where("createdByTelegramId", "==", Number(telegramUserId))
    .limit(50)
    .get();

  const items = snapshot.docs
    .map((doc) => docToMediaPlan(doc))
    .filter((x) => x.status !== "done")
    .sort((a, b) => b.updatedAt.toMillis() - a.updatedAt.toMillis());

  const selected = items.find((x) => x.isActiveForUser);
  return selected ?? items[0] ?? null;
}

export async function setActivePlanForUser(telegramUserId: number, planId: string): Promise<void> {
  const userId = Number(telegramUserId);
  const targetPlanId = String(planId || "").trim();
  if (!targetPlanId) return;

  const snapshot = await collection
    .where("createdByTelegramId", "==", userId)
    .limit(100)
    .get();

  const batch = firestore.batch();
  for (const doc of snapshot.docs) {
    const plan = docToMediaPlan(doc);
    const shouldBeActive = plan.id === targetPlanId && plan.status !== "done";
    batch.set(
      doc.ref,
      {
        isActiveForUser: shouldBeActive,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true }
    );
  }
  await batch.commit();
}

export async function update(id: string, patch: UpdateMediaPlanPatch): Promise<void> {
  const payload: Record<string, unknown> = {
    updatedAt: admin.firestore.Timestamp.now(),
  };

  if (typeof patch.teamId === "string" && patch.teamId.trim()) payload.teamId = patch.teamId.trim();
  if (typeof patch.isActiveForUser === "boolean") payload.isActiveForUser = patch.isActiveForUser;
  if (patch.status) payload.status = patch.status;
  if (typeof patch.briefRaw === "string") payload.briefRaw = patch.briefRaw;
  if (patch.briefSummary) payload.briefSummary = patch.briefSummary;
  if (patch.researchData) payload.researchData = patch.researchData;
  if (Array.isArray(patch.pendingQuestions)) payload.pendingQuestions = patch.pendingQuestions;
  if (Array.isArray(patch.clarifications)) payload.clarifications = patch.clarifications;
  if (typeof patch.summaryText === "string") payload.summaryText = patch.summaryText;
  if (typeof patch.theoriesText === "string") payload.theoriesText = patch.theoriesText;
  if (typeof patch.selectedTheory === "string") payload.selectedTheory = patch.selectedTheory;
  if (patch.teamTasks) payload.teamTasks = normalizeTeamTasks(patch.teamTasks);
  if (typeof patch.teamData === "string") payload.teamData = patch.teamData;
  if (Array.isArray(patch.discussionHistory)) payload.discussionHistory = patch.discussionHistory;
  if (typeof patch.title === "string") payload.title = patch.title;
  if (typeof patch.finalStrategy === "string") payload.finalStrategy = patch.finalStrategy;

  await collection.doc(id).set(payload, { merge: true });
}

export async function findAllByTeam(teamId: string): Promise<MediaPlanDoc[]> {
  const id = String(teamId || "").trim();
  if (!id) return [];

  const snapshot = await collection
    .where("teamId", "==", id)
    .orderBy("updatedAt", "desc")
    .limit(20)
    .get();

  return snapshot.docs.map((doc) => docToMediaPlan(doc));
}

// Backward-compatible aliases (existing imports in other files)
export const createMediaPlan = create;
export const getMediaPlanById = findById;
export const findActiveMediaPlanByUser = findActiveByUser;
export const setMediaPlanActiveForUser = setActivePlanForUser;
export const updateMediaPlan = update;
