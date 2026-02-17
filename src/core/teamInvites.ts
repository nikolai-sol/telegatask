import admin from "firebase-admin";
import crypto from "crypto";
import { firestore } from "../config/firebase";
import { mapCampaignRoleToStoredRole } from "./permissions/teamRoleMap";
import type { CampaignRole } from "./permissions/campaignPermissions";
import { findTeamMemberByInviteCode, getTeamMemberDocRef } from "../repositories/teamMemberRepository";
import { updateUserActiveTeamId } from "../repositories/userRepository";

export type InviteActivationStatus = "success" | "idempotent" | "invalid" | "expired" | "already_activated";

export type ActivateInviteResult = {
  status: InviteActivationStatus;
  teamId?: string;
  teamName?: string;
  userId?: string;
};

const INVITE_CODE_RE = /^[A-Za-z0-9]{4,64}$/;

export function generateInviteCode(length: number = 8): string {
  const targetLength = Math.max(4, Math.min(32, Math.floor(length || 8)));
  let out = "";
  while (out.length < targetLength) {
    out += crypto
      .randomBytes(targetLength)
      .toString("base64url")
      .replace(/[^A-Za-z0-9]/g, "");
  }
  return out.slice(0, targetLength);
}

export function buildInviteDeepLink(botUsername: string, inviteCode: string): string {
  const username = String(botUsername || "").trim().replace(/^@/, "");
  const code = String(inviteCode || "").trim();
  if (!username || !code) return "";
  return `https://t.me/${username}?start=invite_${code}`;
}

export function defaultInviteExpiresAt(nowMs: number = Date.now(), ttlDays: number = 7): number {
  const days = Math.max(1, Math.min(30, Math.floor(ttlDays || 7)));
  return nowMs + days * 24 * 60 * 60 * 1000;
}

export function extractInviteCodeFromStartPayload(payload: string | null | undefined): string | null {
  const text = String(payload || "").trim();
  const m = text.match(/^invite_([A-Za-z0-9]{4,64})$/);
  if (!m) return null;
  return m[1];
}

export function isInviteExpired(inviteExpiresAt: number | null | undefined, nowMs: number = Date.now()): boolean {
  if (typeof inviteExpiresAt !== "number") return false;
  return inviteExpiresAt > 0 && inviteExpiresAt < nowMs;
}

export function evaluateInviteActivation(input: {
  code: string;
  inviteCode?: string | null;
  status?: string | null;
  activatedAt?: number | null;
  inviteExpiresAt?: number | null;
  nowMs?: number;
  userAlreadyMember?: boolean;
}): InviteActivationStatus {
  const code = String(input.code || "").trim();
  const inviteCode = String(input.inviteCode || "").trim();
  if (!INVITE_CODE_RE.test(code)) return "invalid";
  if (!inviteCode || inviteCode !== code) return "invalid";

  const status = String(input.status || "invited").toLowerCase();
  if (status === "active" || typeof input.activatedAt === "number") return "already_activated";
  if (status !== "invited") return "invalid";
  if (isInviteExpired(input.inviteExpiresAt ?? null, input.nowMs ?? Date.now())) return "expired";
  return input.userAlreadyMember ? "idempotent" : "success";
}

function mapAnyRoleToCampaignRole(value: unknown): CampaignRole {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "owner" || raw === "account" || raw === "project") return raw as CampaignRole;
  return "viewer";
}

function roleRankStored(role: string | null | undefined): number {
  if (role === "owner") return 4;
  if (role === "admin") return 3;
  if (role === "member") return 2;
  if (role === "read_only") return 1;
  return 0;
}

function formatTelegramName(input: {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fallback?: string | null;
}): string {
  const fullName = [input.firstName, input.lastName].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  if (input.username) return input.username;
  return String(input.fallback || "user");
}

