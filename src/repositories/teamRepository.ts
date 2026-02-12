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
  const team: Team = {
    id: doc.id,
    name: data.name,
    chatIds: data.chatIds ?? [],
    projectIds: data.projectIds ?? [],
    memberIds: data.memberIds ?? [],
    roles: data.roles ?? {},
    permissions: data.permissions ?? {},
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };

  // Lazy backfill: if memberIds missing but roles exist, persist it for queryability.
  if ((!data.memberIds || !Array.isArray(data.memberIds) || data.memberIds.length === 0) && data.roles) {
    const roleIds = Object.keys(data.roles ?? {});
    if (roleIds.length) {
      collection.doc(doc.id).set(
        { memberIds: roleIds, updatedAt: new Date().toISOString() },
        { merge: true }
      ).catch(() => {});
      team.memberIds = roleIds;
    }
  }

  return team;
}

export async function createTeam(name: string, chatId?: string): Promise<Team> {
  const now = new Date().toISOString();
  const payload = {
    name,
    chatIds: chatId ? [chatId] : [],
    projectIds: [],
    memberIds: [],
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
    memberIds: data.memberIds ?? [],
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
      memberIds: admin.firestore.FieldValue.arrayUnion(userId),
      updatedAt: new Date().toISOString(),
      [`roles.${userId}`]: role,
    } as any,
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
      memberIds: admin.firestore.FieldValue.arrayUnion(userId),
      updatedAt: new Date().toISOString(),
      [`permissions.${userId}`]: payload,
    } as any,
    { merge: true }
  );
}

export async function removeMember(
  teamId: string,
  userId: string
): Promise<void> {
  const ref = collection.doc(teamId);
  await ref.set(
    {
      memberIds: admin.firestore.FieldValue.arrayRemove(userId),
      updatedAt: new Date().toISOString(),
      [`roles.${userId}`]: admin.firestore.FieldValue.delete(),
      [`permissions.${userId}`]: admin.firestore.FieldValue.delete(),
    } as any,
    { merge: true }
  );
}

export async function listTeamsByMemberId(userId: string, limitCount: number = 50): Promise<Team[]> {
  const snapshot = await collection
    .where("memberIds", "array-contains", userId)
    .limit(limitCount)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name,
      chatIds: data.chatIds ?? [],
      projectIds: data.projectIds ?? [],
      memberIds: data.memberIds ?? [],
      roles: data.roles ?? {},
      permissions: data.permissions ?? {},
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  });
}
