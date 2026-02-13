/**
 * Project Admin Skill — /project_manage
 *
 * Bot-only project management:
 * - create project (name/desc)
 * - bind project to current chat (attach + optional set default)
 * - manage "who can see project" with member search
 *
 * Input is handled via lightweight "prefix messages" to avoid global text interception:
 * - create name: send message starting with "+ " (e.g. "+ Новый проект")
 * - create desc: send message starting with "> " (e.g. "> Описание") or "> -" to skip
 * - member search: send message starting with "? " (e.g. "? niko")
 */

import { Markup } from "telegraf";
import type { Skill, SkillResult, SkillTrigger } from "../types";
import type { SkillContext } from "../../core/context";
import { logAction } from "../../repositories/actionLogRepository";
import { getTeamByChatId, getTeamById, setRole, createTeam } from "../../repositories/teamRepository";
import { createProject, listProjectsByTeamId, getProjectById, attachChatToProject, updateProjectAllowedMembers } from "../../repositories/projectRepository";
import { setDefaultProjectForChat } from "../../repositories/settingsRepository";
import { getUsersByIds, upsertUserFromTelegramPayload } from "../../repositories/userRepository";

type Screen =
  | "home"
  | "projects"
  | "project"
  | "create_name"
  | "create_desc"
  | "attach_pick"
  | "access"
  | "access_pick"
  | "access_search_results";

type Awaiting = "create_name" | "create_desc" | "member_search" | null;

type Session = {
  ownerUserId: string;
  ownerTelegramId: number;
  ownerUsername?: string | null;
  chatId: string;
  teamId: string | null;
  screen: Screen;
  projectId?: string | null;
  tempProjectName?: string | null;
  tempProjectDesc?: string | null;
  pickIds?: string[]; // selected memberIds for project access
  lastSearchQuery?: string | null;
  awaiting: Awaiting;
  createdAtMs: number;
};

const sessions = new Map<string, Session>(); // key = chatId:messageId
const TTL_MS = 1000 * 60 * 20;

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

async function canManageProjects(ctx: SkillContext, teamId: string): Promise<{ ok: boolean; reason?: string }> {
  const team = await getTeamById(teamId);
  if (!team) return { ok: false, reason: "Команда не найдена" };
  const role = team.roles?.[ctx.user.id];
  const isAdmin = role === "owner" || role === "admin";
  if (isAdmin) return { ok: true };
  if (isSuperAdminFromEnv(ctx.user.username ?? null)) return { ok: true };
  return { ok: false, reason: "Недостаточно прав (нужен owner/admin)" };
}

async function editOrReply(ctx: SkillContext, session: Session, forceEdit: boolean = false): Promise<void> {
  const { text, markup } = await render(session, ctx);
  if (ctx.triggerType === "callback" || forceEdit) {
    await ctx.raw.editMessageText(text, { parse_mode: "HTML", ...markup }).catch(async () => {
      await ctx.raw.reply(text, { parse_mode: "HTML", ...markup }).catch(() => {});
    });
    return;
  }
  await ctx.raw.reply(text, { parse_mode: "HTML", ...markup }).catch(() => {});
}

function kbHome(hasTeam: boolean) {
  if (!hasTeam) {
    return Markup.inlineKeyboard([
      [Markup.button.callback("🔗 Создать команду и привязать чат", "projui:bootstrap_team")],
      [Markup.button.callback("Закрыть", "projui:close")],
    ]);
  }
  return Markup.inlineKeyboard([
    [Markup.button.callback("➕ Создать проект", "projui:create")],
    [Markup.button.callback("📋 Список проектов", "projui:projects")],
    [Markup.button.callback("🔗 Привязать проект к чату", "projui:attach_pick")],
    [Markup.button.callback("Закрыть", "projui:close")],
  ]);
}

function kbProjects(projects: { id: string; name: string }[]) {
  const rows = projects.slice(0, 12).map((p) => [Markup.button.callback(p.name, `projui:open:${p.id}`)]);
  rows.push([Markup.button.callback("⬅ Назад", "projui:home")]);
  return Markup.inlineKeyboard(rows);
}