export async function activateInvite(params: {
  code: string;
  userId: string;
  telegramUserId: number;
  telegramUsername?: string | null;
  telegramFirstName?: string | null;
  telegramLastName?: string | null;
}): Promise<ActivateInviteResult> {
  const code = String(params.code || "").trim();
  if (!INVITE_CODE_RE.test(code)) return { status: "invalid" };

  const found = await findTeamMemberByInviteCode(code);
  if (!found) return { status: "invalid" };

  const nowMs = Date.now();
  const invitedRef = getTeamMemberDocRef(found.teamId, found.userId);

  const txResult = await firestore.runTransaction(async (tx) => {
    const invitedSnap = await tx.get(invitedRef);
    if (!invitedSnap.exists) {
      return { status: "invalid" as InviteActivationStatus };
    }

    const data = invitedSnap.data() || {};
    const preDecision = evaluateInviteActivation({
      code,
      inviteCode: typeof data.inviteCode === "string" ? data.inviteCode : null,
      status: typeof data.status === "string" ? data.status : null,
      activatedAt: typeof data.activatedAt === "number" ? data.activatedAt : null,
      inviteExpiresAt: typeof data.inviteExpiresAt === "number" ? data.inviteExpiresAt : null,
      nowMs,
      userAlreadyMember: false,
    });
    if (preDecision !== "success") {
      return { status: preDecision };
    }

    const teamId = String(data.teamId || "");
    const invitedUserId = String(data.userId || "");
    if (!teamId || !invitedUserId) {
      return { status: "invalid" as InviteActivationStatus };
    }

    const teamRef = firestore.collection("teams").doc(teamId);
    const teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists) {
      return { status: "invalid" as InviteActivationStatus };
    }
    const teamData = teamSnap.data() || {};
    const teamName = String(teamData.name || "team");
    const memberIds = Array.isArray(teamData.memberIds) ? (teamData.memberIds as string[]).filter(Boolean) : [];
    const roles = { ...((teamData.roles || {}) as Record<string, string>) };
    const permissions = { ...((teamData.permissions || {}) as Record<string, unknown>) };
    const isAlreadyMember = memberIds.includes(params.userId);
    const decision = evaluateInviteActivation({
      code,
      inviteCode: typeof data.inviteCode === "string" ? data.inviteCode : null,
      status: typeof data.status === "string" ? data.status : null,
      activatedAt: typeof data.activatedAt === "number" ? data.activatedAt : null,
      inviteExpiresAt: typeof data.inviteExpiresAt === "number" ? data.inviteExpiresAt : null,
      nowMs,
      userAlreadyMember: isAlreadyMember,
    });
    if (decision !== "success" && decision !== "idempotent") {
      return { status: decision };
    }

    const inviteRole = mapAnyRoleToCampaignRole(data.role);
    const invitedStoredRole = mapCampaignRoleToStoredRole(inviteRole);
    const existingStoredRole = typeof roles[params.userId] === "string" ? roles[params.userId] : null;
    const nextStoredRole =
      roleRankStored(existingStoredRole) >= roleRankStored(invitedStoredRole) ? existingStoredRole! : invitedStoredRole;

    const nextMemberSet = new Set(memberIds);
    nextMemberSet.add(params.userId);
    if (invitedUserId !== params.userId) {
      nextMemberSet.delete(invitedUserId);
      delete roles[invitedUserId];
      delete permissions[invitedUserId];
    }
    roles[params.userId] = nextStoredRole;

    tx.update(teamRef, {
      memberIds: Array.from(nextMemberSet),
      roles,
      permissions,
      updatedAt: new Date(nowMs).toISOString(),
    });

    const telegramName = formatTelegramName({
      username: params.telegramUsername,
      firstName: params.telegramFirstName,
      lastName: params.telegramLastName,
      fallback: typeof data.displayName === "string" ? data.displayName : undefined,
    });

    if (invitedUserId === params.userId) {
      tx.update(invitedRef, {
        status: "active",
        role: inviteRole,
        telegramUserId: params.telegramUserId,
        telegramUsername: params.telegramUsername ?? null,
        telegramName,
        activatedAt: nowMs,
        inviteCode: admin.firestore.FieldValue.delete(),
        inviteExpiresAt: admin.firestore.FieldValue.delete(),
        updatedAt: nowMs,
      });
    } else {
      const activeRef = getTeamMemberDocRef(teamId, params.userId);
      const activeSnap = await tx.get(activeRef);
      const activeData = activeSnap.exists ? activeSnap.data() || {} : {};
      tx.set(
        activeRef,
        {
          teamId,
          userId: params.userId,
          role: mapAnyRoleToCampaignRole(activeData.role || inviteRole),
          status: "active",
          displayName:
            (typeof activeData.displayName === "string" && activeData.displayName) ||
            (typeof data.displayName === "string" ? data.displayName : telegramName),
          invitedByUserId:
            (typeof activeData.invitedByUserId === "string" && activeData.invitedByUserId) ||
            (typeof data.invitedByUserId === "string" ? data.invitedByUserId : null),
          telegramUserId: params.telegramUserId,
          telegramUsername: params.telegramUsername ?? null,
          telegramName,
          createdAt:
            (typeof activeData.createdAt === "number" && activeData.createdAt) ||
            (typeof data.createdAt === "number" ? data.createdAt : nowMs),
          updatedAt: nowMs,
          activatedAt: nowMs,
          inviteCode: admin.firestore.FieldValue.delete(),
          inviteExpiresAt: admin.firestore.FieldValue.delete(),
        },
        { merge: true }
      );
      tx.delete(invitedRef);
    }

    return {
      status: decision,
      teamId,
      teamName,
      userId: params.userId,
    };
  });

  if (txResult.status === "success" || txResult.status === "idempotent") {
    updateUserActiveTeamId(params.userId, txResult.teamId || null).catch(() => {});
  }

  return txResult;
}
