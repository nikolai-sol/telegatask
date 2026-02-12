/**
 * Briefing Service — утренний бриф и вечерний дайджест.
 *
 * Утренний бриф (9:00 по timezone):
 * - Задачи на сегодня
 * - Просроченные
 * - Ожидают ответа (follow-up)
 *
 * Вечерний дайджест (19:00 по timezone):
 * - Сводка дня: создано/закрыто
 * - Незакрытые от коллег
 */

import { Telegraf } from "telegraf";
import { getTasksByAssignee, getTasksByCreator } from "../repositories/taskRepository";
import { listAllUsers } from "../repositories/userRepository";
import { logAction } from "../repositories/actionLogRepository";
import { debugLog } from "../config/debug";
import type { Task } from "../models/task";
import type { TelegramUser } from "../models/telegramUser";

let botInstance: Telegraf | null = null;

export function setBriefingBotInstance(bot: Telegraf): void {
  botInstance = bot;
}

async function sendDM(telegramId: number, text: string): Promise<boolean> {
  if (!botInstance) return false;
  try {
    await botInstance.telegram.sendMessage(telegramId, text, { parse_mode: "HTML" });
    return true;
  } catch (error) {
    debugLog(`[briefing] Failed to send DM to ${telegramId}:`, error);
    return false;
  }
}

// ============================================================
// Morning Brief
// ============================================================

export async function sendMorningBriefs(): Promise<number> {
  let sent = 0;
  try {
    const users = await listAllUsers();
    const now = new Date();

    for (const user of users) {
      if (user.telegramId <= 0) continue;
      if (!user.settings?.morningBriefEnabled) continue;

      // Проверяем: сейчас 9:00 ± 30 мин в timezone пользователя?
      if (!isTimeInWindow(now, user.timezone ?? "Europe/Moscow", 9, 0, 30)) continue;

      try {
        const brief = await buildMorningBrief(user);
        if (!brief) continue;

        const ok = await sendDM(user.telegramId, brief);
        if (ok) {
          sent++;
          await logAction({
            action: "brief_sent",
            userId: user.id,
            payload: { type: "morning" },
          }).catch(() => {});
        }
      } catch (error) {
        debugLog(`[briefing] Morning brief failed for user ${user.id}`, error);
      }
    }
  } catch (error) {
    console.error("[briefing] Morning brief failed", error);
  }
  return sent;
}

async function buildMorningBrief(user: TelegramUser): Promise<string | null> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  // Мои задачи (assigned)
  const myTasks = await getTasksByAssignee(user.id, [
    "incoming",
    "new",
    "in_progress",
    "waiting",
  ]);

  // Задачи на сегодня (с дедлайном сегодня)
  const todayTasks = myTasks.filter(
    (t) =>
      t.dueDate &&
      new Date(t.dueDate) >= todayStart &&
      new Date(t.dueDate) <= todayEnd
  );

  // Просроченные
  const overdue = myTasks.filter(
    (t) => t.dueDate && new Date(t.dueDate) < todayStart
  );

  // Задачи я поставил (outbox) — ждут ответа
  const outbox = await getTasksByCreator(user.id, ["new", "in_progress", "waiting"]);
  const waitingForOthers = outbox.filter(
    (t) => t.assignedUserId && t.assignedUserId !== user.id
  );

  // Если нечего показать — не шлём
  if (!todayTasks.length && !overdue.length && !waitingForOthers.length && myTasks.length === 0) {
    return null;
  }

  let text = `☀️ <b>Доброе утро! Ваш бриф:</b>\n\n`;

  if (todayTasks.length) {
    text += `📅 <b>На сегодня (${todayTasks.length}):</b>\n`;
    todayTasks.slice(0, 5).forEach((t, i) => {
      text += `${i + 1}. ${shortDesc(t)}${t.priority !== "normal" ? ` [${t.priority}]` : ""}\n`;
    });
    if (todayTasks.length > 5) text += `   ...и ещё ${todayTasks.length - 5}\n`;
    text += "\n";
  }

  if (overdue.length) {
    text += `⏰ <b>Просрочено (${overdue.length}):</b>\n`;
    overdue.slice(0, 5).forEach((t, i) => {
      text += `${i + 1}. ${shortDesc(t)} (до ${formatDate(t.dueDate!)})\n`;
    });
    if (overdue.length > 5) text += `   ...и ещё ${overdue.length - 5}\n`;
    text += "\n";
  }

  if (waitingForOthers.length) {
    text += `📋 <b>Ждёте ответа (${waitingForOthers.length}):</b>\n`;
    waitingForOthers.slice(0, 5).forEach((t, i) => {
      text += `${i + 1}. ${shortDesc(t)}${t.sourceChatTitle ? ` — ${t.sourceChatTitle}` : ""}\n`;
    });
    if (waitingForOthers.length > 5) text += `   ...и ещё ${waitingForOthers.length - 5}\n`;
    text += "\n";
  }

  const totalActive = myTasks.length;
  text += `Всего активных задач: ${totalActive}`;

  return text;
}

