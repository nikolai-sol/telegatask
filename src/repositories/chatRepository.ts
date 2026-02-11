import { firestore } from "../config/firebase";
import { Chat } from "../models/chat";

const collection = firestore.collection("chats");

export async function upsertChatFromTelegramPayload(payload: {
  id: number;
  title?: string;
  type: "group" | "supergroup" | "channel" | "private";
}): Promise<Chat> {
  const now = new Date().toISOString();
  const snapshot = await collection
    .where("telegramChatId", "==", payload.id)
    .limit(1)
    .get();

  const nextTitle = payload.title ?? "";

  if (!snapshot.empty) {
    const doc = snapshot.docs[0];
    const data = doc.data();

    const updatedChat: Chat = {
      id: doc.id,
      telegramChatId: data.telegramChatId,
      title: nextTitle || data.title || "",
      type: payload.type,
      defaultProjectId: data.defaultProjectId ?? null,
      createdAt: data.createdAt,
      updatedAt: now,
    };

    await doc.ref.update({
      title: updatedChat.title,
      type: updatedChat.type,
      defaultProjectId: updatedChat.defaultProjectId ?? null,
      updatedAt: updatedChat.updatedAt,
    });

    return updatedChat;
  }

  const newChatData = {
    telegramChatId: payload.id,
    title: nextTitle,
    type: payload.type,
    defaultProjectId: null,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await collection.add(newChatData);

  return {
    id: docRef.id,
    ...newChatData,
  };
}

export async function getChatById(chatId: string): Promise<Chat | null> {
  const docRef = collection.doc(chatId);
  const docSnap = await docRef.get();

  if (!docSnap.exists) {
    return null;
  }

  const data = docSnap.data();
  if (!data) {
    return null;
  }

  return {
    id: docSnap.id,
    telegramChatId: data.telegramChatId,
    title: data.title ?? "",
    type: data.type,
    defaultProjectId: data.defaultProjectId ?? null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  } as Chat;
}

export async function listChats(limitCount: number = 20): Promise<Chat[]> {
  const snapshot = await collection
    .orderBy("updatedAt", "desc")
    .limit(limitCount)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      telegramChatId: data.telegramChatId,
      title: data.title ?? "",
      type: data.type,
      defaultProjectId: data.defaultProjectId ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    } as Chat;
  });
}
