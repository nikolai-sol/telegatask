import { firestore } from "../config/firebase";

export interface KnowledgeItem {
  id: string;
  content: string;
  isImportant: boolean;
  createdByUserId: string;
  sourceChatId?: string | null;
  sourceChatTitle?: string | null;
  sourceMessageId?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKnowledgeInput {
  content: string;
  isImportant?: boolean;
  createdByUserId: string;
  sourceChatId?: string | null;
  sourceChatTitle?: string | null;
  sourceMessageId?: number | null;
}

export async function addKnowledgeEntry(
  input: CreateKnowledgeInput
): Promise<KnowledgeItem> {
  const now = new Date().toISOString();
  const payload = {
    content: input.content,
    isImportant: input.isImportant ?? false,
    createdByUserId: input.createdByUserId,
    sourceChatId: input.sourceChatId ?? null,
    sourceChatTitle: input.sourceChatTitle ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await firestore.collection("knowledge").add(payload);

  return {
    id: docRef.id,
    ...payload,
  };
}

export async function listKnowledgeByUser(
  userId: string,
  limitCount: number = 200
): Promise<KnowledgeItem[]> {
  const snapshot = await firestore
    .collection("knowledge")
    .where("createdByUserId", "==", userId)
    .orderBy("createdAt", "desc")
    .limit(limitCount)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      content: data.content,
      isImportant: data.isImportant ?? false,
      createdByUserId: data.createdByUserId,
      sourceChatId: data.sourceChatId ?? null,
      sourceChatTitle: data.sourceChatTitle ?? null,
      sourceMessageId: data.sourceMessageId ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    } as KnowledgeItem;
  });
}
