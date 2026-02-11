import { firestore } from "../config/firebase";

const collection = firestore.collection("settings");

export interface ChatSettings {
  id: string;
  defaultProjectId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function setDefaultProjectForChat(
  chatId: string,
  projectId: string | null
): Promise<void> {
  const ref = collection.doc(chatId);
  await ref.set(
    {
      defaultProjectId: projectId,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

export async function getChatSettings(
  chatId: string
): Promise<ChatSettings | null> {
  const doc = await collection.doc(chatId).get();
  if (!doc.exists) {
    return null;
  }
  const data = doc.data()!;
  return {
    id: doc.id,
    defaultProjectId: data.defaultProjectId ?? null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}