function kbProject() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔗 Привязать к этому чату", "projui:attach_current")],
    [Markup.button.callback("⭐ Привязать и сделать дефолт", "projui:attach_default_current")],
    [Markup.button.callback("👁 Кто видит проект", "projui:access")],
    [Markup.button.callback("⬅ Назад", "projui:projects")],
  ]);
}

function kbAttachPick(projects: { id: string; name: string }[]) {
  const rows = projects.slice(0, 12).map((p) => [Markup.button.callback(`🔗 ${p.name}`, `projui:attach:${p.id}`)]);
  rows.push([Markup.button.callback("⬅ Назад", "projui:home")]);
  return Markup.inlineKeyboard(rows);
}

function kbAttachConfirm(projectId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔗 Привязать к чату", `projui:attach:${projectId}`)],
    [Markup.button.callback("⭐ Привязать + сделать дефолт", `projui:attach_default:${projectId}`)],
    [Markup.button.callback("⬅ Назад", "projui:projects")],
  ]);
}

function kbAccess() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("👥 Доступ: всем", "projui:access_all")],
    [Markup.button.callback("🎯 Доступ: выбрать участников", "projui:access_pick")],
    [Markup.button.callback("⬅ Назад", "projui:project")],
  ]);
}

function kbAccessPick(hasSelection: boolean) {
  const rows: any[] = [];
  rows.push([Markup.button.callback("🔎 Поиск участника", "projui:access_search")]);
  rows.push([Markup.button.callback(hasSelection ? "✅ Сохранить" : "✅ Сохранить (всем)", "projui:access_save")]);
  rows.push([Markup.button.callback("🧹 Сбросить выбор", "projui:access_clear")]);
  rows.push([Markup.button.callback("⬅ Назад", "projui:access")]);
  return Markup.inlineKeyboard(rows);
}

function kbSearchResults(items: { id: string; label: string; selected: boolean }[]) {
  const rows = items.slice(0, 10).map((u) => [
    Markup.button.callback(`${u.selected ? "✅" : "⬜"} ${u.label}`, `projui:pick_toggle:${u.id}`),
  ]);
  rows.push([Markup.button.callback("⬅ Назад", "projui:access_pick")]);
  return Markup.inlineKeyboard(rows);
}

