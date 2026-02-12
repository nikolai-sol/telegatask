/**
 * Team Admin Skill — /team_manage
 * Wizard UI to manage team members and per-project access.
 */

import { Markup } from "telegraf";
import type { Skill, SkillResult } from "../types";
import type { SkillContext } from "../../core/context";
import {
  getTeamByChatId,
  getTeamById,
  listTeamsByMemberId,
  setRole,
  removeMember,
  updatePermissions,
} from "../../repositories/teamRepository";
import { getUsersByIds, upsertUserByUsername, upsertUserFromTelegramPayload } from "../../repositories/userRepository";
import { listProjectsByTeamId, updateProjectAllowedMembers } from "../../repositories/projectRepository";
import { logAction } from "../../repositories/actionLogRepository";

type Screen =
  | "home"
  | "members"
  | "member"
  | "projects"
  | "project_access"
  | "pick_team";

type Session = {
  ownerTelegramId: number;
  ownerUserId: string;
  ownerUsername?: string | null;
  teamId: string | null;
  screen: Screen;
  memberId?: string | null;
  projectId?: string | null;
  pickIds?: string[]; // selected memberIds during project picker
  awaiting?: "add_member" | null;
  createdAtMs: number;
};

const sessions = new Map<string, Session>(); // key = chatId:messageId
const TTL_MS = 1000 * 60 * 20;

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isSuperAdminFromEnv(username?: string | null): boolean {
  const raw = process.env.SUPERADMINS || "";
  if (!raw) return false;
  const set = new Set(
    raw
      .split(",")
      .map((s) => s.trim().replace(/^@/, "").toLowerCase())
      .filter(Boolean)
  );
  if (!username) return false;
  return set.has(username.replace(/^@/, "").toLowerCase());
}