// ============================================================
// Evening Digest
// ============================================================

export async function sendEveningDigests(): Promise<number> {
  let sent = 0;
  try {
    const users = await listAllUsers();
    const now = new Date();

    for (const user of users) {
      if (user.telegramId <= 0) continue;
      if (!user.settings?.eveningDigestEnabled) continue;

      if (!isTimeInWindow(now, user.timezone ?? "Europe/Moscow", 19, 0, 30)) continue;

      try {
        const digest = await buildEveningDigest(user);
        if (!digest) continue;

        const ok = await sendDM(user.telegramId, digest);
        if (ok) {
          sent++;
          await logAction({
            action: "digest_sent",
            userId: user.id,
            payload: { type: "evening" },
          }).catch(() => {});
        }
      } catch (error) {
        debugLog(`[briefing] Evening digest failed for user ${user.id}`, error);
      }
    }
  } catch (error) {
    console.error("[briefing] Evening digest failed", error);
  }
  return sent;
}

async function buildEveningDigest(user: TelegramUser): Promise<string | null> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // Мои задачи
  const activeTasks = await getTasksByAssignee(user.id, [
    "incoming",
    "new",
    "in_progress",
    "waiting",
  ]);
  const doneTasks = await getTasksByAssignee(user.id, ["done"]);
  const doneToday = doneTasks.filter(
    (t) => new Date(t.updatedAt) >= todayStart
  );

  // Outbox
  const outbox = await getTasksByCreator(user.id, ["new", "in_progress", "waiting"]);
  const unresolvedOutbox = outbox.filter(
    (t) => t.assignedUserId && t.assignedUserId !== user.id
  );

  if (!activeTasks.length && !doneToday.length && !unresolvedOutbox.length) {
    return null;
  }

  let text = `🌙 <b>Итоги дня:</b>\n\n`;

  text += `✅ Выполнено сегодня: ${doneToday.length}\n`;
  text += `📋 Активных задач: ${activeTasks.length}\n`;
  text += `📤 Ожидают от коллег: ${unresolvedOutbox.length}\n\n`;

  const overdue = activeTasks.filter(
    (t) => t.dueDate && new Date(t.dueDate) < now
  );
  if (overdue.length) {
    text += `⚠️ <b>Просрочено (${overdue.length}):</b>\n`;
    overdue.slice(0, 3).forEach((t, i) => {
      text += `${i + 1}. ${shortDesc(t)}\n`;
    });
    text += "\n";
  }

  const urgent = activeTasks.filter((t) => t.priority === "urgent" || t.priority === "high");
  if (urgent.length) {
    text += `🔴 <b>Важные (${urgent.length}):</b>\n`;
    urgent.slice(0, 3).forEach((t, i) => {
      text += `${i + 1}. ${shortDesc(t)} [${t.priority}]\n`;
    });
  }

  return text;
}

// ============================================================
// Helpers
// ============================================================

function isTimeInWindow(
  now: Date,
  timezone: string,
  targetHour: number,
  targetMinute: number,
  windowMinutes: number
): boolean {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0");

    const currentMinutes = hour * 60 + minute;
    const targetMinutes = targetHour * 60 + targetMinute;

    return Math.abs(currentMinutes - targetMinutes) <= windowMinutes;
  } catch {
    return false;
  }
}

function shortDesc(task: Task): string {
  const d = task.description || task.title || "(без описания)";
  return d.length > 80 ? d.slice(0, 80) + "..." : d;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Moscow",
    });
  } catch {
    return iso;
  }
}