async function render(session: Session, ctx: SkillContext): Promise<{ text: string; markup: any }> {
  cleanup();

  const team = session.teamId ? await getTeamById(session.teamId) : null;
  const hasTeam = Boolean(team);

  if (session.screen === "home") {
    const text =
      `<b>Управление проектами</b>\n` +
      (hasTeam
        ? `Команда: <code>${escapeHtml(team!.name)}</code> (id=<code>${escapeHtml(team!.id)}</code>)\n` +
          `Чат: <code>${escapeHtml(session.chatId)}</code>\n`
        : `Команда для чата не привязана.\n\nИспользуйте /link_team или создайте команду кнопкой ниже.`) +
      `\n\n` +
      `Подсказки ввода:\n` +
      `• создать проект: “+ Название” затем “> Описание” (или “> -” чтобы пропустить)\n` +
      `• поиск участника: “? ник”`;
    return { text, markup: kbHome(hasTeam) };
  }

  if (!team) {
    session.screen = "home";
    session.teamId = null;
    return render(session, ctx);
  }

  const perm = await canManageProjects(ctx, team.id);
  if (!perm.ok) {
    session.screen = "home";
    return {
      text: `<b>Управление проектами</b>\n${escapeHtml(perm.reason || "Нет доступа")}`,
      markup: kbHome(true),
    };
  }

  if (session.screen === "projects") {
    const projects = await listProjectsByTeamId(team.id);
    const short = projects.map((p) => ({ id: p.id, name: p.name || p.id }));
    const lines = short.length
      ? short.map((p, idx) => `${idx + 1}. ${escapeHtml(p.name)} (id=<code>${escapeHtml(p.id)}</code>)`).join("\n")
      : "Пока нет проектов.";
    const text = `<b>Проекты команды</b>\n\n${lines}`;
    return { text, markup: kbProjects(short) };
  }

  if (session.screen === "create_name") {
    const text =
      `<b>Создать проект</b>\n\n` +
      `Отправьте название проекта сообщением, начните с “+ ”.\n` +
      `Пример: <code>+ Платформа A</code>\n\n` +
      `Или нажмите “Назад”.`;
    return { text, markup: Markup.inlineKeyboard([[Markup.button.callback("⬅ Назад", "projui:home")]]) };
  }

  if (session.screen === "create_desc") {
    const text =
      `<b>Описание проекта</b>\n\n` +
      `Отправьте описание сообщением, начните с “&gt; ”.\n` +
      `Пример: <code>&gt; Внедрение и интеграции</code>\n` +
      `Чтобы пропустить: <code>&gt; -</code>`;
    return { text, markup: Markup.inlineKeyboard([[Markup.button.callback("⬅ Назад", "projui:home")]]) };
  }

  if (session.screen === "project") {
    const projectId = session.projectId;
    const p = projectId ? await getProjectById(projectId) : null;
    if (!p) {
      session.screen = "projects";
      session.projectId = null;
      return render(session, ctx);
    }
    const access = !p.allowedMemberIds || p.allowedMemberIds.length === 0 ? "все" : `выбрано: ${p.allowedMemberIds.length}`;
    const isAttached = (p.chatIds ?? []).includes(session.chatId);
    const text =
      `<b>Проект</b>\n` +
      `Название: ${escapeHtml(p.name)}\n` +
      (p.description ? `Описание: ${escapeHtml(p.description)}\n` : "") +
      `Доступ: ${escapeHtml(access)}\n` +
      `Привязан к чату: ${isAttached ? "да" : "нет"}\n` +
      `id=<code>${escapeHtml(p.id)}</code>`;
    return { text, markup: kbProject() };
  }

  if (session.screen === "attach_pick") {
    const projects = await listProjectsByTeamId(team.id);
    const short = projects.map((p) => ({ id: p.id, name: p.name || p.id }));
    const text =
      `<b>Привязать проект к чату</b>\n\n` +
      `Чат: <code>${escapeHtml(session.chatId)}</code>\n\n` +
      (short.length ? `Выберите проект:` : `Нет проектов. Создайте проект.`); 
    return { text, markup: kbAttachPick(short) };
  }

  if (session.screen === "access") {
    const projectId = session.projectId;
    const p = projectId ? await getProjectById(projectId) : null;
    if (!p) {
      session.screen = "projects";
      session.projectId = null;
      return render(session, ctx);
    }
    const allowed = p.allowedMemberIds;
    const text =
      `<b>Кто видит проект</b>\n` +
      `Проект: ${escapeHtml(p.name)}\n\n` +
      (!allowed || allowed.length === 0
        ? `Доступ: <b>все участники команды</b>`
        : `Доступ: <b>только выбранные</b> (${allowed.length})`);
    return { text, markup: kbAccess() };
  }

  if (session.screen === "access_pick") {
    const projectId = session.projectId;
    const p = projectId ? await getProjectById(projectId) : null;
    if (!p) {
      session.screen = "projects";
      session.projectId = null;
      return render(session, ctx);
    }

    const selected = new Set<string>((session.pickIds ?? []).filter(Boolean));
    const text =
      `<b>Доступ: выбор участников</b>\n` +
      `Проект: ${escapeHtml(p.name)}\n\n` +
      `Выбрано: <b>${selected.size}</b>\n\n` +
      `Поиск: отправьте сообщение вида <code>? nikolai</code>.\n` +
      `После выбора нажмите “Сохранить”.`;
    return { text, markup: kbAccessPick(selected.size > 0) };
  }

  if (session.screen === "access_search_results") {
    const q = (session.lastSearchQuery || "").trim();
    const teamMemberIds = team.memberIds ?? [];
    const users = teamMemberIds.length ? await getUsersByIds(teamMemberIds) : [];
    const needle = q.toLowerCase();
    const selected = new Set<string>((session.pickIds ?? []).filter(Boolean));

    const matches = users
      .map((u) => ({
        id: u.id,
        label: u.username ? `@${u.username}` : u.displayName,
        key: `${u.username || ""} ${u.displayName || ""}`.toLowerCase(),
      }))
      .filter((u) => (needle ? u.key.includes(needle) : true))
      .slice(0, 10)
      .map((u) => ({ id: u.id, label: u.label, selected: selected.has(u.id) }));

    const text =
      `<b>Результаты поиска</b>\n` +
      `Запрос: <code>${escapeHtml(q || "—")}</code>\n\n` +
      (matches.length ? `Выберите участников:` : `Ничего не найдено.\n\nПопробуйте: <code>? nik</code>`);

    return { text, markup: kbSearchResults(matches) };
  }

  // Fallback
  session.screen = "home";
  return render(session, ctx);
}