function keyFor(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`;
}

function cleanup(): void {
  const now = Date.now();
  for (const [k, s] of sessions) {
    if (now - s.createdAtMs > TTL_MS) sessions.delete(k);
  }
}

async function assertTeamAccess(ctx: SkillContext, teamId: string): Promise<{ ok: boolean; reason?: string }> {
  const team = await getTeamById(teamId);
  if (!team) return { ok: false, reason: "Команда не найдена" };
  const role = team.roles?.[ctx.user.id];
  const isAdmin = role === "owner" || role === "admin";
  if (isAdmin) return { ok: true };
  if (isSuperAdminFromEnv(ctx.user.username ?? null)) return { ok: true };
  return { ok: false, reason: "Недостаточно прав (нужен owner/admin)" };
}

function roleLabel(role: string | null | undefined): string {
  switch (role) {
    case "owner":
      return "owner";
    case "admin":
      return "admin";
    case "read_only":
      return "read_only";
    case "member":
    default:
      return "member";
  }
}

function kbHome(teamId: string | null) {
  if (!teamId) {
    return Markup.inlineKeyboard([
      [Markup.button.callback("Выбрать команду", "teamui:pick_team")],
      [Markup.button.callback("Закрыть", "teamui:close")],
    ]);
  }
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("👥 Участники", "teamui:members"),
      Markup.button.callback("📁 Проекты", "teamui:projects"),
    ],
    [
      Markup.button.callback("🔄 Обновить", "teamui:refresh"),
      Markup.button.callback("Закрыть", "teamui:close"),
    ],
  ]);
}

function kbMembers(isSuperAdmin: boolean, canEdit: boolean) {
  const row: any[] = [];
  if (canEdit || isSuperAdmin) row.push(Markup.button.callback("➕ Добавить", "teamui:add_member"));
  row.push(Markup.button.callback("⬅ Назад", "teamui:home"));
  return Markup.inlineKeyboard([row]);
}

function kbMemberDetail(opts: {
  isOwnerOrSuper: boolean;
  canEdit: boolean;
  role: string;
  perms: { create?: boolean; assign?: boolean; edit?: boolean };
  targetIsSelf: boolean;
}) {
  const { isOwnerOrSuper, canEdit, role, perms, targetIsSelf } = opts;
  const rows: any[][] = [];

  if (canEdit) {
    rows.push([
      Markup.button.callback(role === "member" ? "✓ member" : "member", "teamui:role:member"),
      Markup.button.callback(role === "read_only" ? "✓ read_only" : "read_only", "teamui:role:read_only"),
    ]);
    rows.push([
      Markup.button.callback(role === "admin" ? "✓ admin" : "admin", "teamui:role:admin"),
      Markup.button.callback(
        role === "owner" ? "✓ owner" : "owner",
        "teamui:role:owner"
      ),
    ]);
  }

  rows.push([
    Markup.button.callback(`${perms.create ? "✓" : " " } create`, `teamui:perm:create:${perms.create ? "off" : "on"}`),
    Markup.button.callback(`${perms.assign ? "✓" : " " } assign`, `teamui:perm:assign:${perms.assign ? "off" : "on"}`),
  ]);
  rows.push([
    Markup.button.callback(`${perms.edit ? "✓" : " " } edit`, `teamui:perm:edit:${perms.edit ? "off" : "on"}`),
    Markup.button.callback("🔄 Обновить", "teamui:refresh"),
  ]);

  if (isOwnerOrSuper && !targetIsSelf) {
    rows.push([Markup.button.callback("🗑 Удалить из команды", "teamui:rm_current")]);
  }

  rows.push([Markup.button.callback("⬅ Назад", "teamui:members")]);

  return Markup.inlineKeyboard(rows);
}

function kbProjects() {
  return Markup.inlineKeyboard([[Markup.button.callback("⬅ Назад", "teamui:home")]]);
}

function kbPickTeam(teams: { id: string; name: string }[]) {
  const rows = teams.slice(0, 10).map((t) => [
    Markup.button.callback(t.name.slice(0, 28), `teamui:set_team:${t.id}`),
  ]);
  rows.push([Markup.button.callback("⬅ Назад", "teamui:home")]);
  return Markup.inlineKeyboard(rows);
}

function kbProjectAccess() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Доступ: Все", "teamui:proj_access_all"),
      Markup.button.callback("Указать", "teamui:proj_access_pick"),
    ],
    [Markup.button.callback("⬅ Назад", "teamui:projects")],
  ]);
}

function kbPickMembers(memberButtons: { id: string; label: string; selected: boolean }[]) {
  const rows: any[][] = [];
  for (const m of memberButtons.slice(0, 12)) {
    rows.push([
      Markup.button.callback(
        `${m.selected ? "✓ " : ""}${m.label}`.slice(0, 40),
        `teamui:pick_toggle:${m.id}`
      ),
    ]);
  }
  rows.push([
    Markup.button.callback("💾 Сохранить", "teamui:pick_save"),
    Markup.button.callback("Отмена", "teamui:proj_access_cancel"),
  ]);
  return Markup.inlineKeyboard(rows);
}

async function render(ctx: SkillContext, session: Session): Promise<{ text: string; markup: any }> {
  if (session.screen === "pick_team") {
    const teams = await listTeamsByMemberId(session.ownerUserId, 50);
    const text =
      `<b>Команды</b>\n` +
      `Выберите команду для управления:` +
      (teams.length ? "" : `\n\nНет команд. Привяжите чат: /link_team`);
    return { text, markup: kbPickTeam(teams.map((t) => ({ id: t.id, name: t.name }))) };
  }

  const team = session.teamId ? await getTeamById(session.teamId) : null;

  if (session.screen === "home") {
    const text =
      `<b>Team Admin</b>\n` +
      (team ? `Команда: ${escapeHtml(team.name)} (id=${team.id})` : `Команда не выбрана`) +
      (team ? `\nУчастников: ${(team.memberIds ?? []).length}\nПроектов: ${(team.projectIds ?? []).length}` : "");
    return { text, markup: kbHome(session.teamId) };
  }

  if (!team) {
    return { text: "Команда не выбрана.", markup: kbHome(null) };
  }

  const isSuper = isSuperAdminFromEnv(session.ownerUsername ?? null);
  const role = team.roles?.[session.ownerUserId];
  const canEdit = role === "owner" || role === "admin" || isSuper;
  const isOwnerOrSuper = role === "owner" || isSuper;

  if (session.screen === "members") {
    const memberIds = team.memberIds ?? [];
    const users = memberIds.length ? await getUsersByIds(memberIds) : [];
    const lines = users.map((u) => {
      const r = team.roles?.[u.id] || "member";
      const handle = u.username ? `@${u.username}` : u.id.slice(0, 8);
      return `• ${escapeHtml(handle)} — ${escapeHtml(r)}`;
    });
    const text =
      `<b>Участники</b>\n` +
      `Команда: ${escapeHtml(team.name)}\n\n` +
      (lines.length ? lines.join("\n") : "Пока никого нет.");

    const baseKb = kbMembers(isSuper, canEdit);
    const openRows = users.slice(0, 10).map((u) => [
      Markup.button.callback(
        `${u.username ? `@${u.username}` : u.displayName}`.slice(0, 36),
        `teamui:mem:${u.id}`
      ),
    ]);
    const markup = Markup.inlineKeyboard([...openRows, ...(baseKb.reply_markup?.inline_keyboard ?? [])]);

    return { text, markup };
  }

  if (session.screen === "member") {
    const memberId = session.memberId;
    if (!memberId) return { text: "Участник не выбран.", markup: kbMembers(isSuper, canEdit) };

    const users = await getUsersByIds([memberId]);
    const u = users[0];
    const display = u
      ? (u.username ? `@${u.username}` : escapeHtml(u.displayName))
      : escapeHtml(memberId.slice(0, 8));
    const memberRole = roleLabel(team.roles?.[memberId]);
    const perms = (team.permissions?.[memberId] ?? {}) as any;

    const text =
      `<b>Участник</b>\n` +
      `Команда: ${escapeHtml(team.name)}\n` +
      `Пользователь: ${display}\n\n` +
      `Роль: <b>${escapeHtml(memberRole)}</b>\n` +
      `Права: create=${perms.create ? "on" : "off"}, assign=${perms.assign ? "on" : "off"}, edit=${perms.edit ? "on" : "off"}`;

    const markup = kbMemberDetail({
      isOwnerOrSuper,
      canEdit,
      role: memberRole,
      perms,
      targetIsSelf: memberId === session.ownerUserId,
    });

    return { text, markup };
  }

  if (session.screen === "projects") {
    const projects = await listProjectsByTeamId(team.id);
    const lines = projects.map((p, idx) => {
      const allowed = p.allowedMemberIds;
      const mode = !allowed || allowed.length === 0 ? "все" : `огр. (${allowed.length})`;
      return `${idx + 1}. ${escapeHtml(p.name)} — доступ: ${mode}`;
    });

    const buttons = projects.slice(0, 10).map((p) => [
      Markup.button.callback(p.name.slice(0, 28), `teamui:proj:${p.id}`),
    ]);
    buttons.push([Markup.button.callback("⬅ Назад", "teamui:home")]);

    const text =
      `<b>Проекты</b>\n` +
      `Команда: ${escapeHtml(team.name)}\n\n` +
      (lines.length ? lines.join("\n") : "Проектов пока нет.");
    return { text, markup: Markup.inlineKeyboard(buttons) };
  }

  if (session.screen === "project_access") {
    const projects = await listProjectsByTeamId(team.id);
    const project = projects.find((p) => p.id === session.projectId) || null;
    if (!project) {
      return { text: "Проект не найден.", markup: kbProjects() };
    }

    const allowed = project.allowedMemberIds;
    const mode = !allowed || allowed.length === 0 ? "все" : `только выбранные (${allowed.length})`;

    const text =
      `<b>Доступ к проекту</b>\n` +
      `Проект: ${escapeHtml(project.name)}\n` +
      `Режим: ${mode}\n\n` +
      `Кнопки:\n` +
      `- Доступ: Все\n` +
      `- Указать: выбрать членов команды`;
    return { text, markup: kbProjectAccess() };
  }

  return { text: "Неизвестный экран.", markup: kbHome(team.id) };
}

async function editOrReply(ctx: SkillContext, session: Session, edit: boolean): Promise<void> {
  const { text, markup } = await render(ctx, session);
  const opts: any = { parse_mode: "HTML", ...markup };
  if (edit) {
    await ctx.raw.editMessageText(text, opts).catch(async () => {
      const sent = await ctx.raw.reply(text, opts);
      sessions.set(keyFor(sent.chat.id, sent.message_id), { ...session, createdAtMs: Date.now() });
    });
  } else {
    const sent = await ctx.raw.reply(text, opts);
    sessions.set(keyFor(sent.chat.id, sent.message_id), session);
  }
}

export const teamAdminSkill: Skill = {
  meta: {
    id: "team-admin",
    name: "Team Admin",
    description: "Управление командой и доступом к проектам",
    version: "1.0.0",
    triggers: [
      { type: "command", command: "team_manage", aliases: ["teamadmin", "team_admin"] },
      { type: "callback", prefix: "teamui:" },
      { type: "text", pattern: /^@?[a-zA-Z0-9_]{3,32}$/, priority: 10 },
    ],
    permissions: { minPlan: "free", chatType: "any" },
    menuEntry: { command: "team_manage", description: "Управление командой" },
    keyboardButton: "/team_manage",
  },

  async execute(ctx: SkillContext): Promise<SkillResult> {
    cleanup();

    // Text input for "add member" step
    if (ctx.triggerType === "text") {
      const text = (ctx.text || "").trim();
      if (!text) return { handled: false };
      if (!ctx.raw.chat || !("id" in ctx.raw.chat)) return { handled: false };

      // Find any session in this chat owned by user awaiting input (best effort)
      const session = Array.from(sessions.values()).find(
        (s) => s.ownerTelegramId === ctx.telegramUserId && s.awaiting === "add_member" && s.teamId
      );
      if (!session) return { handled: false };

      const username = text.replace(/^@/, "");
      const access = await assertTeamAccess(ctx, session.teamId!);
      if (!access.ok) {
        await ctx.raw.reply(access.reason || "Нет доступа");
        return { handled: true };
      }

      const member = await upsertUserByUsername(username);
      await setRole(session.teamId!, member.id, "member");
      logAction({
        action: "role_set",
        userId: ctx.user.id,
        targetId: member.id,
        targetType: "user",
        payload: { teamId: session.teamId, role: "member", source: "team_manage" },
      }).catch(() => {});

      session.awaiting = null;
      session.screen = "members";
      await ctx.raw.reply(`Добавил @${username} в команду (роль: member).`);
      return { handled: true };
    }

    // Command
    if (ctx.triggerType === "command") {
      // Resolve team from chat if in group; otherwise allow pick.
      const chat = ctx.chat;
      let teamId: string | null = null;
      if (chat && (chat.type === "group" || chat.type === "supergroup")) {
        const team = await getTeamByChatId(String(chat.telegramChatId));
        teamId = team?.id ?? null;
      }

      const actor = await upsertUserFromTelegramPayload({
        id: ctx.telegramUserId,
        username: ctx.user.username ?? undefined,
      });

      const session: Session = {
        ownerTelegramId: ctx.telegramUserId,
        ownerUserId: actor.id,
        ownerUsername: ctx.user.username ?? null,
        teamId,
        screen: teamId ? "home" : "pick_team",
        awaiting: null,
        createdAtMs: Date.now(),
      };

      if (teamId) {
        const access = await assertTeamAccess(ctx, teamId);
        if (!access.ok) {
          await ctx.raw.reply(access.reason || "Нет доступа");
          return { handled: true };
        }
      }

      await editOrReply(ctx, session, false);
      return { handled: true };
    }

    // Callback
    if (ctx.triggerType === "callback" && ctx.callbackData) {
      const data = ctx.callbackData;
      const msg = ctx.raw.callbackQuery?.message as any;
      if (!msg) return { handled: true, callbackAnswer: "Нет контекста" };

      const k = keyFor(msg.chat.id, msg.message_id);
      const session = sessions.get(k);
      if (!session) return { handled: true, callbackAnswer: "Сессия устарела" };
      if (session.ownerTelegramId !== ctx.telegramUserId) return { handled: true, callbackAnswer: "Это не ваше" };

      if (data === "teamui:close") {
        sessions.delete(k);
        await ctx.raw.answerCbQuery().catch(() => {});
        await ctx.raw.editMessageText("Закрыто.").catch(() => {});
        return { handled: true };
      }

      if (data === "teamui:home") {
        session.screen = "home";
        session.awaiting = null;
        session.memberId = null;
        await ctx.raw.answerCbQuery().catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true };
      }

      if (data === "teamui:pick_team") {
        session.screen = "pick_team";
        await ctx.raw.answerCbQuery().catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true };
      }

      if (data.startsWith("teamui:set_team:")) {
        const teamId = data.slice("teamui:set_team:".length);
        const access = await assertTeamAccess(ctx, teamId);
        if (!access.ok) {
          await ctx.raw.answerCbQuery(access.reason || "Нет доступа").catch(() => {});
          return { handled: true };
        }
        session.teamId = teamId;
        session.screen = "home";
        await ctx.raw.answerCbQuery("Ок").catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true };
      }

      if (data === "teamui:refresh") {
        await ctx.raw.answerCbQuery("Обновлено").catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true };
      }

      // Guard: need team selected for most actions
      if (!session.teamId) {
        await ctx.raw.answerCbQuery("Сначала выберите команду").catch(() => {});
        return { handled: true };
      }

      const access = await assertTeamAccess(ctx, session.teamId);
      if (!access.ok) {
        await ctx.raw.answerCbQuery(access.reason || "Нет доступа").catch(() => {});
        return { handled: true };
      }

      if (data === "teamui:members") {
        session.screen = "members";
        session.awaiting = null;
        session.memberId = null;
        await ctx.raw.answerCbQuery().catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true };
      }

      if (data.startsWith("teamui:mem:")) {
        const memberId = data.slice("teamui:mem:".length);
        session.screen = "member";
        session.memberId = memberId;
        session.awaiting = null;
        await ctx.raw.answerCbQuery().catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true };
      }

      if (data === "teamui:add_member") {
        session.awaiting = "add_member";
        await ctx.raw.answerCbQuery().catch(() => {});
        await ctx.raw.reply("Отправьте username участника (например: `@username`).", { parse_mode: "Markdown" }).catch(() => {});
        return { handled: true };
      }

      if (data === "teamui:rm_current") {
        const userId = session.memberId;
        if (!userId) {
          await ctx.raw.answerCbQuery("Не выбран").catch(() => {});
          return { handled: true };
        }
        const t = await getTeamById(session.teamId);
        const actorRole = t?.roles?.[session.ownerUserId];
        const isSuper = isSuperAdminFromEnv(session.ownerUsername ?? null);
        if (userId === session.ownerUserId) {
          await ctx.raw.answerCbQuery("Нельзя удалить себя").catch(() => {});
          return { handled: true };
        }
        if (actorRole !== "owner" && !isSuper) {
          await ctx.raw.answerCbQuery("Нужен owner").catch(() => {});
          return { handled: true };
        }
        await removeMember(session.teamId, userId);
        logAction({
          action: "permission_updated",
          userId: ctx.user.id,
          targetId: userId,
          targetType: "user",
          payload: { teamId: session.teamId, kind: "remove_member", source: "team_manage" },
        }).catch(() => {});
        session.screen = "members";
        session.memberId = null;
        await ctx.raw.answerCbQuery("Удалено").catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true };
      }

      if (data.startsWith("teamui:role:")) {
        const nextRole = data.slice("teamui:role:".length) as any;
        const memberId = session.memberId;
        if (!memberId) {
          await ctx.raw.answerCbQuery("Не выбран").catch(() => {});
          return { handled: true };
        }
        const t = await getTeamById(session.teamId);
        const actorRole = t?.roles?.[session.ownerUserId];
        const isSuper = isSuperAdminFromEnv(session.ownerUsername ?? null);
        if (nextRole === "owner" && actorRole !== "owner" && !isSuper) {
          await ctx.raw.answerCbQuery("Назначить owner может только owner/суперадмин").catch(() => {});
          return { handled: true };
        }
        await setRole(session.teamId, memberId, nextRole);
        logAction({
          action: "role_set",
          userId: ctx.user.id,
          targetId: memberId,
          targetType: "user",
          payload: { teamId: session.teamId, role: nextRole, source: "team_manage" },
        }).catch(() => {});
        await ctx.raw.answerCbQuery("Сохранено").catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true };
      }

      if (data.startsWith("teamui:perm:")) {
        // teamui:perm:<create|assign|edit>:<on|off>
        const parts = data.split(":");
        const perm = parts[2];
        const mode = parts[3];
        const memberId = session.memberId;
        if (!memberId) {
          await ctx.raw.answerCbQuery("Не выбран").catch(() => {});
          return { handled: true };
        }
        const t = await getTeamById(session.teamId);
        const existing = (t?.permissions?.[memberId] ?? {}) as any;
        const next = { ...existing };
        next[perm] = mode === "on";
        await updatePermissions(session.teamId, memberId, next);
        logAction({
          action: "permission_updated",
          userId: ctx.user.id,
          targetId: memberId,
          targetType: "user",
          payload: { teamId: session.teamId, kind: "perm_toggle", perm, value: next[perm], source: "team_manage" },
        }).catch(() => {});
        await ctx.raw.answerCbQuery("Сохранено").catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true };
      }

      if (data === "teamui:projects") {
        session.screen = "projects";
        session.awaiting = null;
        session.memberId = null;
        await ctx.raw.answerCbQuery().catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true };
      }

      if (data.startsWith("teamui:proj:")) {
        const projectId = data.slice("teamui:proj:".length);
        session.screen = "project_access";
        session.projectId = projectId;
        session.pickIds = undefined;
        await ctx.raw.answerCbQuery().catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true };
      }

      if (data === "teamui:proj_access_all") {
        if (!session.projectId) {
          await ctx.raw.answerCbQuery("Проект не выбран").catch(() => {});
          return { handled: true };
        }
        await updateProjectAllowedMembers(session.projectId, null);
        logAction({
          action: "permission_updated",
          userId: ctx.user.id,
          targetId: session.projectId,
          targetType: "project",
          payload: { teamId: session.teamId, kind: "project_access", access: "all", source: "team_manage" },
        }).catch(() => {});
        await ctx.raw.answerCbQuery("Ок").catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true };
      }

      if (data === "teamui:proj_access_pick") {
        if (!session.projectId) {
          await ctx.raw.answerCbQuery("Проект не выбран").catch(() => {});
          return { handled: true };
        }
        const team = await getTeamById(session.teamId);
        const memberIds = team?.memberIds ?? [];
        const users = memberIds.length ? await getUsersByIds(memberIds) : [];
        // preload current selection from project
        const projects = await listProjectsByTeamId(session.teamId);
        const project = projects.find((p) => p.id === session.projectId);
        const selected = new Set<string>((project?.allowedMemberIds ?? []).filter(Boolean));
        session.pickIds = Array.from(selected);

        const buttons = users.map((u) => ({
          id: u.id,
          label: u.username ? `@${u.username}` : u.displayName,
          selected: selected.has(u.id),
        }));

        await ctx.raw.answerCbQuery().catch(() => {});
        const text =
          `<b>Выбор доступа</b>\n` +
          `Проект: ${escapeHtml(project?.name || session.projectId)}\n\n` +
          `Отметьте участников, затем нажмите “Сохранить”.`;
        await ctx.raw.editMessageText(text, { parse_mode: "HTML", ...kbPickMembers(buttons) }).catch(() => {});
        return { handled: true };
      }

      if (data.startsWith("teamui:pick_toggle:")) {
        const userId = data.slice("teamui:pick_toggle:".length);
        const set = new Set<string>((session.pickIds ?? []).filter(Boolean));
        if (set.has(userId)) set.delete(userId);
        else set.add(userId);
        session.pickIds = Array.from(set);

        const team = await getTeamById(session.teamId);
        const memberIds = team?.memberIds ?? [];
        const users = memberIds.length ? await getUsersByIds(memberIds) : [];

        const buttons = users.map((u) => ({
          id: u.id,
          label: u.username ? `@${u.username}` : u.displayName,
          selected: set.has(u.id),
        }));

        await ctx.raw.answerCbQuery().catch(() => {});
        const text = `<b>Выбор доступа</b>\nВыберите участников и сохраните.`;
        await ctx.raw.editMessageText(text, { parse_mode: "HTML", ...kbPickMembers(buttons) }).catch(() => {});
        return { handled: true };
      }

      if (data === "teamui:proj_access_cancel") {
        session.pickIds = undefined;
        session.screen = "project_access";
        await ctx.raw.answerCbQuery("Отмена").catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true };
      }

      if (data === "teamui:pick_save") {
        if (!session.projectId) {
          await ctx.raw.answerCbQuery("Проект не выбран").catch(() => {});
          return { handled: true };
        }
        const ids = (session.pickIds ?? []).filter(Boolean);
        await updateProjectAllowedMembers(session.projectId, ids);
        logAction({
          action: "permission_updated",
          userId: ctx.user.id,
          targetId: session.projectId,
          targetType: "project",
          payload: { teamId: session.teamId, kind: "project_access", access: ids.length ? "selected" : "all", allowedMemberIds: ids, source: "team_manage" },
        }).catch(() => {});
        session.pickIds = undefined;
        session.screen = "project_access";
        await ctx.raw.answerCbQuery("Сохранено").catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true };
      }

      await ctx.raw.answerCbQuery().catch(() => {});
      return { handled: true };
    }

    return { handled: false };
  },
};
