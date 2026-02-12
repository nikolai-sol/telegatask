/**
 * Permissions — проверка прав и плана для скилла.
 */

import type { SkillPermissions, PlanTier, UserRole } from "../skills/types";
import type { TelegramUser } from "../models/telegramUser";
import type { Chat } from "../models/chat";
import type { KnowledgeItemV2 } from "../models/knowledge";
import type { SkillContext } from "./context";
import { getTeamByChatId } from "../repositories/teamRepository";

/** Порядок планов (для сравнения) */
const PLAN_ORDER: Record<PlanTier, number> = {
  free: 0,
  pro: 1,
  team: 2,
  enterprise: 3,
};

/** Порядок ролей */
const ROLE_ORDER: Record<UserRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  /** Какой план нужен */
  requiredPlan?: PlanTier;
}

/**
 * Проверить, может ли пользователь использовать скилл.
 */
export function checkPermissions(
  permissions: SkillPermissions,
  _user: TelegramUser,
  chat: Chat | null,
  chatType: string,
  /** Текущий план пользователя/организации */
  currentPlan: PlanTier = "free",
  /** Роль пользователя в текущей команде */
  currentRole: UserRole = "member"
): PermissionCheckResult {
  // 1. Проверка плана
  if (PLAN_ORDER[currentPlan] < PLAN_ORDER[permissions.minPlan]) {
    return {
      allowed: false,
      reason: `Эта функция доступна на плане ${permissions.minPlan}+. Ваш план: ${currentPlan}. /upgrade`,
      requiredPlan: permissions.minPlan,
    };
  }

  // 2. Проверка роли
  if (permissions.minRole) {
    if (ROLE_ORDER[currentRole] < ROLE_ORDER[permissions.minRole]) {
      return {
        allowed: false,
        reason: `Нужна роль: ${permissions.minRole}+. Ваша роль: ${currentRole}.`,
      };
    }
  }

  // 3. Проверка типа чата
  if (permissions.chatType && permissions.chatType !== "any") {
    const isPrivate = chatType === "private";
    const isGroup = chatType === "group" || chatType === "supergroup";

    if (permissions.chatType === "private" && !isPrivate) {
      return {
        allowed: false,
        reason: "Эта команда работает только в личном чате с ботом.",
      };
    }
    if (permissions.chatType === "group" && !isGroup) {
      return {
        allowed: false,
        reason: "Эта команда работает только в групповых чатах.",
      };
    }
  }

  return { allowed: true };
}

// ============================================================
// Knowledge access guard
// ============================================================

export interface KnowledgeAccessResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Проверить доступ к knowledge item.
 * MVP: personal (owner) + teamId + visibility chat.
 */
export async function assertKnowledgeAccess(
  ctx: SkillContext,
  item: KnowledgeItemV2
): Promise<KnowledgeAccessResult> {
  const isOwner = item.createdByUserId === ctx.user.id;
  const visibility = item.visibility ?? "personal";

  // 1. Владелец всегда имеет доступ
  if (isOwner) {
    return { allowed: true };
  }

  // 2. personal — только владелец
  if (visibility === "personal") {
    return { allowed: false, reason: "Нет доступа к этой записи." };
  }

  // 3. chat — только если мы в том же Telegram-чате
  if (visibility === "chat") {
    const itemTgChatId = item.source?.telegramChatId;
    if (itemTgChatId != null && ctx.chatType !== "private") {
      if (Number(itemTgChatId) === ctx.telegramChatId) {
        return { allowed: true };
      }
    }
    return { allowed: false, reason: "Нет доступа к этой записи." };
  }

  // 4. team — проверяем teamId
  if (item.teamId) {
    if (ctx.chatType === "private") {
      return { allowed: false, reason: "Нет доступа к этой записи." };
    }
    const team = await getTeamByChatId(String(ctx.telegramChatId));
    if (team && team.id === item.teamId) {
      return { allowed: true };
    }
    return { allowed: false, reason: "Нет доступа к этой записи." };
  }

  // 5. Без teamId и не owner — нет доступа
  return { allowed: false, reason: "Нет доступа к этой записи." };
}
