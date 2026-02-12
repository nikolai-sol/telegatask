import { firestore } from "../config/firebase";
import { Chat, ChatCaptureMode } from "../models/chat";

const collection = firestore.collection("chats");

/** Normalize Firestore doc to Chat with defaults for new fields */
function docToChat(id: string, data: FirebaseFirestore.DocumentData): Chat {
  return {
    id,
    telegramChatId: data.telegramChatId,
    title: data.title ?? "",
    type: data.type,
    defaultProjectId: data.defaultProjectId ?? null,
    captureMode: data.captureMode ?? "off",
    scanIntervalMin: data.scanIntervalMin ?? 30,
    lastScannedAt: data.lastScannedAt ?? null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

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

    const updatedChat = docToChat(doc.id, {
      ...data,
      title: nextTitle || data.title || "",
      type: payload.type,
      updatedAt: now,
    });

    await doc.ref.update({
      title: updatedChat.title,
      type: updatedChat.type,
      updatedAt: now,
    });

    return updatedChat;
  }

  const newChatData = {
    telegramChatId: payload.id,
    title: nextTitle,
    type: payload.type,
    defaultProjectId: null,
    captureMode: "off",
    scanIntervalMin: 30,
    lastScannedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await collection.add(newChatData);
  return { id: docRef.id, ...newChatData } as Chat;
}

export async function getChatById(chatId: string): Promise<Chat | null> {
  const docRef = collection.doc(chatId);
  const docSnap = await docRef.get();

  if (!docSnap.exists) return null;
  const data = docSnap.data();
  if (!data) return null;

  return docToChat(docSnap.id, data);
}

export async function getChatByTelegramId(
  telegramChatId: number
): Promise<Chat | null> {
  const snapshot = await collection
    .where("telegramChatId", "==", telegramChatId)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return docToChat(doc.id, doc.data());
}

export async function listChats(limitCount: number = 20): Promise<Chat[]> {
  const snapshot = await collection
    .orderBy("updatedAt", "desc")
    .limit(limitCount)
    .get();

  return snapshot.docs.map((doc) => docToChat(doc.id, doc.data()));
}

/** Чаты с captureMode = "auto_scan" — для cron scanner */
export async function listChatsForScan(): Promise<Chat[]> {
  const snapshot = await collection
    .where("captureMode", "==", "auto_scan")
    .get();
  return snapshot.docs.map((doc) => docToChat(doc.id, doc.data()));
}

/** Обновить captureMode чата */
export async function setChatCaptureMode(
  chatId: string,
  mode: ChatCaptureMode
): Promise<void> {
  await collection.doc(chatId).update({
    captureMode: mode,
    updatedAt: new Date().toISOString(),
  });
}

/** Обновить lastScannedAt после скана */
export async function updateChatLastScanned(chatId: string): Promise<void> {
  await collection.doc(chatId).update({
    lastScannedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}
