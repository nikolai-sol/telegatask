import { firestore } from "../config/firebase";
import { TelegramUser, UserSettings, DEFAULT_USER_SETTINGS } from "../models/telegramUser";

const collection = firestore.collection("users");

/** Normalize Firestore doc to TelegramUser with defaults for new fields */
function docToUser(id: string, data: FirebaseFirestore.DocumentData): TelegramUser {
  return {
    id,
    telegramId: data.telegramId ?? -1,
    username: data.username ?? null,
    displayName: data.displayName ?? `user-${id}`,
    timezone: data.timezone ?? null,
    activeTeamId: data.activeTeamId ?? null,
    settings: {
      ...DEFAULT_USER_SETTINGS,
      ...(data.settings ?? {}),
    },
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export async function getUserByTelegramId(
  telegramId: number
): Promise<TelegramUser | null> {
  const snapshot = await collection
    .where("telegramId", "==", telegramId)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return docToUser(doc.id, doc.data());
}

export async function getUserById(
  userId: string
): Promise<TelegramUser | null> {
  const docRef = collection.doc(userId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) return null;
  const data = docSnap.data();
  if (!data) return null;
  return docToUser(docSnap.id, data);
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

  if (fullName) return fullName;
  if (payload.username) return payload.username;
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

    const updatedUser = docToUser(doc.id, {
      ...data,
      username: payload.username ?? data.username ?? null,
      displayName,
      updatedAt: now,
    });

    await doc.ref.update({
      username: updatedUser.username,
      displayName: updatedUser.displayName,
      updatedAt: now,
    });

    return updatedUser;
  }

  const newUserData = {
    telegramId: payload.id,
    username: payload.username ?? null,
    displayName,
    timezone: null,
    activeTeamId: null,
    settings: DEFAULT_USER_SETTINGS,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await collection.add(newUserData);
  return { id: docRef.id, ...newUserData };
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
    return docToUser(docSnap.id, {
      ...data,
      username: data.username ?? normalized,
      displayName: data.displayName ?? normalized,
      updatedAt: now,
    });
  }

  const newUserData = {
    telegramId: -1,
    username: normalized,
    displayName: normalized,
    timezone: null,
    settings: DEFAULT_USER_SETTINGS,
    createdAt: now,
    updatedAt: now,
  };

  await docRef.set(newUserData);
  return { id: docId, ...newUserData };
}

export async function getUserByUsername(
  username: string
): Promise<TelegramUser | null> {
  const normalized = username.replace(/^@/, "");
  if (!normalized) return null;

  // Fast path: placeholder users created by upsertUserByUsername
  const docId = `username-${normalized.toLowerCase()}`;
  const docSnap = await collection.doc(docId).get();
  if (docSnap.exists) {
    const data = docSnap.data() || {};
    return docToUser(docSnap.id, data);
  }

  const snapshot = await collection
    .where("username", "==", normalized)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return docToUser(doc.id, doc.data());
}

export async function getUsersByIds(userIds: string[]): Promise<TelegramUser[]> {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return [];

  // Firestore getAll supports batching multiple refs. Keep chunks small.
  const chunkSize = 200;
  const result: TelegramUser[] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const refs = chunk.map((id) => collection.doc(id));
    // @ts-ignore - typings for getAll are present on firestore instance.
    const snaps = await firestore.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data();
      if (!data) continue;
      result.push(docToUser(snap.id, data));
    }
  }
  return result;
}

/** Обновить timezone пользователя */
export async function updateUserTimezone(
  userId: string,
  timezone: string
): Promise<void> {
  await collection.doc(userId).update({
    timezone,
    updatedAt: new Date().toISOString(),
  });
}

/** Обновить настройки пользователя (merge) */
export async function updateUserSettings(
  userId: string,
  settings: Partial<UserSettings>
): Promise<void> {
  const user = await getUserById(userId);
  if (!user) return;

  const merged = { ...user.settings, ...settings };
  await collection.doc(userId).update({
    settings: merged,
    updatedAt: new Date().toISOString(),
  });
}

export async function updateUserActiveTeamId(
  userId: string,
  activeTeamId: string | null
): Promise<void> {
  await collection.doc(userId).update({
    activeTeamId: activeTeamId ?? null,
    updatedAt: new Date().toISOString(),
  });
}

/** Все пользователи (для cron: briefs, digests) */
export async function listAllUsers(limitCount: number = 500): Promise<TelegramUser[]> {
  const snapshot = await collection.limit(limitCount).get();
  return snapshot.docs.map((doc) => docToUser(doc.id, doc.data()));
}
