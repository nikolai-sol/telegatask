import { firestore } from "../config/firebase";
import type {
  KnowledgeItemV2,
  KnowledgeType,
  KnowledgeSourceTelegram,
  KnowledgeFileMeta,
} from "../models/knowledge";

export type { KnowledgeItemV2 };

/** Legacy alias for backward compat in bot handlers */
export type KnowledgeItem = KnowledgeItemV2;

export interface CreateKnowledgeInput {
  type?: KnowledgeType;
  text: string;
  title?: string | null;
  tags?: string[];
  projectId?: string | null;
  teamId?: string | null;
  visibility?: "personal" | "team" | "chat";
  importance?: "normal" | "important";
  source?: KnowledgeSourceTelegram | null;
  fileMeta?: KnowledgeFileMeta | null;
  createdByUserId: string;
  /** Legacy: for migration, keep in sync with source */
  sourceChatId?: string | null;
  sourceChatTitle?: string | null;
  sourceMessageId?: number | null;
  /** Дедупликация file_ref: tg:<chatId>:<messageId>:<fileId> */
  dedupeKey?: string | null;
}

/** Normalize raw Firestore doc to KnowledgeItemV2 (migration in place) */
function normalizeDoc(id: string, data: Record<string, unknown>): KnowledgeItemV2 {
  const hasV2 = "type" in data && data.type;
  const content = (data.content as string) ?? "";
  const isImportant = (data.isImportant as boolean) ?? false;

  const type = (hasV2 ? data.type : "note") as KnowledgeType;
  const text = (hasV2 ? (data.text as string) : content) ?? "";
  const tags = (data.tags as string[] | undefined) ?? (isImportant ? ["important"] : []);

  let source = (data.source as KnowledgeSourceTelegram | undefined) ?? null;
  if (!source && (data.sourceChatId || data.sourceMessageId != null)) {
    source = {
      kind: "telegram",
      chatId: String(data.sourceChatId ?? ""),
      messageId: Number(data.sourceMessageId ?? 0),
      fromUserId: data.createdByUserId as string | undefined,
    };
    if (data.telegramChatId != null) {
      source.telegramChatId = Number(data.telegramChatId);
    }
  }

  let index = (data.index as { status: "referenced" | "indexed" | "mirrored"; updatedAt?: string } | undefined) ?? null;
  if (!index && text) {
    index = { status: "indexed" as const, updatedAt: (data.updatedAt as string) ?? new Date().toISOString() };
  }

  return {
    id,
    type,
    source,
    text,
    title: (data.title as string | undefined) ?? null,
    tags,
    projectId: (data.projectId as string | undefined) ?? null,
    teamId: (data.teamId as string | undefined) ?? null,
    visibility: (data.visibility as "personal" | "team" | "chat") ?? "personal",
    importance: isImportant ? "important" : ((data.importance as "normal" | "important") ?? "normal"),
    fileMeta: (data.fileMeta as KnowledgeFileMeta | undefined) ?? null,
    index,
    createdByUserId: data.createdByUserId as string,
    sourceChatId: (data.sourceChatId as string | undefined) ?? null,
    sourceChatTitle: (data.sourceChatTitle as string | undefined) ?? null,
    sourceMessageId: (data.sourceMessageId as number | undefined) ?? null,
    createdAt: (data.createdAt as string) ?? "",
    updatedAt: (data.updatedAt as string) ?? "",
  };
}