export const projectAdminSkill: Skill = {
  meta: {
    id: "project-admin",
    name: "Project Admin",
    description: "Управление проектами из бота: создание, привязка к чату, доступы",
    version: "1.0.0",
    triggers: [
      { type: "command", command: "project_manage", aliases: ["projects_manage"] },
      { type: "callback", prefix: "projui:" },
      // Prefix-based input to avoid hijacking normal chat messages.
      { type: "text", pattern: /^\\+\\s+.+/s, priority: 8 } as SkillTrigger,
      { type: "text", pattern: /^>\\s*(.|\\n)*/s, priority: 8 } as SkillTrigger,
      { type: "text", pattern: /^\\?\\s+.+/s, priority: 8 } as SkillTrigger,
    ],
    permissions: { minPlan: "free", chatType: "any", minRole: null },
    menuEntry: { command: "project_manage", description: "Управление проектами (создать/привязать/доступ)" },
    keyboardButton: "Проекты",
  },

  async execute(ctx: SkillContext): Promise<SkillResult> {
    cleanup();

    const rawChatId = String(ctx.telegramChatId || "");
    const isGroup = ctx.chatType === "group" || ctx.chatType === "supergroup";

    // Resolve session key from callback message or the message we just sent.
    const cbMsg = ctx.raw.callbackQuery && "message" in ctx.raw.callbackQuery ? (ctx.raw.callbackQuery.message as any) : null;
    const msg = ctx.raw.message as any;
    const sessionKey =
      cbMsg && cbMsg.message_id
        ? keyFor(ctx.telegramChatId, cbMsg.message_id)
        : msg && msg.reply_to_message && msg.reply_to_message.message_id
          ? keyFor(ctx.telegramChatId, msg.reply_to_message.message_id)
          : null;

    const username = ctx.user.username ?? null;
    const isSuper = isSuperAdminFromEnv(username);

    const ensureSession = async (): Promise<{ session: Session; key: string } | null> => {
      if (ctx.triggerType === "command") {
        const team = isGroup ? await getTeamByChatId(rawChatId) : null;
        const s: Session = {
          ownerUserId: ctx.user.id,
          ownerTelegramId: ctx.telegramUserId,
          ownerUsername: username,
          chatId: rawChatId,
          teamId: team?.id ?? null,
          screen: "home",
          awaiting: null,
          createdAtMs: Date.now(),
        };
        // Send initial message and bind session to message_id
        const text = "<b>Управление проектами</b>\nЗагрузка…";
        const sent = await ctx.raw.reply(text, { parse_mode: "HTML" }).catch(() => null);
        const messageId = (sent as any)?.message_id;
        if (!messageId) return null;
        const k = keyFor(ctx.telegramChatId, messageId);
        sessions.set(k, s);
        await editOrReply(ctx, s, true);
        return { session: s, key: k };
      }

      if (ctx.triggerType === "callback") {
        const data = ctx.callbackData || "";
        if (!cbMsg || !cbMsg.message_id) return null;
        const k = keyFor(ctx.telegramChatId, cbMsg.message_id);
        const s = sessions.get(k);
        if (!s) {
          await ctx.raw.answerCbQuery("Сессия устарела. Запустите /project_manage").catch(() => {});
          return null;
        }
        // Only owner can operate this session (except superadmin).
        if (ctx.user.id !== s.ownerUserId && !isSuper) {
          await ctx.raw.answerCbQuery("Не ваша сессия").catch(() => {});
          return null;
        }
        s.createdAtMs = Date.now();
        return { session: s, key: k };
      }

      // Text input: must be reply to the session message.
      if (!msg || !msg.reply_to_message || !msg.reply_to_message.message_id) return null;
      const k = keyFor(ctx.telegramChatId, msg.reply_to_message.message_id);
      const s = sessions.get(k);
      if (!s) return null;
      if (ctx.user.id !== s.ownerUserId && !isSuper) return null;
      s.createdAtMs = Date.now();
      return { session: s, key: k };
    };

    const found = await ensureSession();
    if (!found) return { handled: false };
    const session = found.session;

    // Re-resolve team if needed.
    if (!session.teamId && isGroup) {
      const team = await getTeamByChatId(rawChatId);
      if (team) session.teamId = team.id;
    }

    // Handle text-based inputs.
    if (ctx.triggerType === "text") {
      const text = (ctx.text || "").trim();
      if (session.awaiting === "create_name" && text.startsWith("+")) {
        const name = text.replace(/^\\+\\s*/, "").trim().slice(0, 64);
        if (!name) {
          await ctx.raw.reply("Название пустое. Пример: + Платформа A").catch(() => {});
          return { handled: true, skipUsageIncrement: true };
        }
        session.tempProjectName = name;
        session.screen = "create_desc";
        session.awaiting = "create_desc";
        await editOrReply(ctx, session, false);
        return { handled: true, skipUsageIncrement: true };
      }

      if (session.awaiting === "create_desc" && text.startsWith(">")) {
        const raw = text.replace(/^>\\s*/, "").trim();
        const desc = raw === "-" ? null : raw.slice(0, 240);
        session.tempProjectDesc = desc;

        if (!session.teamId) {
          session.screen = "home";
          session.awaiting = null;
          await ctx.raw.reply("Команда не привязана. Используйте /link_team.").catch(() => {});
          await editOrReply(ctx, session, false);
          return { handled: true, skipUsageIncrement: true };
        }

        const perm = await canManageProjects(ctx, session.teamId);
        if (!perm.ok) {
          session.screen = "home";
          session.awaiting = null;
          await ctx.raw.reply(perm.reason || "Нет прав").catch(() => {});
          await editOrReply(ctx, session, false);
          return { handled: true, skipUsageIncrement: true };
        }

        const created = await createProject({
          name: session.tempProjectName || "Без названия",
          description: desc,
          teamId: session.teamId,
          chatIds: [],
          allowedMemberIds: null,
        });

        logAction({
          action: "project_attached",
          userId: ctx.user.id,
          targetId: created.id,
          targetType: "project",
          payload: { teamId: session.teamId, kind: "project_created", name: created.name },
        }).catch(() => {});

        session.projectId = created.id;
        session.screen = "project";
        session.awaiting = null;
        session.tempProjectName = null;
        session.tempProjectDesc = null;
        await ctx.raw.reply(`Проект создан: ${created.name} (id=${created.id})`).catch(() => {});
        await editOrReply(ctx, session, false);
        return { handled: true };
      }

      if (session.awaiting === "member_search" && text.startsWith("?")) {
        const q = text.replace(/^\\?\\s*/, "").trim().slice(0, 64);
        session.lastSearchQuery = q;
        session.screen = "access_search_results";
        await editOrReply(ctx, session, false);
        return { handled: true, skipUsageIncrement: true };
      }

      return { handled: false };
    }

    // Handle callbacks.
    if (ctx.triggerType === "callback") {
      const data = ctx.callbackData || "";
      if (!data.startsWith("projui:")) return { handled: false };

      if (data === "projui:close") {
        sessions.delete(found.key);
        await ctx.raw.answerCbQuery("Закрыто").catch(() => {});
        await ctx.raw.editMessageText("Закрыто.", {}).catch(() => {});
        return { handled: true, skipUsageIncrement: true };
      }

      if (data === "projui:home") {
        session.screen = "home";
        session.awaiting = null;
        session.projectId = null;
        await ctx.raw.answerCbQuery().catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true, skipUsageIncrement: true };
      }

      if (data === "projui:bootstrap_team") {
        if (!isGroup) {
          await ctx.raw.answerCbQuery("Откройте в группе").catch(() => {});
          return { handled: true, skipUsageIncrement: true };
        }
        const newTeam = await createTeam(`Team-${session.chatId}`, session.chatId);
        await setRole(newTeam.id, ctx.user.id, "owner");
        logAction({
          action: "team_linked",
          userId: ctx.user.id,
          targetId: newTeam.id,
          targetType: "team",
          payload: { chatId: session.chatId, created: true, source: "project_manage" },
        }).catch(() => {});
        session.teamId = newTeam.id;
        session.screen = "home";
        await ctx.raw.answerCbQuery("Команда создана").catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true };
      }

      if (!session.teamId) {
        await ctx.raw.answerCbQuery("Команда не привязана").catch(() => {});
        session.screen = "home";
        await editOrReply(ctx, session, true);
        return { handled: true, skipUsageIncrement: true };
      }

      const perm = await canManageProjects(ctx, session.teamId);
      if (!perm.ok) {
        await ctx.raw.answerCbQuery(perm.reason || "Нет доступа").catch(() => {});
        session.screen = "home";
        await editOrReply(ctx, session, true);
        return { handled: true, skipUsageIncrement: true };
      }

      if (data === "projui:projects") {
        session.screen = "projects";
        session.awaiting = null;
        session.projectId = null;
        await ctx.raw.answerCbQuery().catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true, skipUsageIncrement: true };
      }

      if (data === "projui:create") {
        session.screen = "create_name";
        session.awaiting = "create_name";
        session.tempProjectName = null;
        session.tempProjectDesc = null;
        await ctx.raw.answerCbQuery().catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true, skipUsageIncrement: true };
      }

      if (data === "projui:attach_pick") {
        session.screen = "attach_pick";
        session.awaiting = null;
        session.projectId = null;
        await ctx.raw.answerCbQuery().catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true, skipUsageIncrement: true };
      }

      if (data.startsWith("projui:open:")) {
        const projectId = data.slice("projui:open:".length);
        session.projectId = projectId;
        session.screen = "project";
        session.awaiting = null;
        await ctx.raw.answerCbQuery().catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true, skipUsageIncrement: true };
      }

      if (data === "projui:project") {
        session.screen = "project";
        session.awaiting = null;
        await ctx.raw.answerCbQuery().catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true, skipUsageIncrement: true };
      }

      if (data === "projui:attach_current" || data === "projui:attach_default_current") {
        const projectId = session.projectId;
        if (!projectId) {
          await ctx.raw.answerCbQuery("Проект не выбран").catch(() => {});
          return { handled: true, skipUsageIncrement: true };
        }
        // Re-render a confirm keyboard (helps avoid accidental binding)
        await ctx.raw.answerCbQuery().catch(() => {});
        await ctx.raw.editMessageReplyMarkup(kbAttachConfirm(projectId).reply_markup as any).catch(() => {});
        return { handled: true, skipUsageIncrement: true };
      }

      if (data.startsWith("projui:attach_default:") || data.startsWith("projui:attach:")) {
        const isDefault = data.startsWith("projui:attach_default:");
        const projectId = data.slice(isDefault ? "projui:attach_default:".length : "projui:attach:".length);
        if (!isGroup) {
          await ctx.raw.answerCbQuery("Привязка работает в группах").catch(() => {});
          return { handled: true, skipUsageIncrement: true };
        }
        await attachChatToProject(projectId, session.chatId);
        if (isDefault) await setDefaultProjectForChat(session.chatId, projectId);
        logAction({
          action: "project_attached",
          userId: ctx.user.id,
          targetId: projectId,
          targetType: "project",
          payload: { chatId: session.chatId, default: isDefault, source: "project_manage" },
        }).catch(() => {});
        await ctx.raw.answerCbQuery("Готово").catch(() => {});
        session.projectId = projectId;
        session.screen = "project";
        await editOrReply(ctx, session, true);
        return { handled: true };
      }

      if (data === "projui:access") {
        if (!session.projectId) {
          await ctx.raw.answerCbQuery("Проект не выбран").catch(() => {});
          return { handled: true, skipUsageIncrement: true };
        }
        session.screen = "access";
        session.awaiting = null;
        session.pickIds = undefined;
        await ctx.raw.answerCbQuery().catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true, skipUsageIncrement: true };
      }

      if (data === "projui:access_all") {
        if (!session.projectId) {
          await ctx.raw.answerCbQuery("Проект не выбран").catch(() => {});
          return { handled: true, skipUsageIncrement: true };
        }
        await updateProjectAllowedMembers(session.projectId, null);
        logAction({
          action: "permission_updated",
          userId: ctx.user.id,
          targetId: session.projectId,
          targetType: "project",
          payload: { teamId: session.teamId, kind: "project_access", access: "all", source: "project_manage" },
        }).catch(() => {});
        await ctx.raw.answerCbQuery("Сохранено").catch(() => {});
        session.screen = "access";
        await editOrReply(ctx, session, true);
        return { handled: true };
      }

      if (data === "projui:access_pick") {
        if (!session.projectId) {
          await ctx.raw.answerCbQuery("Проект не выбран").catch(() => {});
          return { handled: true, skipUsageIncrement: true };
        }
        const p = await getProjectById(session.projectId);
        const selected = new Set<string>((p?.allowedMemberIds ?? []).filter(Boolean));
        session.pickIds = Array.from(selected);
        session.awaiting = "member_search";
        session.screen = "access_pick";
        await ctx.raw.answerCbQuery().catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true, skipUsageIncrement: true };
      }

      if (data === "projui:access_search") {
        session.awaiting = "member_search";
        await ctx.raw.answerCbQuery("Отправьте: ? ник").catch(() => {});
        return { handled: true, skipUsageIncrement: true };
      }

      if (data.startsWith("projui:pick_toggle:")) {
        const userId = data.slice("projui:pick_toggle:".length);
        const set = new Set<string>((session.pickIds ?? []).filter(Boolean));
        if (set.has(userId)) set.delete(userId);
        else set.add(userId);
        session.pickIds = Array.from(set);
        await ctx.raw.answerCbQuery().catch(() => {});
        // Keep on search results screen to let user toggle multiple.
        session.screen = "access_search_results";
        await editOrReply(ctx, session, true);
        return { handled: true, skipUsageIncrement: true };
      }

      if (data === "projui:access_clear") {
        session.pickIds = [];
        session.screen = "access_pick";
        session.awaiting = "member_search";
        await ctx.raw.answerCbQuery("Сброшено").catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true, skipUsageIncrement: true };
      }

      if (data === "projui:access_save") {
        if (!session.projectId) {
          await ctx.raw.answerCbQuery("Проект не выбран").catch(() => {});
          return { handled: true, skipUsageIncrement: true };
        }
        const ids = (session.pickIds ?? []).filter(Boolean);
        await updateProjectAllowedMembers(session.projectId, ids.length ? ids : null);
        logAction({
          action: "permission_updated",
          userId: ctx.user.id,
          targetId: session.projectId,
          targetType: "project",
          payload: { teamId: session.teamId, kind: "project_access", access: ids.length ? "selected" : "all", allowedMemberIds: ids, source: "project_manage" },
        }).catch(() => {});
        session.screen = "access";
        session.awaiting = null;
        session.pickIds = undefined;
        await ctx.raw.answerCbQuery("Сохранено").catch(() => {});
        await editOrReply(ctx, session, true);
        return { handled: true };
      }

      await ctx.raw.answerCbQuery().catch(() => {});
      return { handled: true, skipUsageIncrement: true };
    }

    return { handled: false };
  },
};

