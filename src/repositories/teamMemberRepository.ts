import { firestore } from "../config/firebase";
import type { CampaignRole } from "../core/permissions/campaignPermissions";
import type { TeamMemberStatus } from "../core/permissions/teamRoleMap";

export type TeamMemberRecord = {
  id: string;
  teamId: string;
  userId: string;
  role: CampaignRole;
  status: TeamMemberStatus;
  displayName?: string;
  invitedByUserId?: string;
  telegramUserId?: number;
  telegramUsername?: string;
  telegramName?: string;
  inviteCode?: string;
  inviteExpiresAt?: number;
  activatedAt?: number;
  createdAt: number;
  updatedAt: number;
};

const collection = firestore.collection("teamMembers");

function docId(teamId: string, userId: string): string {
  return `${teamId}_${userId}`;
}

function dataToRecord(id: string, d: FirebaseFirestore.DocumentData): TeamMemberRecord {
  const roleRaw = String(d.role || "viewer");
  const role: CampaignRole =
    roleRaw === "owner" || roleRaw === "account" || roleRaw === "project" ? (roleRaw as CampaignRole) : "viewer";
  const statusRaw = String(d.status || "active");
  const status: TeamMemberStatus =
    statusRaw === "active" || statusRaw === "invited" ? (statusRaw as TeamMemberStatus) : "disabled";
  const now = Date.now();
  return {
    id,
    teamId: String(d.teamId || ""),
    userId: String(d.userId || ""),
    role,
    status,
    displayName: typeof d.displayName === "string" ? d.displayName : undefined,
    invitedByUserId: typeof d.invitedByUserId === "string" ? d.invitedByUserId : undefined,
    telegramUserId: typeof d.telegramUserId === "number" ? d.telegramUserId : undefined,
    telegramUsername: typeof d.telegramUsername === "string" ? d.telegramUsername : undefined,
    telegramName: typeof d.telegramName === "string" ? d.telegramName : undefined,
    inviteCode: typeof d.inviteCode === "string" ? d.inviteCode : undefined,
    inviteExpiresAt: typeof d.inviteExpiresAt === "number" ? d.inviteExpiresAt : undefined,
    activatedAt: typeof d.activatedAt === "number" ? d.activatedAt : undefined,
    createdAt: typeof d.createdAt === "number" ? d.createdAt : now,
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : now,
  };
}

function docToRecord(doc: FirebaseFirestore.QueryDocumentSnapshot): TeamMemberRecord {
  return dataToRecord(doc.id, doc.data() || {});
}

export async function listTeamMemberRecords(teamId: string, limitCount: number = 1000): Promise<TeamMemberRecord[]> {
  const snap = await collection.where("teamId", "==", teamId).limit(limitCount).get();
  if (snap.empty) return [];
  return snap.docs.map(docToRecord);
}

export async function getTeamMemberRecord(teamId: string, userId: string): Promise<TeamMemberRecord | null> {
  const snap = await collection.doc(docId(teamId, userId)).get();
  if (!snap.exists) return null;
  return dataToRecord(snap.id, snap.data() || {});
}

export async function findTeamMemberByInviteCode(inviteCode: string): Promise<TeamMemberRecord | null> {
  const code = String(inviteCode || "").trim();
  if (!code) return null;
  const snap = await collection.where("inviteCode", "==", code).limit(1).get();
  if (snap.empty) return null;
  return docToRecord(snap.docs[0]);
}

export function getTeamMemberDocRef(teamId: string, userId: string): FirebaseFirestore.DocumentReference {
  return collection.doc(docId(teamId, userId));
}

export async function upsertTeamMemberRecord(input: {
  teamId: string;
  userId: string;
  role: CampaignRole;
  status: TeamMemberStatus;
  displayName?: string;
  invitedByUserId?: string;
  telegramUserId?: number;
  telegramUsername?: string;
  telegramName?: string;
  inviteCode?: string | null;
  inviteExpiresAt?: number | null;
  activatedAt?: number | null;
}): Promise<void> {
  const now = Date.now();
  const payload: Record<string, unknown> = {
    teamId: input.teamId,
    userId: input.userId,
    role: input.role,
    status: input.status,
    displayName: input.displayName ?? null,
    invitedByUserId: input.invitedByUserId ?? null,
    telegramUserId: input.telegramUserId ?? null,
    telegramUsername: input.telegramUsername ?? null,
    telegramName: input.telegramName ?? null,
    createdAt: now,
    updatedAt: now,
  };
  if (Object.prototype.hasOwnProperty.call(input, "inviteCode")) {
    payload.inviteCode = input.inviteCode ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "inviteExpiresAt")) {
    payload.inviteExpiresAt = input.inviteExpiresAt ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "activatedAt")) {
    payload.activatedAt = input.activatedAt ?? null;
  }
  await collection.doc(docId(input.teamId, input.userId)).set(payload, { merge: true });
}