export async function addKnowledgeEntry(
  input: CreateKnowledgeInput
): Promise<KnowledgeItemV2> {
  const now = new Date().toISOString();

  const payload: Record<string, unknown> = {
    type: input.type ?? "note",
    text: input.text,
    title: input.title ?? null,
    tags: input.tags ?? [],
    projectId: input.projectId ?? null,
    teamId: input.teamId ?? null,
    visibility: input.visibility ?? "personal",
    importance: input.importance ?? "normal",
    source: input.source ?? null,
    fileMeta: input.fileMeta ?? null,
    dedupeKey: input.dedupeKey ?? null,
    index: {
      status: input.text ? "indexed" : "referenced",
      updatedAt: now,
    },
    createdByUserId: input.createdByUserId,
    sourceChatId: input.sourceChatId ?? null,
    sourceChatTitle: input.sourceChatTitle ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await firestore.collection("knowledge").add(payload);
  return normalizeDoc(docRef.id, payload);
}

export async function getKnowledgeById(id: string): Promise<KnowledgeItemV2 | null> {
  const doc = await firestore.collection("knowledge").doc(id).get();
  if (!doc.exists) return null;
  return normalizeDoc(doc.id, doc.data()!);
}

/** Поиск по dedupeKey (для дедупликации file_ref) */
export async function findKnowledgeByDedupeKey(
  dedupeKey: string,
  createdByUserId: string
): Promise<KnowledgeItemV2 | null> {
  const snapshot = await firestore
    .collection("knowledge")
    .where("dedupeKey", "==", dedupeKey)
    .where("createdByUserId", "==", createdByUserId)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return normalizeDoc(doc.id, doc.data());
}

export async function listKnowledgeByUser(
  userId: string,
  limitCount: number = 200
): Promise<KnowledgeItemV2[]> {
  const snapshot = await firestore
    .collection("knowledge")
    .where("createdByUserId", "==", userId)
    .orderBy("createdAt", "desc")
    .limit(limitCount)
    .get();

  return snapshot.docs.map((doc) => normalizeDoc(doc.id, doc.data()));
}

export interface ListKnowledgeScope {
  userId: string;
  chatId?: string | null;
  telegramChatId?: number | null;
  projectId?: string | null;
  teamId?: string | null;
  limit?: number;
}

/** Список для поиска/ask: по scope пользователя */
export async function listKnowledgeForSearch(
  scope: ListKnowledgeScope
): Promise<KnowledgeItemV2[]> {
  const limit = scope.limit ?? 500;

  let query = firestore
    .collection("knowledge")
    .where("createdByUserId", "==", scope.userId)
    .orderBy("createdAt", "desc")
    .limit(limit);

  const snapshot = await query.get();
  let items = snapshot.docs.map((doc) => normalizeDoc(doc.id, doc.data()));

  if (scope.chatId || scope.telegramChatId != null) {
    items = items.filter((i) => {
      if (scope.chatId && (i.sourceChatId === scope.chatId || i.source?.chatId === scope.chatId)) return true;
      if (scope.telegramChatId != null && (i.source?.telegramChatId === scope.telegramChatId || i.sourceChatId === String(scope.telegramChatId))) return true;
      return false;
    });
  }
  if (scope.projectId) {
    items = items.filter((i) => i.projectId === scope.projectId);
  }
  if (scope.teamId) {
    items = items.filter((i) => i.teamId === scope.teamId);
  }

  return items;
}

/** Important knowledge за период для digest (scope: user + chat/team) */
export async function listImportantKnowledgeForDigest(
  scope: ListKnowledgeScope & { fromIso: string; toIso: string }
): Promise<KnowledgeItemV2[]> {
  const limit = 500;
  const query = firestore
    .collection("knowledge")
    .where("createdByUserId", "==", scope.userId)
    .orderBy("createdAt", "desc")
    .limit(limit);

  const snapshot = await query.get();
  let items = snapshot.docs.map((doc) => normalizeDoc(doc.id, doc.data()));

  // importance or "important" tag
  items = items.filter(
    (i) => i.importance === "important" || (i.tags ?? []).includes("important")
  );

  // date range
  items = items.filter(
    (i) => i.createdAt >= scope.fromIso && i.createdAt <= scope.toIso
  );

  // chat/team scope
  if (scope.chatId || scope.telegramChatId != null) {
    items = items.filter((i) => {
      if (scope.chatId && (i.sourceChatId === scope.chatId || i.source?.chatId === scope.chatId)) return true;
      if (scope.telegramChatId != null && (i.source?.telegramChatId === scope.telegramChatId || i.sourceChatId === String(scope.telegramChatId))) return true;
      return false;
    });
  }
  if (scope.teamId) {
    items = items.filter((i) => i.teamId === scope.teamId);
  }

  return items.slice(0, 50);
}
