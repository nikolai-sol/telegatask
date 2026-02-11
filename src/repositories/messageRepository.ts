import { firestore } from "../config/firebase";

export interface ChatMessage {
  id: string;
  telegramChatId: number;
  messageId: number;
  chatTitle?: string | null;
  fromUserId: string;
  fromUsername?: string | null;
  fromDisplayName: string;
  text: string;
  mentionUsernames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpsertChatMessageInput {
  telegramChatId: number;
  messageId: number;
  chatTitle?: string | null;
  fromUserId: string;
  fromUsername?: string | null;
  fromDisplayName: string;
  text: string;
  mentionUsernames?: string[];
  createdAt: string;
}

export async function upsertChatMessage(
  input: UpsertChatMessageInput
): Promise<ChatMessage> {
  const docId = `${input.telegramChatId}_${input.messageId}`;
  const docRef = firestore.collection("messages").doc(docId);
  const now = new Date().toISOString();

  const payload = {
    telegramChatId: input.telegramChatId,
    messageId: input.messageId,
    chatTitle: input.chatTitle ?? null,
    fromUserId: input.fromUserId,
    fromUsername: input.fromUsername ?? null,
    fromDisplayName: input.fromDisplayName,
    text: input.text,
    mentionUsernames: input.mentionUsernames ?? [],
    createdAt: input.createdAt,
    updatedAt: now,
  };

  await docRef.set(payload, { merge: true });

  return {
    id: docRef.id,
    ...payload,
  };
}

export async function listMessagesByChatAndTime(
  telegramChatId: number,
  startIso: string,
  endIso: string,
  limitCount: number = 200
): Promise<ChatMessage[]> {
  const snapshot = await firestore
    .collection("messages")
    .where("telegramChatId", "==", telegramChatId)
    .where("createdAt", ">=", startIso)
    .where("createdAt", "<", endIso)
    .orderBy("createdAt", "asc")
    .limit(limitCount)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      telegramChatId: data.telegramChatId,
      messageId: data.messageId,
      chatTitle: data.chatTitle ?? null,
      fromUserId: data.fromUserId,
      fromUsername: data.fromUsername ?? null,
      fromDisplayName: data.fromDisplayName ?? data.fromUsername ?? "user",
      text: data.text,
      mentionUsernames: data.mentionUsernames ?? [],
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    } as ChatMessage;
  });
}
