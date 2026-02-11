import { firestore } from "../config/firebase";
import admin from "firebase-admin";
import { Team } from "../models/team";

const collection = firestore.collection("teams");

export async function getTeamByChatId(chatId: string): Promise<Team | null> {
  const snapshot = await collection
    .where("chatIds", "array-contains", chatId)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  const data = doc.data();
  return {
    id: doc.id,
    name: data.name,
    chatIds: data.chatIds ?? [],
    projectIds: data.projectIds ?? [],
    roles: data.roles ?? {},
    permissions: data.permissions ?? {},
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export async function createTeam(name: string, chatId?: string): Promise<Team> {
  const now = new Date().toISOString();
  const payload = {
    name,
    chatIds: chatId ? [chatId] : [],
    projectIds: [],
    roles: {},
    permissions: {},
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await collection.add(payload);
  return { id: docRef.id, ...payload };
}

export async function linkChatToTeam(
  teamId: string,
  chatId: string
): Promise<void> {
  const ref = collection.doc(teamId);
  await ref.set(
    {
      chatIds: admin.firestore.FieldValue.arrayUnion(chatId),
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

export async function getTeamById(teamId: string): Promise<Team | null> {
  const doc = await collection.doc(teamId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return {
    id: doc.id,
    name: data.name,
    chatIds: data.chatIds ?? [],
    projectIds: data.projectIds ?? [],
    roles: data.roles ?? {},
    permissions: data.permissions ?? {},
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export async function setRole(
  teamId: string,
  userId: string,
  role: "owner" | "admin" | "member" | "read_only"
): Promise<void> {
  const ref = collection.doc(teamId);
  await ref.set(
    {
      roles: {
        [userId]: role,
      },
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

export async function updatePermissions(
  teamId: string,
  userId: string,
  payload: { create?: boolean; assign?: boolean; edit?: boolean }
): Promise<void> {
  const ref = collection.doc(teamId);
  await ref.set(
    {
      permissions: {
        [userId]: payload,
      },
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}
