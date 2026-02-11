import { firestore } from "../config/firebase";
import { TelegramUser } from "../models/telegramUser";

const collection = firestore.collection("users");

export async function getUserByTelegramId(
  telegramId: number
): Promise<TelegramUser | null> {
  const snapshot = await collection
    .where("telegramId", "==", telegramId)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  const data = doc.data();

  return {
    id: doc.id,
    telegramId: data.telegramId,
    username: data.username ?? null,
    displayName: data.displayName,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export async function getUserById(
  userId: string
): Promise<TelegramUser | null> {
  const docRef = collection.doc(userId);
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
    telegramId: data.telegramId ?? -1,
    username: data.username ?? null,
    displayName: data.displayName ?? `user-${docSnap.id}`,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function buildDisplayName(payload: {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}): string {
  const fullName = [payload.first_name, payload.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (fullName) {
    return fullName;
  }

  if (payload.username) {
    return payload.username;
  }

  return `user-${payload.id}`;
}

export async function upsertUserFromTelegramPayload(payload: {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}): Promise<TelegramUser> {
  const now = new Date().toISOString();
  const snapshot = await collection
    .where("telegramId", "==", payload.id)
    .limit(1)
    .get();

  const displayName = buildDisplayName(payload);

  if (!snapshot.empty) {
    const doc = snapshot.docs[0];
    const data = doc.data();

    const updatedUser: TelegramUser = {
      id: doc.id,
      telegramId: data.telegramId,
      username: payload.username ?? data.username ?? null,
      displayName,
      createdAt: data.createdAt,
      updatedAt: now,
    };

    await doc.ref.update({
      username: updatedUser.username,
      displayName: updatedUser.displayName,
      updatedAt: updatedUser.updatedAt,
    });

    return updatedUser;
  }

  const newUserData = {
    telegramId: payload.id,
    username: payload.username ?? null,
    displayName,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await collection.add(newUserData);

  return {
    id: docRef.id,
    ...newUserData,
  };
}

export async function upsertUserByUsername(
  username: string
): Promise<TelegramUser> {
  const now = new Date().toISOString();
  const normalized = username.replace(/^@/, "");
  const docId = `username-${normalized.toLowerCase()}`;
  const docRef = collection.doc(docId);
  const docSnap = await docRef.get();

  if (docSnap.exists) {
    const data = docSnap.data() || {};
    const updatedUser: TelegramUser = {
      id: docSnap.id,
      telegramId: data.telegramId ?? -1,
      username: data.username ?? normalized,
      displayName: data.displayName ?? normalized,
      createdAt: data.createdAt ?? now,
      updatedAt: now,
    };

    await docRef.set(
      {
        username: updatedUser.username,
        displayName: updatedUser.displayName,
        updatedAt: updatedUser.updatedAt,
      },
      { merge: true }
    );

    return updatedUser;
  }

  const newUser: TelegramUser = {
    id: docId,
    telegramId: -1,
    username: normalized,
    displayName: normalized,
    createdAt: now,
    updatedAt: now,
  };

  await docRef.set(newUser);

  return newUser;
}
