import { firestore } from "../config/firebase";
import admin from "firebase-admin";
import { Project } from "../models/project";

const collection = firestore.collection("projects");

export async function listProjectsByTeamId(
  teamId: string
): Promise<Project[]> {
  const snapshot = await collection
    .where("teamId", "==", teamId)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name,
      description: data.description ?? null,
      teamId: data.teamId ?? null,
      chatIds: data.chatIds ?? [],
      allowedMemberIds: data.allowedMemberIds ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  });
}

export async function listProjectsByChatId(
  chatId: string
): Promise<Project[]> {
  const snapshot = await collection
    .where("chatIds", "array-contains", chatId)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name,
      description: data.description ?? null,
      teamId: data.teamId ?? null,
      chatIds: data.chatIds ?? [],
      allowedMemberIds: data.allowedMemberIds ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  });
}

export async function createProject(input: {
  name: string;
  description?: string | null;
  teamId?: string | null;
  chatIds?: string[];
  allowedMemberIds?: string[] | null;
}): Promise<Project> {
  const now = new Date().toISOString();
  const payload = {
    name: input.name,
    description: input.description ?? null,
    teamId: input.teamId ?? null,
    chatIds: input.chatIds ?? [],
    allowedMemberIds: input.allowedMemberIds ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await collection.add(payload);
  return { id: docRef.id, ...payload };
}

export async function updateProjectAllowedMembers(
  projectId: string,
  allowedMemberIds: string[] | null
): Promise<void> {
  const ref = collection.doc(projectId);
  await ref.set(
    {
      allowedMemberIds: allowedMemberIds && allowedMemberIds.length ? allowedMemberIds : null,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

export async function attachChatToProject(
  projectId: string,
  chatId: string
): Promise<void> {
  const ref = collection.doc(projectId);
  await ref.set(
    {
      chatIds: admin.firestore.FieldValue.arrayUnion(chatId),
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

export async function getProjectById(
  projectId: string
): Promise<Project | null> {
  const doc = await collection.doc(projectId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return {
    id: doc.id,
    name: data.name,
    description: data.description ?? null,
    teamId: data.teamId ?? null,
    chatIds: data.chatIds ?? [],
    allowedMemberIds: data.allowedMemberIds ?? null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export async function getProjectsByIds(projectIds: string[]): Promise<Project[]> {
  const unique = Array.from(new Set((projectIds || []).filter(Boolean)));
  if (unique.length === 0) return [];

  // Keep chunks at <= 10 to follow Firestore "in" mental model and avoid large batches.
  // We use getAll on refs, but still chunk for safety.
  const chunkSize = 10;
  const result: Project[] = [];

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const refs = chunk.map((id) => collection.doc(id));
    // @ts-ignore - typings for getAll are present on firestore instance.
    const snaps = await firestore.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data();
      if (!data) continue;
      result.push({
        id: snap.id,
        name: data.name,
        description: data.description ?? null,
        teamId: data.teamId ?? null,
        chatIds: data.chatIds ?? [],
        allowedMemberIds: data.allowedMemberIds ?? null,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    }
  }

  return result;
}
