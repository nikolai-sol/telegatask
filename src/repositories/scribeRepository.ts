import { firestore } from "../config/firebase";

const collection = firestore.collection("debugScribe");

export async function getScribeEnabledByTelegramUserId(telegramUserId: number): Promise<boolean | null> {
  const id = String(telegramUserId);
  const snap = await collection.doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  return typeof data.enabled === "boolean" ? data.enabled : null;
}

export async function setScribeEnabledByTelegramUserId(input: {
  telegramUserId: number;
  enabled: boolean;
  updatedByTelegramUserId: number;
}): Promise<void> {
  const id = String(input.telegramUserId);
  await collection.doc(id).set(
    {
      enabled: Boolean(input.enabled),
      updatedAt: new Date().toISOString(),
      updatedByTelegramUserId: input.updatedByTelegramUserId,
    },
    { merge: true }
  );
}

